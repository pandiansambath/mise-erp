"""Leave, and the two places it must be obeyed.

Recording time off is the easy half. The half that matters is that the rota and
the attendance sheet both act on it, because a leave record nobody consults is
just a note.

These are the two failures this link exists to prevent:

  * the rota promises somebody who is on holiday, and nobody finds out until
    the day they do not arrive
  * the attendance sheet reads a person on booked leave exactly like a person
    who simply did not turn up, so a manager spends the morning chasing them

Only APPROVED leave blocks anything. A request nobody has agreed to is not yet
a fact about the world, and treating it as one would let anybody remove
themselves from the rota by asking.
"""
from datetime import date, time, timedelta

import pytest

from app.auth.models import Role
from app.employees import leave as leave_service
from app.employees.models import Employee, Leave, LeaveStatus
from app.rota.models import Shift

TODAY = date.today()
TOMORROW = TODAY + timedelta(days=1)
NEXT_WEEK = TODAY + timedelta(days=7)


@pytest.fixture
async def chef(db, hotel) -> Employee:
    emp = Employee(
        hotel_id=hotel.id,
        employee_code="E1",
        full_name="Priya Raman",
        job_title="Chef",
        salary_type="MONTHLY",
    )
    db.add(emp)
    await db.commit()
    await db.refresh(emp)
    return emp


@pytest.fixture
async def waiter(db, hotel) -> Employee:
    emp = Employee(
        hotel_id=hotel.id,
        employee_code="E2",
        full_name="Sam Okafor",
        job_title="Waiter",
        salary_type="HOURLY",
    )
    db.add(emp)
    await db.commit()
    await db.refresh(emp)
    return emp


async def _book(db, hotel, employee, start, end, *, status=LeaveStatus.APPROVED.value, kind="SICK"):
    lv = Leave(
        hotel_id=hotel.id,
        employee_id=employee.id,
        start_date=start,
        end_date=end,
        kind=kind,
        status=status,
    )
    db.add(lv)
    await db.commit()
    await db.refresh(lv)
    return lv


async def _rota(db, hotel, employee, day, start=time(9, 0), end=time(17, 0)):
    sh = Shift(
        hotel_id=hotel.id,
        employee_id=employee.id,
        date=day,
        start_time=start,
        end_time=end,
    )
    db.add(sh)
    await db.commit()
    await db.refresh(sh)
    return sh


# ── who is off ────────────────────────────────────────────────────────────


async def test_a_range_covers_every_day_inside_it(db, hotel, chef) -> None:
    """Leave is stored as "the 14th to the 20th", not seven separate facts, so
    the middle of a range must answer as confidently as its edges."""
    await _book(db, hotel, chef, TODAY, TODAY + timedelta(days=6))

    for offset in (0, 1, 3, 6):
        assert chef.id in await leave_service.employee_ids_off(
            db, hotel.id, TODAY + timedelta(days=offset)
        )
    assert chef.id not in await leave_service.employee_ids_off(
        db, hotel.id, TODAY + timedelta(days=7)
    )


async def test_unapproved_leave_blocks_nothing(db, hotel, chef) -> None:
    """Otherwise anybody could take themselves off the rota by asking."""
    await _book(db, hotel, chef, TODAY, TODAY, status=LeaveStatus.PENDING.value)

    assert await leave_service.employee_ids_off(db, hotel.id, TODAY) == set()
    assert await leave_service.is_off(db, hotel.id, chef.id, TODAY) is None
    assert await leave_service.blocking_leave(db, hotel.id, chef.id, TODAY) is None


async def test_one_hotel_cannot_see_another_hotels_leave(db, hotel, chef) -> None:
    """Every question here is hotel-scoped. It is the same tenancy rule as
    everywhere else, and leave is a place it would be easy to forget."""
    from app.hotels.models import Hotel

    other = Hotel(name="Other Place", country="GB", base_currency="GBP", city="Hull")
    db.add(other)
    await db.commit()
    await db.refresh(other)

    await _book(db, hotel, chef, TODAY, TODAY)
    assert await leave_service.employee_ids_off(db, other.id, TODAY) == set()


# ── the rota must not promise someone who is away ─────────────────────────


async def test_the_rota_refuses_to_schedule_somebody_on_leave(
    client, make_user, auth_header, hotel, chef, db
) -> None:
    """The whole point of the link. Refusing here is the difference between the
    app KNOWING about leave and the app USING it."""
    await _book(db, hotel, chef, TOMORROW, TOMORROW, kind="ANNUAL")
    manager = await make_user("mgr@test.com", Role.SUPER_ADMIN.value)

    res = await client.post(
        "/api/rota/shifts",
        json={
            "employee_id": str(chef.id),
            "date": TOMORROW.isoformat(),
            "start_time": "09:00",
            "end_time": "17:00",
        },
        headers=auth_header(manager),
    )
    # 409 Conflict: the request is well-formed, it collides with a fact.
    assert res.status_code == 409
    detail = res.json()["detail"]
    # The message must name the person and say until when — "on leave" alone
    # sends someone hunting through the leave list.
    assert "Priya Raman" in detail
    assert TOMORROW.isoformat() in detail
    assert "annual" in detail.lower()


async def test_a_free_colleague_can_still_be_scheduled(
    client, make_user, auth_header, hotel, chef, waiter, db
) -> None:
    """One person's leave must not make the whole rota unusable."""
    await _book(db, hotel, chef, TOMORROW, TOMORROW)
    manager = await make_user("mgr2@test.com", Role.SUPER_ADMIN.value)

    res = await client.post(
        "/api/rota/shifts",
        json={
            "employee_id": str(waiter.id),
            "date": TOMORROW.isoformat(),
            "start_time": "09:00",
            "end_time": "17:00",
        },
        headers=auth_header(manager),
    )
    assert res.status_code in (200, 201)


async def test_booking_leave_over_a_rota_d_shift_warns_but_does_not_refuse(
    client, make_user, auth_header, hotel, chef, db
) -> None:
    """Plans change, and the leave is the newer decision — so it is allowed.
    But it must be SAID, or the rota keeps showing somebody who is on holiday
    and nobody finds out until the day."""
    await _rota(db, hotel, chef, NEXT_WEEK)
    manager = await make_user("mgr3@test.com", Role.SUPER_ADMIN.value)

    res = await client.post(
        "/api/employees/leave",
        json={
            "employee_id": str(chef.id),
            "start_date": NEXT_WEEK.isoformat(),
            "end_date": NEXT_WEEK.isoformat(),
            "kind": "ANNUAL",
            "status": "APPROVED",
        },
        headers=auth_header(manager),
    )
    assert res.status_code == 201
    body = res.json()
    assert body["warning"] is not None
    assert NEXT_WEEK.isoformat() in body["warning"]
    assert len(body["clashing_shifts"]) == 1


async def test_leave_with_no_clash_says_so_plainly(
    client, make_user, auth_header, hotel, chef
) -> None:
    """A warning that fires every time is a warning nobody reads."""
    manager = await make_user("mgr4@test.com", Role.SUPER_ADMIN.value)
    res = await client.post(
        "/api/employees/leave",
        json={
            "employee_id": str(chef.id),
            "start_date": NEXT_WEEK.isoformat(),
            "end_date": NEXT_WEEK.isoformat(),
            "kind": "SICK",
            "status": "APPROVED",
        },
        headers=auth_header(manager),
    )
    assert res.status_code == 201
    assert res.json()["warning"] is None
    assert res.json()["clashing_shifts"] == []


async def test_leave_ending_before_it_starts_is_refused(
    client, make_user, auth_header, chef
) -> None:
    manager = await make_user("mgr5@test.com", Role.SUPER_ADMIN.value)
    res = await client.post(
        "/api/employees/leave",
        json={
            "employee_id": str(chef.id),
            "start_date": NEXT_WEEK.isoformat(),
            "end_date": TODAY.isoformat(),
            "kind": "SICK",
            "status": "APPROVED",
        },
        headers=auth_header(manager),
    )
    assert res.status_code == 400


# ── the attendance sheet must not call them absent ────────────────────────


async def test_attendance_marks_leave_rather_than_absence(
    client, make_user, auth_header, hotel, chef, db
) -> None:
    """The distinction a manager actually cares about at 09:00: somebody to
    phone, or somebody on holiday."""
    await _book(db, hotel, chef, TODAY, TODAY, kind="SICK")
    manager = await make_user("mgr6@test.com", Role.SUPER_ADMIN.value)

    res = await client.get(
        f"/api/attendance?on={TODAY.isoformat()}", headers=auth_header(manager)
    )
    assert res.status_code == 200
    row = next(r for r in res.json() if r["employee_id"] == str(chef.id))
    assert row["status"] == "LEAVE"
    assert row["on_leave"] is True


async def test_attendance_flags_someone_the_rota_expected_who_never_arrived(
    client, make_user, auth_header, hotel, waiter, db
) -> None:
    """The other half of the link, and the row that needs a phone call. Without
    it the sheet cannot tell "nobody was due" from "somebody did not turn up"
    — completely different mornings."""
    await _rota(db, hotel, waiter, TODAY, start=time(8, 30))
    manager = await make_user("mgr7@test.com", Role.SUPER_ADMIN.value)

    res = await client.get(
        f"/api/attendance?on={TODAY.isoformat()}", headers=auth_header(manager)
    )
    row = next(r for r in res.json() if r["employee_id"] == str(waiter.id))
    assert row["scheduled"] is True
    assert row["missing"] is True
    assert row["scheduled_start"] == "08:30"


async def test_leave_wins_over_a_rota_d_shift_on_the_attendance_sheet(
    client, make_user, auth_header, hotel, chef, db
) -> None:
    """If a shift was rota'd BEFORE the leave was booked, the sheet must read
    leave — not "did not turn up". The leave is the newer decision."""
    await _rota(db, hotel, chef, TODAY)
    await _book(db, hotel, chef, TODAY, TODAY, kind="SICK")
    manager = await make_user("mgr8@test.com", Role.SUPER_ADMIN.value)

    res = await client.get(
        f"/api/attendance?on={TODAY.isoformat()}", headers=auth_header(manager)
    )
    row = next(r for r in res.json() if r["employee_id"] == str(chef.id))
    assert row["status"] == "LEAVE"
    assert not row.get("missing")


async def test_nobody_scheduled_is_not_the_same_as_missing(
    client, make_user, auth_header, hotel, waiter
) -> None:
    """No shift on the rota means there is nothing to chase, and the sheet must
    not imply otherwise."""
    manager = await make_user("mgr9@test.com", Role.SUPER_ADMIN.value)
    res = await client.get(
        f"/api/attendance?on={TODAY.isoformat()}", headers=auth_header(manager)
    )
    row = next(r for r in res.json() if r["employee_id"] == str(waiter.id))
    assert not row.get("missing")
    assert not row.get("scheduled")


async def test_the_earliest_shift_is_the_one_attendance_is_measured_against(
    db, hotel, chef
) -> None:
    """One shift per person per day is the norm, but if there are several,
    lateness has to be judged against the first one."""
    await _rota(db, hotel, chef, TODAY, start=time(17, 0), end=time(23, 0))
    await _rota(db, hotel, chef, TODAY, start=time(9, 0), end=time(13, 0))

    scheduled = await leave_service.scheduled_on(db, hotel.id, TODAY)
    assert scheduled[chef.id].start_time == time(9, 0)


async def test_the_clash_message_names_the_person_and_the_dates(db, hotel, chef) -> None:
    """It is read by whoever is building the rota, mid-task. "On leave" alone
    sends them hunting for until when."""
    await _book(db, hotel, chef, TODAY, TODAY + timedelta(days=3), kind="ANNUAL")

    found = await leave_service.blocking_leave(db, hotel.id, chef.id, TOMORROW)
    assert found is not None
    _, message = found
    assert "Priya Raman" in message
    assert TODAY.isoformat() in message
    assert (TODAY + timedelta(days=3)).isoformat() in message


async def test_a_single_day_of_leave_reads_as_one_date_not_a_range(db, hotel, chef) -> None:
    """"14th to 14th" is how a computer says it, not a person."""
    await _book(db, hotel, chef, TODAY, TODAY)
    found = await leave_service.blocking_leave(db, hotel.id, chef.id, TODAY)
    assert found is not None
    _, message = found
    assert " to " not in message
