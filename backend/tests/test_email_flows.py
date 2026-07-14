"""Real-email era: signup verification gate + forgot/reset password."""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_signup_requires_verification_then_link_opens_the_app(client, db):
    r = await client.post(
        "/api/auth/register-hotel",
        json={
            "hotel_name": "Verify Palace",
            "email": "owner@verifypalace.com",
            "password": "password123",
            "country": "GB",
            "base_currency": "GBP",
        },
    )
    assert r.status_code == 201

    # unverified -> login is refused with a verify-first message
    blocked = await client.post(
        "/api/auth/login", json={"email": "owner@verifypalace.com", "password": "password123"}
    )
    assert blocked.status_code == 403
    assert "verify" in blocked.json()["detail"].lower()

    # grab the token the email would carry, straight from the DB
    from sqlalchemy import select

    from app.auth.models import User

    user = (
        await db.execute(select(User).where(User.email == "owner@verifypalace.com"))
    ).scalar_one()
    assert user.email_verified is False and user.verify_token

    # bad token bounces; the real one verifies AND signs them in
    bad = await client.post("/api/auth/verify-email", json={"token": "x" * 32})
    assert bad.status_code == 400
    ok = await client.post("/api/auth/verify-email", json={"token": user.verify_token})
    assert ok.status_code == 200
    assert ok.json()["access_token"]

    relogin = await client.post(
        "/api/auth/login", json={"email": "owner@verifypalace.com", "password": "password123"}
    )
    assert relogin.status_code == 200


@pytest.mark.asyncio
async def test_grandfathered_users_login_unchanged(client, make_user):
    """Accounts made before the email era (fixtures create them verified=False by
    default column, but the migration grandfathers real rows — the fixture path
    must behave like a grandfathered user)."""
    u = await make_user("old-timer@x.com", Role.MANAGER.value)
    u.email_verified = True  # what the migration did to every existing row
    r = await client.post(
        "/api/auth/login", json={"email": "old-timer@x.com", "password": "password123"}
    )
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_forgot_and_reset_password(client, make_user, db):
    u = await make_user("forgetful@x.com", Role.MANAGER.value)
    u.email_verified = True
    await db.commit()

    # always-200 (no account enumeration), token lands on the user
    r = await client.post("/api/auth/forgot-password", json={"email": "forgetful@x.com"})
    assert r.status_code == 200
    await db.refresh(u)
    assert u.reset_token and u.reset_expires

    # too-short password refused; proper reset works and old password dies
    weak = await client.post(
        "/api/auth/reset-password", json={"token": u.reset_token, "password": "short"}
    )
    assert weak.status_code == 422
    ok = await client.post(
        "/api/auth/reset-password", json={"token": u.reset_token, "password": "brand-new-pass-1"}
    )
    assert ok.status_code == 200

    old = await client.post(
        "/api/auth/login", json={"email": "forgetful@x.com", "password": "password123"}
    )
    assert old.status_code == 401
    fresh = await client.post(
        "/api/auth/login", json={"email": "forgetful@x.com", "password": "brand-new-pass-1"}
    )
    assert fresh.status_code == 200

    # unknown emails still answer 200 — nothing to enumerate
    ghost = await client.post("/api/auth/forgot-password", json={"email": "nobody@x.com"})
    assert ghost.status_code == 200
