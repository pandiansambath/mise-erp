"""Platform announcements (operator broadcast) + hotel suspension."""
import pytest

from app.auth.models import Role


async def _make_owner(make_user, db, email="op2@mise.com"):
    owner = await make_user(email, Role.SUPER_ADMIN.value)
    owner.is_platform_owner = True
    await db.commit()
    await db.refresh(owner)
    return owner


@pytest.mark.asyncio
async def test_announcement_lifecycle(client, make_user, auth_header, db):
    owner = await _make_owner(make_user, db)
    h = auth_header(owner)

    # broadcast
    r = await client.post(
        "/api/platform/announcements", headers=h,
        json={"message": "Maintenance tonight 22:00", "level": "warn"},
    )
    assert r.status_code == 200
    ann_id = r.json()["id"]
    assert r.json()["level"] == "warn"

    # any signed-in user sees it as active (not just operators)
    staff = await make_user("crew@x.com", Role.STAFF.value)
    r = await client.get("/api/platform/announcements/active", headers=auth_header(staff))
    assert r.status_code == 200
    assert any(a["id"] == ann_id for a in r.json()["announcements"])

    # operator history lists it
    r = await client.get("/api/platform/announcements", headers=h)
    assert any(a["id"] == ann_id for a in r.json()["announcements"])

    # withdraw → gone from active
    r = await client.delete(f"/api/platform/announcements/{ann_id}", headers=h)
    assert r.status_code == 200
    r = await client.get("/api/platform/announcements/active", headers=auth_header(staff))
    assert not any(a["id"] == ann_id for a in r.json()["announcements"])


@pytest.mark.asyncio
async def test_announcement_requires_operator(client, make_user, auth_header):
    admin = await make_user("plain@x.com", Role.SUPER_ADMIN.value)  # not platform owner
    r = await client.post(
        "/api/platform/announcements", headers=auth_header(admin),
        json={"message": "nope", "level": "info"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_bad_level_rejected(client, make_user, auth_header, db):
    owner = await _make_owner(make_user, db, email="op3@mise.com")
    r = await client.post(
        "/api/platform/announcements", headers=auth_header(owner),
        json={"message": "hello world", "level": "panic"},
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_suspend_blocks_login_and_reactivate_restores(
    client, make_user, auth_header, db, hotel
):
    owner = await _make_owner(make_user, db, email="op4@mise.com")
    h = auth_header(owner)
    victim = await make_user("locked@x.com", Role.STAFF.value)
    assert victim.hotel_id == hotel.id

    # suspend the hotel → member login is refused with a clear message
    r = await client.post(f"/api/platform/hotels/{hotel.id}/suspend", headers=h, json={"active": False})
    assert r.status_code == 200 and r.json()["is_active"] is False
    r = await client.post("/api/auth/login", json={"email": "locked@x.com", "password": "password123"})
    assert r.status_code == 403
    assert "suspended" in r.json()["detail"].lower()

    # reactivate → login works again
    r = await client.post(f"/api/platform/hotels/{hotel.id}/suspend", headers=h, json={"active": True})
    assert r.status_code == 200 and r.json()["is_active"] is True
    r = await client.post("/api/auth/login", json={"email": "locked@x.com", "password": "password123"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_impersonation_token_is_read_only(client, make_user, auth_header, db, hotel):
    owner = await _make_owner(make_user, db, email="op6@mise.com")
    # the hotel's admin the operator will "view as"
    await make_user("victim-admin@x.com", Role.SUPER_ADMIN.value)

    r = await client.post(
        f"/api/platform/hotels/{hotel.id}/impersonate", headers=auth_header(owner)
    )
    assert r.status_code == 200
    imp = {"Authorization": f"Bearer {r.json()['token']}"}

    # reads work…
    ok = await client.get("/api/inventory/items", headers=imp)
    assert ok.status_code == 200
    # …writes are refused, clearly
    blocked = await client.post(
        "/api/inventory/items",
        headers=imp,
        json={"name": "Nope", "unit": "kg"},
    )
    assert blocked.status_code == 403
    assert "read-only" in blocked.json()["detail"].lower()

    # and the act itself is on the operator audit trail
    trail = await client.get("/api/platform/audit", headers=auth_header(owner))
    assert any(e["action"] == "platform.impersonate" for e in trail.json()["events"])


@pytest.mark.asyncio
async def test_operator_accounts_lifecycle(client, make_user, auth_header, db):
    """An operator can mint a second operator login; deactivating it blocks
    login; you cannot deactivate yourself."""
    boss = await make_user("op-boss@mise.com", Role.SUPER_ADMIN.value)
    boss.is_platform_owner = True
    await db.commit()
    h = auth_header(boss)

    created = await client.post(
        "/api/platform/operators",
        json={"email": "op-two@mise.com", "password": "secret-pass-9"},
        headers=h,
    )
    assert created.status_code == 201

    # the new operator really has platform powers
    login = await client.post(
        "/api/auth/login", json={"email": "op-two@mise.com", "password": "secret-pass-9"}
    )
    assert login.status_code == 200
    tok = login.json()["access_token"]
    fleet = await client.get("/api/platform/hotels", headers={"Authorization": f"Bearer {tok}"})
    assert fleet.status_code == 200

    # deactivate -> login refused; self-deactivation refused
    two_id = created.json()["id"]
    off = await client.patch(f"/api/platform/operators/{two_id}", json={"active": False}, headers=h)
    assert off.status_code == 200 and off.json()["is_active"] is False
    relogin = await client.post(
        "/api/auth/login", json={"email": "op-two@mise.com", "password": "secret-pass-9"}
    )
    assert relogin.status_code in (401, 403)
    me_off = await client.patch(
        f"/api/platform/operators/{boss.id}", json={"active": False}, headers=h
    )
    assert me_off.status_code == 400

    listing = await client.get("/api/platform/operators", headers=h)
    emails = [o["email"] for o in listing.json()["operators"]]
    assert "op-two@mise.com" in emails
