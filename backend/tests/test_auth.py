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
