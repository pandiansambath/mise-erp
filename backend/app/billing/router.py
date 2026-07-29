"""Stripe billing — TEST MODE subscription for the DineAI Pro plan.

How the money flow works (none of it touches our servers):
  1. `/billing/checkout` asks Stripe for a hosted Checkout page and we redirect
     the owner there. CARD DETAILS NEVER TOUCH OUR APP — Stripe hosts the form,
     carries the PCI burden, and sends the browser back to Settings.
  2. Stripe then talks to us server-to-server via `/billing/webhook`: every
     event is signed (HMAC-SHA256 with the endpoint's whsec) so nobody can
     forge a "they paid!" call. We verify the signature ourselves — no SDK.
  3. `/billing/portal` opens Stripe's self-serve portal (change card, cancel).

State machine on Hotel.subscription_status:
  free → (checkout completes) → trialing/active → past_due (payment failed)
       → active again (invoice.paid) or canceled (subscription deleted).
  A DELETED subscription also suspends the hotel (is_active=False) — same
  lever the Control Room uses; operators can always lift it manually.
"""
import hashlib
import hmac
import json
import logging
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.models import Role, User
from app.billing import emails
from app.core.config import settings
from app.core.database import get_db
from app.hotels.models import Hotel

log = logging.getLogger("mise.billing")
router = APIRouter(prefix="/billing", tags=["billing"])

STRIPE_API = "https://api.stripe.com/v1"


async def _stripe(method: str, path: str, **form) -> dict:
    """One call to Stripe's REST API (form-encoded, basic-auth with the secret
    key). Kept SDK-free: it's ~10 lines, and the tests can stub this one door."""
    import httpx

    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.request(
            method,
            f"{STRIPE_API}{path}",
            auth=(settings.stripe_secret_key, ""),
            data=form or None,
        )
    body = resp.json()
    if resp.status_code >= 400:
        log.error("stripe %s %s -> %s %s", method, path, resp.status_code, body.get("error"))
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Stripe request failed")
    return body


def _require_configured() -> None:
    if not (settings.stripe_secret_key and settings.stripe_price_id):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Billing is not configured")


def _require_owner(user: User) -> None:
    if user.role != Role.SUPER_ADMIN.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can manage billing")


async def _ensure_customer(db: AsyncSession, hotel: Hotel, email: str) -> str:
    """The hotel's identity at Stripe — created once, reused forever."""
    if hotel.stripe_customer_id:
        return hotel.stripe_customer_id
    customer = await _stripe(
        "POST", "/customers",
        name=hotel.name, email=email, **{"metadata[hotel_id]": str(hotel.id)},
    )
    hotel.stripe_customer_id = customer["id"]
    await db.commit()
    return customer["id"]


@router.get("/status")
async def billing_status(
    current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    hotel = await db.get(Hotel, current.hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    return {
        "configured": bool(settings.stripe_secret_key and settings.stripe_price_id),
        "status": hotel.subscription_status,
        "has_customer": bool(hotel.stripe_customer_id),
        "test_mode": settings.stripe_secret_key.startswith("sk_test_"),
    }


def price_for(plan: str, interval: str = "month") -> str:
    """The Stripe price id for a plan. Falls back to the legacy single price so
    an existing deployment that only ever had one price keeps working."""
    import json

    from app.platform_admin import features as feat

    try:
        table = json.loads(settings.stripe_prices or "{}")
    except ValueError:
        log.error("STRIPE_PRICES is not valid JSON — falling back to the single price")
        table = {}
    key = f"{feat.canonical_plan(plan)}_{'year' if interval == 'year' else 'month'}"
    return table.get(key) or settings.stripe_price_id


@router.post("/checkout")
async def create_checkout(
    plan: str = "pro",
    interval: str = "month",
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Start a subscription: returns the URL of Stripe's hosted Checkout page."""
    _require_configured()
    _require_owner(current)
    hotel = await db.get(Hotel, current.hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    from app.platform_admin import features as feat

    if not feat.is_valid_plan(plan):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown plan {plan!r}")
    price = price_for(plan, interval)
    if not price:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "That plan has no price configured yet.",
        )
    # the plan is carried on the subscription so the webhook can grant exactly
    # what was paid for, rather than guessing from the amount
    trial = feat.get_plan(plan)
    customer_id = await _ensure_customer(db, hotel, current.email)
    session = await _stripe(
        "POST", "/checkout/sessions",
        mode="subscription",
        customer=customer_id,
        success_url=f"{settings.app_base_url}/settings?billing=success",
        cancel_url=f"{settings.app_base_url}/settings?billing=cancelled",
        **{
            "line_items[0][price]": price,
            "line_items[0][quantity]": "1",
            "subscription_data[trial_period_days]": str((trial.trial_days if trial else 0) or 14),
            "subscription_data[metadata][hotel_id]": str(hotel.id),
            "subscription_data[metadata][plan]": feat.canonical_plan(plan),
            "metadata[hotel_id]": str(hotel.id),
            "metadata[plan]": feat.canonical_plan(plan),
        },
    )
    return {"url": session["url"]}


@router.post("/portal")
async def create_portal(
    current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """Open Stripe's self-serve portal: change card, download invoices, cancel."""
    _require_configured()
    _require_owner(current)
    hotel = await db.get(Hotel, current.hotel_id)
    if hotel is None or not hotel.stripe_customer_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No billing account yet — subscribe first")
    session = await _stripe(
        "POST", "/billing_portal/sessions",
        customer=hotel.stripe_customer_id,
        return_url=f"{settings.app_base_url}/settings",
    )
    return {"url": session["url"]}


# ── The webhook: Stripe talking to us, signature-verified ─────────────────────
def verify_stripe_signature(payload: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    """Stripe signs `"{t}.{raw_body}"` with the endpoint secret (HMAC-SHA256)
    and sends `t=...,v1=...`. Recompute and compare in constant time; refuse
    stale timestamps so a captured request can't be replayed later."""
    try:
        parts = dict(p.split("=", 1) for p in header.split(","))
        ts = int(parts["t"])
        given = parts["v1"]
    except (ValueError, KeyError, AttributeError):
        return False
    if abs(time.time() - ts) > tolerance:
        return False
    expected = hmac.new(
        secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, given)


# Stripe subscription statuses we mirror onto the hotel.
_STATUS_MAP = {
    "trialing": "trialing",
    "active": "active",
    "past_due": "past_due",
    "unpaid": "past_due",
    "canceled": "canceled",
    "incomplete": "past_due",
    "incomplete_expired": "canceled",
}


async def _hotel_by_customer(db: AsyncSession, customer_id: str) -> Hotel | None:
    return (
        await db.execute(select(Hotel).where(Hotel.stripe_customer_id == customer_id))
    ).scalar_one_or_none()


def _apply_plan(hotel, plan_key: str) -> None:
    """Grant what was actually paid for.

    Without this a customer could complete checkout for Enterprise and receive
    nothing — status would flip to active while their features stayed on the
    old plan. The plan travels on the subscription's metadata, so we grant the
    plan that was BOUGHT rather than inferring it from the amount (which breaks
    the moment you run a discount).
    """
    from app.platform_admin import features as feat

    if not feat.is_valid_plan(plan_key):
        log.error("stripe webhook carried unknown plan %r — leaving plan unchanged", plan_key)
        return
    canonical = feat.canonical_plan(plan_key)
    hotel.plan = canonical
    hotel.features = feat.plan_features(canonical)  # reassign so the JSON is dirty

    # Start the clock. Without this `trial_days` was a number in a config file
    # that nothing ever acted on.
    plan = feat.get_plan(canonical)
    if plan and plan.trial_days and not hotel.trial_ends_on:
        from datetime import UTC, datetime, timedelta

        hotel.trial_ends_on = (
            datetime.now(UTC) + timedelta(days=plan.trial_days)
        ).date()


@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    if not settings.stripe_webhook_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Billing is not configured")
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    if not verify_stripe_signature(payload, sig, settings.stripe_webhook_secret):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bad signature")

    event = json.loads(payload)
    etype = event.get("type", "")
    obj = event.get("data", {}).get("object", {})

    if etype == "checkout.session.completed":
        # One-time ORDER payments carry metadata.order_id (no customer needed).
        order_id = (obj.get("metadata") or {}).get("order_id")
        if order_id:
            from app.ordering.models import Order

            order = await db.get(Order, uuid.UUID(order_id))
            if order:
                order.payment_status = "PAID"
                await db.commit()
            return {"received": True}
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel:
            hotel.stripe_subscription_id = obj.get("subscription")
            hotel.subscription_status = "active"  # refined by subscription.updated
            paid_for = (obj.get("metadata") or {}).get("plan")
            if paid_for:
                _apply_plan(hotel, paid_for)
            await db.commit()

    elif etype == "customer.subscription.updated":
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel:
            hotel.stripe_subscription_id = obj.get("id")
            hotel.subscription_status = _STATUS_MAP.get(obj.get("status", ""), "active")
            # an upgrade or downgrade arrives as an update, so re-apply the plan
            paid_for = (obj.get("metadata") or {}).get("plan")
            if paid_for:
                _apply_plan(hotel, paid_for)
            await db.commit()

    elif etype == "customer.subscription.deleted":
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel:
            hotel.subscription_status = "canceled"
            # The paid door closes — same suspension lever the Control Room uses.
            hotel.is_active = False
            await db.commit()
            # Sent AFTER the commit: an email promising the door is shut must
            # never go out if the state change itself failed to persist.
            await emails.subscription_ended(db, hotel)

    elif etype == "invoice.payment_failed":
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel and hotel.stripe_subscription_id:
            hotel.subscription_status = "past_due"  # grace: app stays open
            await db.commit()
            # Tell them. This used to change state in silence, so the first sign
            # of a dead card was the app refusing to work mid-service.
            await emails.payment_failed(db, hotel, obj.get("attempt_count") or 1)

    elif etype == "customer.subscription.trial_will_end":
        # Stripe fires this ~3 days out for trials IT knows about. Our own
        # pre-Stripe trials are covered by the daily reminder job instead.
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel:
            await emails.trial_ending(db, hotel, 3)

    elif etype == "invoice.paid":
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel and hotel.stripe_subscription_id:
            hotel.subscription_status = "active"
            hotel.is_active = True  # a payment always reopens the door
            await db.commit()

    return {"received": True}
