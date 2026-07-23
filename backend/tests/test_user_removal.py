"""Permanent login removal (Super-Admin only) — anonymise + tombstone, keep history."""
import pytest

from app.auth.models import Role
from app.auth.service import get_user_by_id


@pytest.mark.asyncio
async def test_permanent_removal_tombstones_and_gates(client, make_user, auth_header, db):
    admin = await make_user("boss@x.com", Role.SUPER_ADMIN.value)
    hid = admin.hotel_id
    admin2 = await make_user("boss2@x.com", Role.SUPER_ADMIN.value, hotel_id=hid)
    staff = await make_user("temp@x.com", Role.STAFF.value, hotel_id=hid)
    mgr = await make_user("mgr@x.com", Role.MANAGER.value, hotel_id=hid)
    ha = auth_header(admin)
    staff_id = staff.id
    admin2_id = admin2.id

    # a non-super-admin cannot permanently remove anyone
    r = await client.delete(f"/api/auth/users/{staff_id}", headers=auth_header(mgr))
    assert r.status_code == 403

    # can't remove your own account
    r = await client.delete(f"/api/auth/users/{admin.id}", headers=ha)
    assert r.status_code == 400

    # super admin removes the staff login
    r = await client.delete(f"/api/auth/users/{staff_id}", headers=ha)
    assert r.status_code == 200 and r.json()["email"] == "temp@x.com"

    # gone from the roster …
    roster = (await client.get("/api/auth/users", headers=ha)).json()
    assert all(u["id"] != str(staff_id) for u in roster)

    # … but the row survives as an anonymised tombstone (history still resolves)
    db.expire_all()
    ghost = await get_user_by_id(db, staff_id)
    assert ghost is not None
    assert ghost.deleted_at is not None
    assert ghost.email != "temp@x.com"
    assert ghost.preferred_name == "Removed user"
    assert ghost.is_active is False

    # removing an already-removed login → 404
    r = await client.delete(f"/api/auth/users/{staff_id}", headers=ha)
    assert r.status_code == 404

    # removing a second Super Admin is allowed (one still remains)
    r = await client.delete(f"/api/auth/users/{admin2_id}", headers=ha)
    assert r.status_code == 200
