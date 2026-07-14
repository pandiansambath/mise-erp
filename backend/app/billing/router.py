"""Stripe billing — TEST MODE subscription for the Mise Pro plan.

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

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.models import Role, User
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


@router.post("/checkout")
async def create_checkout(
    current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    """Start a subscription: returns the URL of Stripe's hosted Checkout page."""
    _require_configured()
    _require_owner(current)
    hotel = await db.get(Hotel, current.hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    customer_id = await _ensure_customer(db, hotel, current.email)
    session = await _stripe(
        "POST", "/checkout/sessions",
        mode="subscription",
        customer=customer_id,
        success_url=f"{settings.app_base_url}/settings?billing=success",
        cancel_url=f"{settings.app_base_url}/settings?billing=cancelled",
        **{
            "line_items[0][price]": settings.stripe_price_id,
            "line_items[0][quantity]": "1",
            "subscription_data[trial_period_days]": "14",
            "subscription_data[metadata][hotel_id]": str(hotel.id),
            "metadata[hotel_id]": str(hotel.id),
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
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel:
            hotel.stripe_subscription_id = obj.get("subscription")
            hotel.subscription_status = "active"  # refined by subscription.updated
            await db.commit()

    elif etype == "customer.subscription.updated":
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel:
            hotel.stripe_subscription_id = obj.get("id")
            hotel.subscription_status = _STATUS_MAP.get(obj.get("status", ""), "active")
            await db.commit()

    elif etype == "customer.subscription.deleted":
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel:
            hotel.subscription_status = "canceled"
            # The paid door closes — same suspension lever the Control Room uses.
            hotel.is_active = False
            await db.commit()

    elif etype == "invoice.payment_failed":
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel and hotel.stripe_subscription_id:
            hotel.subscription_status = "past_due"  # grace: app stays open
            await db.commit()

    elif etype == "invoice.paid":
        hotel = await _hotel_by_customer(db, obj.get("customer", ""))
        if hotel and hotel.stripe_subscription_id:
            hotel.subscription_status = "active"
            hotel.is_active = True  # a payment always reopens the door
            await db.commit()

    return {"received": True}
