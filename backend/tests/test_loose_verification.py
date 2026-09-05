"""Verification is a wall for exactly one case now, and a pause for everyone else.

    "instead of this we need to make loose — let them enter, then verify the mail
     id. if they not verified mail id then don't allow them to use forget
     password or alerts, these are all paused until email id is verified...
     implement this loose for all logins EXCEPT the new hotel registration login."

Both halves are asserted, because loosening a gate is exactly the kind of change
that is easy to over-apply: staff must get in, the hotel owner must not, and an
unverified address must never become a way back into an account.
"""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_unverified_staff_can_sign_in(client, db, make_user, hotel):
    """The loosening. A mistyped address used to lock someone out of a system
    their manager had already set up for them, with nobody able to let them in."""
    from app.auth.service import create_user

    u = await create_user(db, "loose-staff@nirai.com", "StaffPass123", Role.STAFF.value, hotel.id)
    u.email_verified = False
    u.verify_required = False
    await db.commit()

    r = await client.post(
        "/api/auth/login", json={"email": "loose-staff@nirai.com", "password": "StaffPass123"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email_verified"] is False


@pytest.mark.asyncio
async def test_a_new_hotel_owner_still_has_to_verify(client, db, make_user, hotel):
    """The exception he was explicit about: the welcome mail, the billing and
    the only route back into the account all hang off this address."""
    from app.auth.service import create_user

    u = await create_user(db, "owner@nirai.com", "OwnerPass123", Role.SUPER_ADMIN.value, hotel.id)
    u.email_verified = False
    u.verify_required = True
    await db.commit()

    r = await client.post(
        "/api/auth/login", json={"email": "owner@nirai.com", "password": "OwnerPass123"}
    )
    assert r.status_code == 403
    assert "verify" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_registration_marks_the_owner_as_must_verify(client, db):
    """Set at the one place it should be set, and nowhere else."""
    from sqlalchemy import select

    from app.auth.models import User

    r = await client.post(
        "/api/auth/register-hotel",
        json={
            "hotel_name": "Verify Test Kitchen",
            "username": "verifytestkitchen",
            "email": "newowner@nirai.com",
            "password": "OwnerPass123",
            "country": "GB",
        },
    )
    assert r.status_code == 201, r.text
    owner = (
        await db.execute(select(User).where(User.email == "newowner@nirai.com"))
    ).scalar_one()
    assert owner.verify_required is True
    assert owner.email_verified is False


@pytest.mark.asyncio
async def test_password_reset_is_paused_until_verified(client, db, hotel):
    """The pause that makes the loosening safe.

    Letting an unproven address request a reset link turns a typo into a way
    into someone else's account. The endpoint still answers OK either way, so
    this leaks nothing about who exists — the proof is that no token is minted.
    """
    from app.auth.service import create_user

    u = await create_user(db, "noreset@nirai.com", "Pass12345", Role.STAFF.value, hotel.id)
    u.email_verified = False
    u.verify_required = False
    await db.commit()
    email = u.email

    r = await client.post("/api/auth/forgot-password", json={"email": email})
    assert r.status_code == 200, "the response must not reveal whether the account exists"
    await db.refresh(u)
    assert u.reset_token is None, "an unverified address must not get a reset link"

    # Verified, the same request works.
    u.email_verified = True
    await db.commit()
    await client.post("/api/auth/forgot-password", json={"email": email})
    await db.refresh(u)
    assert u.reset_token is not None
