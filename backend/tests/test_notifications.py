"""Notifications endpoint — returns alerts + a permission-filtered activity feed
built from the audit log."""
import pytest

from app.audit import service as audit_service
from app.auth.models import Role


@pytest.mark.asyncio
async def test_notifications_shape_and_activity(client, make_user, auth_header, db, hotel):
    admin = await make_user("bell@x.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)

    # An expense audit event should surface in the activity feed.
    await audit_service.record(
        db, hotel_id=hotel.id, user=admin,
        action="expense.add", summary="Added Gas £150.00", entity_type="expense",
    )

    res = await client.get("/api/notifications", headers=h)
    assert res.status_code == 200
    data = res.json()
    assert "alerts" in data and "activity" in data and "count" in data

    titles = [a["title"] for a in data["activity"]]
    assert "Expense added" in titles
    ev = next(a for a in data["activity"] if a["title"] == "Expense added")
    assert ev["route"] == "/expenses" and ev["at"] and ev["icon"]


@pytest.mark.asyncio
async def test_activity_is_permission_filtered(client, make_user, auth_header, db, hotel):
    """General staff (no expenses:read) must not see expense activity."""
    cook = await make_user("cook@x.com", Role.STAFF.value)
    h = auth_header(cook)

    await audit_service.record(
        db, hotel_id=hotel.id, user=cook,
        action="expense.add", summary="Added Gas £150.00", entity_type="expense",
    )

    res = await client.get("/api/notifications", headers=h)
    assert res.status_code == 200
    titles = [a["title"] for a in res.json()["activity"]]
    assert "Expense added" not in titles
