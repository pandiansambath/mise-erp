"""What a staff login gets BY DEFAULT: their own rota and their own attendance
history, scoped to them and nobody else.

    "by default these 2 i need -> their attendance, their rota, their documents.
     only that particular staff attendance and rota and doc we need to show.
     attendance we need historical data too, i mean he can use filter to go back
     and check attendance and hours etc. likewise rota too."

The scoping test is the one that matters. A self-service endpoint that returns
the right shape while leaking a colleague's shifts is worse than one that
errors, so there are two employees in every fixture here and the assertions name
the one that must NOT appear.
"""
from datetime import date, time
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.employees import service
from app.rota import service as rota_service


async def _linked_staff(db, hotel, make_user, email="rota-staff@nirai.com", name="Selvi"):
    staff = await make_user(email, Role.STAFF.value)
    emp = await service.create_employee(
        db, hotel.id, full_name=name, salary_type="HOURLY", hourly_rate=Decimal("10.00")
    )
    await service.update_employee(db, emp, user_id=staff.id)
    return staff, emp


@pytest.mark.asyncio
async def test_my_rota_is_only_mine(client, make_user, auth_header, db, hotel):
    staff, emp = await _linked_staff(db, hotel, make_user)
    other = await service.create_employee(db, hotel.id, full_name="Someone Else")

    await rota_service.create_shift(
        db, hotel.id, employee_id=emp.id, date=date(2026, 6, 15),
        start_time=time(9, 0), end_time=time(17, 0),
    )
    await rota_service.create_shift(
        db, hotel.id, employee_id=other.id, date=date(2026, 6, 15),
        start_time=time(10, 0), end_time=time(18, 0),
    )

    r = await client.get(
        "/api/me/rota?date_from=2026-06-01&date_to=2026-06-30", headers=auth_header(staff)
    )
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1, "a staff login must not see the whole team's rota"
    assert rows[0]["employee_name"] == "Selvi"
    assert all(x["employee_name"] != "Someone Else" for x in rows)
    # The figure the page shows has to survive response_model, which drops any
    # field the schema does not declare. It has cost this project four already.
    assert float(rows[0]["hours"]) == 8.0


@pytest.mark.asyncio
async def test_my_rota_defaults_to_a_window_around_today(client, make_user, auth_header, db, hotel):
    """No dates given = last week through the next four, because "when am I next
    on" is the question being asked."""
    staff, emp = await _linked_staff(db, hotel, make_user, email="rota-default@nirai.com")
    await rota_service.create_shift(
        db, hotel.id, employee_id=emp.id, date=date.today(),
        start_time=time(9, 0), end_time=time(13, 0),
    )
    r = await client.get("/api/me/rota", headers=auth_header(staff))
    assert r.status_code == 200
    assert len(r.json()) == 1


@pytest.mark.asyncio
async def test_my_attendance_history_totals_the_hours(client, make_user, auth_header, db, hotel):
    staff, emp = await _linked_staff(db, hotel, make_user, email="att-hist@nirai.com")
    await service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    await service.set_attendance(db, emp, date(2026, 6, 3), status="ABSENT")

    r = await client.get(
        "/api/me/attendance/history?date_from=2026-06-01&date_to=2026-06-30",
        headers=auth_header(staff),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["date_from"] == "2026-06-01"
    assert body["date_to"] == "2026-06-30"
    # Every one of these is declared on the schema on purpose - see the note on
    # MyAttendanceHistory.
    assert body["totals"]["present"] == 1
    assert body["totals"]["absent"] == 1
    assert "total_hours" in body["totals"]
    assert len(body["days"]) == 2


@pytest.mark.asyncio
async def test_my_attendance_history_range_excludes_outside_days(
    client, make_user, auth_header, db, hotel
):
    """The filter has to actually filter — "he can use filter to go back"."""
    staff, emp = await _linked_staff(db, hotel, make_user, email="att-range@nirai.com")
    await service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    await service.set_attendance(db, emp, date(2026, 7, 20), status="PRESENT")

    june = (
        await client.get(
            "/api/me/attendance/history?date_from=2026-06-01&date_to=2026-06-30",
            headers=auth_header(staff),
        )
    ).json()
    assert len(june["days"]) == 1
    assert june["days"][0]["date"] == "2026-06-02"


@pytest.mark.asyncio
async def test_self_service_needs_a_linked_employee(client, make_user, auth_header):
    """An unlinked login gets a plain 404 telling them what to ask for, not a
    500 and not somebody else's data."""
    nobody = await make_user("no-emp@nirai.com", Role.STAFF.value)
    h = auth_header(nobody)
    assert (await client.get("/api/me/rota", headers=h)).status_code == 404
    assert (await client.get("/api/me/attendance/history", headers=h)).status_code == 404
