"""Platform Control Room — access control, feature toggles, password reset, and
that turning a feature off actually blocks its endpoints."""
import pytest

from app.auth.models import Role


async def _make_owner(make_user, db, email="op@mise.com"):
    owner = await make_user(email, Role.SUPER_ADMIN.value)
    owner.is_platform_owner = True
    await db.commit()
    await db.refresh(owner)
    return owner


@pytest.mark.asyncio
async def test_non_owner_is_forbidden(client, make_user, auth_header):
    admin = await make_user("normal@x.com", Role.SUPER_ADMIN.value)  # NOT a platform owner
    res = await client.get("/api/platform/hotels", headers=auth_header(admin))
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_owner_lists_hotels_and_features(client, make_user, auth_header, db):
    owner = await _make_owner(make_user, db)
    h = auth_header(owner)

    feats = await client.get("/api/platform/features", headers=h)
    assert feats.status_code == 200
    keys = {f["key"] for f in feats.json()["features"]}
    assert "ai_copilot" in keys

    hotels = await client.get("/api/platform/hotels", headers=h)
    assert hotels.status_code == 200
    rows = hotels.json()["hotels"]
    assert len(rows) >= 1
    row = rows[0]
    assert row["features"]["ai_copilot"] is True  # default on
    assert row["user_count"] >= 1


@pytest.mark.asyncio
async def test_toggle_feature_disables_endpoint(client, make_user, auth_header, db, hotel):
    owner = await _make_owner(make_user, db)
    h = auth_header(owner)

    # A normal user in the same hotel can hit the assistant while AI is ON.
    member = await make_user("cook@x.com", Role.STAFF.value)
    mh = auth_header(member)
    assert (await client.get("/api/assistant/status", headers=mh)).status_code == 200

    # Operator turns AI off for this hotel.
    patch = await client.patch(
        f"/api/platform/hotels/{hotel.id}/features",
        headers=h, json={"features": {"ai_copilot": False}},
    )
    assert patch.status_code == 200
    assert patch.json()["features"]["ai_copilot"] is False

    # Now the assistant is blocked for that hotel.
    assert (await client.get("/api/assistant/status", headers=mh)).status_code == 403

    # Unknown feature key is rejected.
    bad = await client.patch(
        f"/api/platform/hotels/{hotel.id}/features",
        headers=h, json={"features": {"nope": True}},
    )
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_reset_password(client, make_user, auth_header, db, hotel):
    owner = await _make_owner(make_user, db)
    h = auth_header(owner)
    target = await make_user("manager@x.com", Role.MANAGER.value)

    res = await client.post(
        f"/api/platform/hotels/{hotel.id}/reset-password",
        headers=h, json={"user_id": str(target.id), "new_password": "BrandNew123"},
    )
    assert res.status_code == 200 and res.json()["ok"] is True

    # The user can now log in with the new password.
    login = await client.post("/api/auth/login", json={"email": "manager@x.com", "password": "BrandNew123"})
    assert login.status_code == 200
