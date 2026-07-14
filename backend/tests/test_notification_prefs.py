"""Settings → Email alerts toggles + email-OTP two-step sign-in."""
import asyncio

import pytest
from sqlalchemy import select

from app.auth.models import Role, User
from app.core import notify


@pytest.mark.asyncio
async def test_prefs_defaults_and_patch(client, make_user, auth_header):
    u = await make_user("prefs@x.com", Role.SUPER_ADMIN.value)
    r = await client.get("/api/auth/me/notifications", headers=auth_header(u))
    assert r.status_code == 200
    body = r.json()
    assert body["prefs"] == notify.ALERT_DEFAULTS
    assert body["twofa_email"] is False

    # flip one off, one on — only overrides are stored, merge comes back whole
    r = await client.patch(
        "/api/auth/me/notifications",
        headers=auth_header(u),
        json={"prefs": {"price_rise": False, "security_login": True}},
    )
    assert r.status_code == 200
    prefs = r.json()["prefs"]
    assert prefs["price_rise"] is False
    assert prefs["security_login"] is True
    assert prefs["job_application"] is True  # untouched default

    # a typo'd key must never be silently accepted
    bad = await client.patch(
        "/api/auth/me/notifications",
        headers=auth_header(u),
        json={"prefs": {"pricerise": True}},
    )
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_twofa_email_flow(client, make_user, auth_header, db):
    u = await make_user("twofa@x.com", Role.SUPER_ADMIN.value)
    r = await client.patch(
        "/api/auth/me/notifications", headers=auth_header(u), json={"twofa_email": True}
    )
    assert r.status_code == 200 and r.json()["twofa_email"] is True

    # password step no longer opens the door — it sends a code instead
    step1 = await client.post(
        "/api/auth/login", json={"email": "twofa@x.com", "password": "password123"}
    )
    assert step1.status_code == 200
    assert step1.json() == {"twofa_required": True}
    assert "access_token" not in step1.json()

    user = (await db.execute(select(User).where(User.email == "twofa@x.com"))).scalar_one()
    assert user.otp_code and len(user.otp_code) == 6

    wrong = await client.post(
        "/api/auth/login-otp", json={"email": "twofa@x.com", "code": "000000"}
    )
    # (1-in-a-million chance the random code IS 000000 — regenerate would be flaky-proof,
    # but the assert below re-reads the real code anyway)
    if user.otp_code != "000000":
        assert wrong.status_code == 401

    await db.refresh(user)
    ok = await client.post(
        "/api/auth/login-otp", json={"email": "twofa@x.com", "code": user.otp_code}
    )
    assert ok.status_code == 200
    assert ok.json()["access_token"]

    # code is burned after use
    replay = await client.post(
        "/api/auth/login-otp", json={"email": "twofa@x.com", "code": user.otp_code}
    )
    assert replay.status_code == 401

    # switching 2FA off clears any pending state and login is single-step again
    await client.patch(
        "/api/auth/me/notifications", headers=auth_header(u), json={"twofa_email": False}
    )
    direct = await client.post(
        "/api/auth/login", json={"email": "twofa@x.com", "password": "password123"}
    )
    assert direct.status_code == 200 and direct.json()["access_token"]


@pytest.mark.asyncio
async def test_twofa_code_burns_after_five_wrong_guesses(client, make_user, auth_header, db):
    u = await make_user("burn@x.com", Role.MANAGER.value)
    await client.patch(
        "/api/auth/me/notifications", headers=auth_header(u), json={"twofa_email": True}
    )
    await client.post("/api/auth/login", json={"email": "burn@x.com", "password": "password123"})
    user = (await db.execute(select(User).where(User.email == "burn@x.com"))).scalar_one()
    real_code = user.otp_code
    guess = "000000" if real_code != "000000" else "999999"
    for _ in range(5):
        r = await client.post("/api/auth/login-otp", json={"email": "burn@x.com", "code": guess})
        assert r.status_code == 401
    # even the REAL code is dead now — brute force can't win
    dead = await client.post(
        "/api/auth/login-otp", json={"email": "burn@x.com", "code": real_code}
    )
    assert dead.status_code == 401


@pytest.mark.asyncio
async def test_job_application_email_respects_toggle(
    client, make_user, auth_header, monkeypatch
):
    sent: list[tuple[str, str]] = []

    async def fake_send(to, subject, text, html=None):
        sent.append((to, subject))
        return True

    monkeypatch.setattr(notify, "send_email", fake_send)

    admin = await make_user("hire-admin@x.com", Role.SUPER_ADMIN.value)
    posting = await client.post(
        "/api/jobs",
        headers=auth_header(admin),
        json={"title": "Sous Chef", "employment_type": "FULL_TIME", "description": "Cook."},
    )
    assert posting.status_code in (200, 201)
    pid = posting.json()["id"]

    apply1 = await client.post(
        f"/api/public/jobs/{pid}/apply",
        data={"applicant_name": "Asha Kumar", "email": "asha@applicant.com"},
    )
    assert apply1.status_code == 201
    await asyncio.sleep(0.05)  # let the fire-and-forget task run
    assert any(to == "hire-admin@x.com" and "Sous Chef" in subj for to, subj in sent)

    # toggle OFF → the next applicant stays silent
    sent.clear()
    await client.patch(
        "/api/auth/me/notifications",
        headers=auth_header(admin),
        json={"prefs": {"job_application": False}},
    )
    apply2 = await client.post(
        f"/api/public/jobs/{pid}/apply",
        data={"applicant_name": "Ben Ody", "email": "ben@applicant.com"},
    )
    assert apply2.status_code == 201
    await asyncio.sleep(0.05)
    assert sent == []
