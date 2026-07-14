"""Stripe billing: webhook signature + status state machine + checkout gating."""
import hashlib
import hmac
import json
import time

import pytest

from app.auth.models import Role
from app.billing import router as billing
from app.core.config import settings

WHSEC = "whsec_test_secret_for_ci"


def sign(payload: bytes, secret: str = WHSEC, ts: int | None = None) -> str:
    """Produce a valid Stripe-Signature header the way Stripe does."""
    t = ts if ts is not None else int(time.time())
    v1 = hmac.new(secret.encode(), f"{t}.".encode() + payload, hashlib.sha256).hexdigest()
    return f"t={t},v1={v1}"


def event(etype: str, obj: dict) -> bytes:
    return json.dumps({"type": etype, "data": {"object": obj}}).encode()


@pytest.mark.asyncio
async def test_webhook_verifies_signature_and_walks_the_state_machine(
    client, hotel, db, monkeypatch
):
    monkeypatch.setattr(settings, "stripe_webhook_secret", WHSEC)
    hotel.stripe_customer_id = "cus_test123"
    hotel.stripe_subscription_id = "sub_test123"
    hotel.subscription_status = "active"
    await db.commit()

    # forged/bad signature is refused outright
    payload = event("invoice.payment_failed", {"customer": "cus_test123"})
    bad = await client.post(
        "/api/billing/webhook", content=payload,
        headers={"stripe-signature": "t=1,v1=deadbeef"},
    )
    assert bad.status_code == 400

    # a STALE timestamp is refused too (replay protection)
    stale = await client.post(
        "/api/billing/webhook", content=payload,
        headers={"stripe-signature": sign(payload, ts=int(time.time()) - 3600)},
    )
    assert stale.status_code == 400

    # payment failed -> past_due (grace: the app stays open)
    ok = await client.post(
        "/api/billing/webhook", content=payload,
        headers={"stripe-signature": sign(payload)},
    )
    assert ok.status_code == 200
    db.expire_all()
    await db.refresh(hotel)
    assert hotel.subscription_status == "past_due"
    assert hotel.is_active is True

    # subscription deleted -> canceled AND the door closes
    payload = event("customer.subscription.deleted", {"customer": "cus_test123"})
    await client.post(
        "/api/billing/webhook", content=payload,
        headers={"stripe-signature": sign(payload)},
    )
    db.expire_all()
    await db.refresh(hotel)
    assert hotel.subscription_status == "canceled"
    assert hotel.is_active is False

    # a payment reopens it
    payload = event("invoice.paid", {"customer": "cus_test123"})
    await client.post(
        "/api/billing/webhook", content=payload,
        headers={"stripe-signature": sign(payload)},
    )
    db.expire_all()
    await db.refresh(hotel)
    assert hotel.subscription_status == "active"
    assert hotel.is_active is True


@pytest.mark.asyncio
async def test_checkout_owner_only_and_returns_stripe_url(
    client, make_user, auth_header, monkeypatch
):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_dummy")
    monkeypatch.setattr(settings, "stripe_price_id", "price_dummy")

    async def fake_stripe(method: str, path: str, **form):
        # one fake door: /customers and /checkout/sessions both come through here
        return {"id": "cus_fake", "url": "https://checkout.stripe.com/c/pay/fake"}

    monkeypatch.setattr(billing, "_stripe", fake_stripe)

    staff = await make_user("staff-bill@x.com", Role.STAFF.value)
    denied = await client.post("/api/billing/checkout", headers=auth_header(staff))
    assert denied.status_code == 403

    owner = await make_user("owner-bill@x.com", Role.SUPER_ADMIN.value)
    r = await client.post("/api/billing/checkout", headers=auth_header(owner))
    assert r.status_code == 200
    assert r.json()["url"].startswith("https://checkout.stripe.com/")


@pytest.mark.asyncio
async def test_billing_unconfigured_answers_503(client, make_user, auth_header, monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "")
    owner = await make_user("owner-nobill@x.com", Role.SUPER_ADMIN.value)
    r = await client.post("/api/billing/checkout", headers=auth_header(owner))
    assert r.status_code == 503
