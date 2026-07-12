"""last_login stamping, vendor spend endpoint, Control Room health fields."""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_login_stamps_last_login(client, make_user):
    await make_user("stamp@x.com", Role.STAFF.value)
    r = await client.post("/api/auth/login", json={"email": "stamp@x.com", "password": "password123"})
    assert r.status_code == 200
    assert r.json()["user"]["last_login"] is not None


@pytest.mark.asyncio
async def test_vendor_spend_empty_ok(client, make_user, auth_header):
    mgr = await make_user("spend@x.com", Role.MANAGER.value)
    r = await client.get("/api/vendors/spend?days=90", headers=auth_header(mgr))
    assert r.status_code == 200
    assert r.json() == {"days": 90, "vendors": []}


@pytest.mark.asyncio
async def test_hotel_list_has_health_fields(client, make_user, auth_header, db):
    owner = await make_user("op5@mise.com", Role.SUPER_ADMIN.value)
    owner.is_platform_owner = True
    await db.commit()
    # log the owner in so the hotel has activity
    await client.post("/api/auth/login", json={"email": "op5@mise.com", "password": "password123"})
    r = await client.get("/api/platform/hotels", headers=auth_header(owner))
    assert r.status_code == 200
    h = r.json()["hotels"][0]
    assert "sales_entries_7d" in h and "last_active" in h
    assert h["last_active"] is not None  # the login above stamped it
