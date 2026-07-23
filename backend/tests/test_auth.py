"""Auth flow tests: login, token validation, /me."""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_login_success(client, make_user):
    await make_user("owner@nirai.com", Role.SUPER_ADMIN.value, password="password123")
    resp = await client.post(
        "/api/auth/login", json={"email": "owner@nirai.com", "password": "password123"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["user"]["email"] == "owner@nirai.com"
    assert body["user"]["role"] == "SUPER_ADMIN"


@pytest.mark.asyncio
async def test_register_hotel_creates_hotel_and_super_admin(client):
    resp = await client.post(
        "/api/auth/register-hotel",
        json={
            "hotel_name": "Spice Garden",
            "username": "spicegarden",
            "country": "IN",
            "email": "owner@spicegarden.com",
            "password": "StrongPass123",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    # No token until the emailed link is clicked — a signup response with a
    # working token would let anyone skip the verification gate entirely.
    assert "access_token" not in body
    assert body["user"]["role"] == "SUPER_ADMIN"
    assert body["hotel"]["name"] == "Spice Garden"
    assert body["hotel"]["base_currency"] == "INR"  # derived from country
    # their own live subdomain, reserved at signup
    assert body["site_url"].startswith("https://spicegarden.")
    assert body["subdomain"].startswith("spicegarden.")

    # real-email era: login is gated until the emailed link is clicked
    login = await client.post(
        "/api/auth/login",
        json={"email": "owner@spicegarden.com", "password": "StrongPass123"},
    )
    assert login.status_code == 403
    assert "verify" in login.json()["detail"].lower()

    # duplicate email is rejected
    dup = await client.post(
        "/api/auth/register-hotel",
        json={"hotel_name": "X", "username": "xhotel", "country": "GB",
              "email": "owner@spicegarden.com", "password": "StrongPass123"},
    )
    assert dup.status_code == 409

    # username is now mandatory
    missing = await client.post(
        "/api/auth/register-hotel",
        json={"hotel_name": "No Handle", "country": "GB",
              "email": "a@nohandle.com", "password": "StrongPass123"},
    )
    assert missing.status_code == 422

    # duplicate username is rejected
    duph = await client.post(
        "/api/auth/register-hotel",
        json={"hotel_name": "Copy", "username": "spicegarden", "country": "GB",
              "email": "c@copy.com", "password": "StrongPass123"},
    )
    assert duph.status_code == 409


@pytest.mark.asyncio
async def test_login_wrong_password(client, make_user):
    await make_user("owner@nirai.com", Role.SUPER_ADMIN.value, password="password123")
    resp = await client.post(
        "/api/auth/login", json={"email": "owner@nirai.com", "password": "WRONG"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_email(client):
    resp = await client.post(
        "/api/auth/login", json={"email": "ghost@nirai.com", "password": "whatever"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_inactive_user_cannot_login(client, make_user):
    await make_user("ex@nirai.com", Role.STAFF.value, password="password123", is_active=False)
    resp = await client.post(
        "/api/auth/login", json={"email": "ex@nirai.com", "password": "password123"}
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_current_user(client, make_user, auth_header):
    user = await make_user("chef@nirai.com", Role.KITCHEN_MANAGER.value)
    resp = await client.get("/api/auth/me", headers=auth_header(user))
    assert resp.status_code == 200
    body = resp.json()
    assert body["user"]["email"] == "chef@nirai.com"
    assert body["user"]["role"] == "KITCHEN_MANAGER"
    assert body["hotel"]["base_currency"] == "GBP"


@pytest.mark.asyncio
async def test_me_requires_token(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code in (401, 403)  # missing bearer credentials


@pytest.mark.asyncio
async def test_me_rejects_garbage_token(client):
    resp = await client.get("/api/auth/me", headers={"Authorization": "Bearer not.a.jwt"})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_change_password_flow(client, make_user, auth_header):
    user = await make_user("owner@nirai.com", Role.SUPER_ADMIN.value, password="password123")
    h = auth_header(user)

    # wrong current password -> 400
    bad = await client.post(
        "/api/auth/change-password",
        headers=h,
        json={"current_password": "WRONG", "new_password": "newpass456"},
    )
    assert bad.status_code == 400

    # same as current -> 400
    same = await client.post(
        "/api/auth/change-password",
        headers=h,
        json={"current_password": "password123", "new_password": "password123"},
    )
    assert same.status_code == 400

    # correct current -> 204, and the new password works while the old one fails
    ok = await client.post(
        "/api/auth/change-password",
        headers=h,
        json={"current_password": "password123", "new_password": "newpass456"},
    )
    assert ok.status_code == 204

    old = await client.post(
        "/api/auth/login", json={"email": "owner@nirai.com", "password": "password123"}
    )
    assert old.status_code == 401
    new = await client.post(
        "/api/auth/login", json={"email": "owner@nirai.com", "password": "newpass456"}
    )
    assert new.status_code == 200


@pytest.mark.asyncio
async def test_change_password_requires_token(client):
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": "x", "new_password": "newpass456"},
    )
    assert resp.status_code in (401, 403)
