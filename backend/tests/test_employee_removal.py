"""Suspend and permanently remove an employee — and the ASYMMETRY between the
two pages, which is the part that is easy to get backwards.

    "if we remove from employee then role's page need to catch that, but if we
     remove from staff, employee don't catch. keep in mind."

A person can exist without an account; an account cannot exist without a
person. So removal cascades one way only, and both directions are asserted here
because getting it wrong in either direction destroys something silently.
"""
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.employees import service


async def _staff_with_login(client, db, hotel, make_user, auth_header, email, name):
    """An employee WITH a linked login, made the way the app makes one."""
    admin = await make_user(f"admin-{email}", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    emp = await service.create_employee(
        db, hotel.id, full_name=name, salary_type="HOURLY", hourly_rate=Decimal("10.00")
    )
    r = await client.post(
        f"/api/employees/{emp.id}/account",
        headers=h,
        json={"email": email, "password": "StaffPass123", "role": "STAFF"},
    )
    assert r.status_code in (200, 201), r.text
    await db.refresh(emp)
    return admin, h, emp


@pytest.mark.asyncio
async def test_removing_the_employee_takes_the_login_with_it(
    client, db, hotel, make_user, auth_header
):
    admin, h, emp = await _staff_with_login(
        client, db, hotel, make_user, auth_header, "gone@nirai.com", "Goes Away"
    )
    assert emp.user_id is not None

    r = await client.delete(f"/api/employees/{emp.id}", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["removed"] is True

    # The employee is gone...
    assert (await client.get(f"/api/employees/{emp.id}", headers=h)).status_code == 404
    # ...and so is the ability to sign in with that address.
    login = await client.post(
        "/api/auth/login", json={"email": "gone@nirai.com", "password": "StaffPass123"}
    )
    assert login.status_code != 200


@pytest.mark.asyncio
async def test_removing_the_login_leaves_the_employee(
    client, db, hotel, make_user, auth_header
):
    """The other direction, which must NOT cascade."""
    admin, h, emp = await _staff_with_login(
        client, db, hotel, make_user, auth_header, "stays@nirai.com", "Stays Put"
    )
    user_id = emp.user_id

    r = await client.delete(f"/api/auth/users/{user_id}", headers=h)
    assert r.status_code == 200, r.text

    still_there = await client.get(f"/api/employees/{emp.id}", headers=h)
    assert still_there.status_code == 200, "removing a login must not remove the person"
    assert still_there.json()["full_name"] == "Stays Put"


@pytest.mark.asyncio
async def test_suspended_employees_can_be_found_again(
    client, db, hotel, make_user, auth_header
):
    """Suspension has to be reversible from the page that does it.

    The roster is active-only, so without include_suspended a suspended person
    vanished from the ONE screen that could bring them back — a one-way door
    wearing a two-way label.
    """
    admin = await make_user("roster@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    emp = await service.create_employee(db, hotel.id, full_name="Parked Person")

    await client.patch(f"/api/employees/{emp.id}", headers=h, json={"is_active": False})

    names = [e["full_name"] for e in (await client.get("/api/employees", headers=h)).json()]
    assert "Parked Person" not in names

    with_them = await client.get("/api/employees?include_suspended=true", headers=h)
    assert "Parked Person" in [e["full_name"] for e in with_them.json()]

    # And back onto the roster.
    await client.patch(f"/api/employees/{emp.id}", headers=h, json={"is_active": True})
    back = [e["full_name"] for e in (await client.get("/api/employees", headers=h)).json()]
    assert "Parked Person" in back


@pytest.mark.asyncio
async def test_impact_counts_what_removal_would_destroy(
    client, db, hotel, make_user, auth_header
):
    """The confirmation reads these numbers out, so they have to be real."""
    from datetime import date

    admin = await make_user("impact@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    emp = await service.create_employee(db, hotel.id, full_name="Has History")
    await service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    await service.set_attendance(db, emp, date(2026, 6, 3), status="PRESENT")

    r = await client.get(f"/api/employees/{emp.id}/impact", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["attendance"] == 2
    # Named explicitly rather than counted on a column that does not exist —
    # documents link by (related_entity_type, related_entity_id), not employee_id.
    for key in ("payslips", "documents", "shifts", "leaves", "advances", "requests"):
        assert key in body, f"{key} missing from the impact report"
        assert isinstance(body[key], int)


@pytest.mark.asyncio
async def test_only_a_super_admin_can_permanently_remove(
    client, db, hotel, make_user, auth_header
):
    manager = await make_user("mgr-remove@nirai.com", Role.MANAGER.value)
    emp = await service.create_employee(db, hotel.id, full_name="Protected")
    r = await client.delete(f"/api/employees/{emp.id}", headers=auth_header(manager))
    assert r.status_code == 403
    assert "suspend" in r.json()["detail"].lower()
