"""Payroll runs: any dates, any people, and money only when it is paid.

    "When i give approve.. it appearing in expenses... why.... still we didn't
     click mark as paid button.. then what's the use of mark as paid button.
     ...also we need recall button to remove all traces for safety like by
     mistake we did payroll... custom date i can pick and then i can pick for
     whom and all"

The rules these hold, in the order a restaurant meets them: what a day comes to,
which days are in, that nobody is paid twice, that approving costs nothing, that
paying costs it exactly once, and that a recall leaves one line and no more.
"""
import asyncio
import csv
import io
from datetime import UTC, date, datetime, time
from decimal import Decimal as D
from fractions import Fraction

import pytest
from sqlalchemy import func, select

from app.audit.models import AuditEvent
from app.auth.models import Role
from app.employees import service as es
from app.employees.models import Attendance
from app.expenses.models import Expense, ExpenseCategory
from app.hotels.models import Hotel
from app.notifications.models import NotificationState
from app.payroll import calculator, periods, runs
from app.payroll.models import (
    ParkedWage,
    Payroll,
    PayrollAdjustment,
    PayrollAdvanceRecovery,
    PayrollDay,
    PayrollRun,
    SalaryAdvance,
)
from app.rota.models import Shift

pytestmark = pytest.mark.asyncio


# ── a restaurant to pay ──────────────────────────────────────────────────────
async def hourly(db, hotel, name="Hana", rate="12.00", **more):
    return await es.create_employee(
        db, hotel.id, full_name=name, salary_type="HOURLY",
        hourly_rate=D(rate) if rate else None, **more,
    )


async def salaried(db, hotel, name="Sam", salary="2600", **more):
    return await es.create_employee(
        db, hotel.id, full_name=name, salary_type="MONTHLY",
        monthly_salary=D(salary) if salary else None, **more,
    )


async def worked(db, emp, *days, hours="8", status="PRESENT"):
    for d in days:
        await es.set_attendance(db, emp, d, status=status, working_hours_value=D(hours))


def nov(d: int) -> date:
    return date(2026, 11, d)


def ask(frm, to, *people, **more) -> dict:
    return {
        "date_from": frm.isoformat(),
        "date_to": to.isoformat(),
        "people": [p if isinstance(p, dict) else {"employee_id": str(p.id)} for p in people],
        **more,
    }


def about(emp, **more) -> dict:
    return {"employee_id": str(emp.id), **more}


@pytest.fixture
async def boss(make_user, auth_header):
    return auth_header(await make_user("boss@runs.test", Role.SUPER_ADMIN.value))


async def make(client, h, *args, **more) -> dict:
    r = await client.post("/api/payroll/runs", headers=h, json=ask(*args, **more))
    assert r.status_code == 201, r.text
    return r.json()


async def look(client, h, *args, **more) -> dict:
    r = await client.post("/api/payroll/runs/preview", headers=h, json=ask(*args, **more))
    assert r.status_code == 200, r.text
    return r.json()


def who(body, emp) -> dict:
    return next(p for p in body["people"] if p["employee_id"] == str(emp.id))


async def do(client, h, run, verb, **body):
    return await client.post(f"/api/payroll/runs/{run['id']}/{verb}", headers=h, json=body)


async def pay(client, h, run, **more):
    body = {"paid_on": "2026-11-20", "method": "BANK", **more}
    return await client.post(f"/api/payroll/runs/{run['id']}/pay", headers=h, json=body)


async def wages(db, hotel_id) -> list[Expense]:
    # Not `expire_all`: that would expire `hotel` and everybody in it as well.
    rows = await db.execute(
        select(Expense).join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
        .where(Expense.hotel_id == hotel_id, ExpenseCategory.name == "Staff Salaries")
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars())


async def count(db, model, **where) -> int:
    q = select(func.count()).select_from(model)
    for k, v in where.items():
        q = q.where(getattr(model, k) == v)
    return await db.scalar(q)


# ── the sums ─────────────────────────────────────────────────────────────────
async def test_minutes_come_back_exactly_from_stored_hours():
    """Hours are kept to two places; every whole minute survives the trip."""
    for m in range(0, 16 * 60 + 1):
        stored = (D(m) / 60).quantize(D("0.01"))
        assert calculator.to_minutes(stored) == m


async def test_seven_hours_twenty_at_twelve_pounds_is_eighty_eight():
    # 7.33 h × £12 was £87.96: 4p short, every time anybody worked 20 past.
    assert calculator.hourly_day(440, D("12.00")) == D("88.00")


@pytest.mark.parametrize("salary", ["3000", "2600", "1999.99", "0.01", "2345.67"])
@pytest.mark.parametrize("days", [1, 7, 22, 26, 31])
async def test_day_lines_always_add_up_to_the_whole(salary, days):
    lines = calculator.spread([Fraction(D(salary)) / days] * days)
    assert sum(lines) == D(salary)
    assert max(lines) - min(lines) <= D("0.01")


async def test_a_whole_month_of_salary_is_the_salary_and_a_month_end_is_split(
    client, boss, db, hotel
):
    sam = await salaried(db, hotel, salary="3000")
    whole = who(await look(client, boss, nov(1), nov(30), sam, basis="SALARY"), sam)
    assert whole["net"] == "3000.00"
    # Three days of October at 31sts and four of November at 30ths.
    body = await look(
        client, boss, date(2026, 10, 29), nov(4), sam, basis="SALARY",
        detail=[str(sam.id)],
    )
    part = who(body, sam)
    exact = Fraction(3000) * 3 / 31 + Fraction(3000) * 4 / 30
    assert part["net"] == str(calculator.pounds(calculator.pence(exact)))
    assert sum(D(d["amount"]) for d in part["day_lines"]) == D(part["net"])
    assert body["label"] == "29 Oct to 4 Nov 2026"


async def test_somebody_who_joined_part_way_is_shared_out_from_that_day(
    client, boss, db, hotel
):
    sam = await salaried(db, hotel, salary="3000", joining_date=nov(16))
    p = who(
        await look(client, boss, nov(1), nov(30), sam, basis="SALARY", detail=[str(sam.id)]),
        sam,
    )
    assert p["net"] == "1500.00"  # 15 of 30 days
    early = next(d for d in p["day_lines"] if d["date"] == "2026-11-15")
    assert early["include"] is False and "before they joined" in early["why"]


async def test_hourly_days_are_the_minutes_worked_at_the_rate(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2), hours="7.33")
    await worked(db, hana, nov(3), hours="8")
    p = who(await look(client, boss, nov(1), nov(7), hana, detail=[str(hana.id)]), hana)
    assert p["minutes"] == 440 + 480
    assert p["net"] == "184.00"
    assert [d["amount"] for d in p["day_lines"] if d["include"]] == ["88.00", "96.00"]


async def test_salaried_staff_are_paid_for_the_days_they_came_in(client, boss, db, hotel):
    sam = await salaried(db, hotel, salary="2600")
    await worked(db, sam, nov(2), nov(3))
    await worked(db, sam, nov(4), hours="4", status="HALF_DAY")
    await worked(db, sam, nov(5), hours="0", status="ABSENT")
    p = who(await look(client, boss, nov(1), nov(30), sam), sam)
    assert (p["days"], p["half_days"]) == (2, 1)
    assert p["net"] == "250.00"  # 2½ days of £100


async def test_a_salaried_day_put_in_by_hand_is_a_day(client, boss, db, hotel):
    sam = await salaried(db, hotel, salary="2600")
    await worked(db, sam, nov(2), hours="0", status="ABSENT")
    for said, net in (
        ({"include": True}, "100.00"), ({"half_days": 1}, "50.00"), ({"half_days": 0}, "0.00"),
    ):
        p = who(await look(
            client, boss, nov(2), nov(2), about(sam, days=[{"date": "2026-11-02", **said}])
        ), sam)
        assert p["net"] == net


async def test_salaried_overtime_is_time_and_a_half_past_eight_hours(client, boss, db, hotel):
    sam = await salaried(db, hotel, salary="2600")
    await worked(db, sam, nov(2), hours="10")
    p = who(await look(client, boss, nov(2), nov(2), sam), sam)
    assert p["overtime"] == "37.50"  # 2h × £12.50 × 1.5
    assert p["pay"] == "137.50"


# ── which dates ──────────────────────────────────────────────────────────────
async def test_one_single_day(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2), nov(3), nov(4))
    run = await make(client, boss, nov(3), nov(3), hana)
    assert run["label"] == "3 Nov 2026" and run["net"] == "96.00"
    days = (await db.execute(select(PayrollDay.date))).scalars().all()
    assert days == [nov(3)]


async def test_single_days_out_of_a_stretch(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2), nov(3), nov(4), nov(9))
    run = await make(
        client, boss, nov(2), nov(9), hana,
        only_dates=["2026-11-02", "2026-11-09"],
    )
    assert run["net"] == "192.00"
    # The days between are still owed.
    left = who(await look(client, boss, nov(1), nov(30), hana), hana)
    assert left["net"] == "192.00" and left["in_run_days"] == 2


async def test_dates_across_the_end_of_a_month(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, date(2026, 10, 31), nov(1))
    run = await make(client, boss, date(2026, 10, 28), nov(3), hana)
    assert run["net"] == "192.00" and run["label"] == "28 Oct to 3 Nov 2026"


async def test_dates_that_make_no_sense_are_refused_in_words(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    for frm, to, words in (
        (nov(9), nov(2), "end before they start"),
        (date(2026, 1, 1), nov(2), "three months"),
    ):
        r = await client.post("/api/payroll/runs/preview", headers=boss, json=ask(frm, to, hana))
        assert r.status_code == 400 and words in r.json()["detail"]
    r = await client.post(
        "/api/payroll/runs/preview", headers=boss,
        json=ask(nov(2), nov(3), hana, only_dates=["2026-11-20"]),
    )
    assert r.status_code == 400


async def test_a_night_shift_belongs_to_the_day_it_started(client, boss, db, hotel):
    """18:00 to 02:00, through the manager's own edit: eight hours, on the 2nd."""
    hana = await hourly(db, hotel)
    await es.edit_attendance(
        db, hana, nov(2), "GB", clock_in="18:00", clock_out="02:00", break_minutes=0
    )
    run = await make(client, boss, nov(2), nov(2), hana)
    assert run["net"] == "96.00"
    assert who(await look(client, boss, nov(3), nov(3), hana), hana)["net"] == "0.00"


async def test_the_night_the_clocks_go_back_is_an_hour_longer(client, boss, db, hotel):
    """25 October 2026: 22:00 to 06:00 is nine hours, worked or planned."""
    hana = await hourly(db, hotel)
    night = date(2026, 10, 24)
    await es.edit_attendance(
        db, hana, night, "GB", clock_in="22:00", clock_out="06:00", break_minutes=0
    )
    db.add(Shift(
        hotel_id=hotel.id, employee_id=hana.id, date=night,
        start_time=time(22, 0), end_time=time(6, 0),
    ))
    await db.commit()
    assert who(await look(client, boss, night, night, hana), hana)["minutes"] == 540
    assert who(await look(client, boss, night, night, hana, basis="ROTA"), hana)["minutes"] == 540


async def test_the_night_the_clocks_go_forward_is_an_hour_shorter(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    night = date(2026, 3, 28)
    db.add(Shift(
        hotel_id=hotel.id, employee_id=hana.id, date=night,
        start_time=time(22, 0), end_time=time(6, 0), break_minutes=30,
    ))
    await db.commit()
    p = who(await look(client, boss, night, night, hana, basis="ROTA"), hana)
    assert p["minutes"] == 7 * 60 - 30


async def test_rota_hours_and_salaried_days_from_the_rota(client, boss, db, hotel):
    hana, sam = await hourly(db, hotel), await salaried(db, hotel)
    for emp in (hana, sam):
        db.add(Shift(
            hotel_id=hotel.id, employee_id=emp.id, date=nov(2),
            start_time=time(12, 0), end_time=time(20, 0), break_minutes=30,
        ))
    await db.commit()
    body = await look(client, boss, nov(2), nov(8), hana, sam, basis="ROTA")
    assert who(body, hana)["net"] == "90.00"  # 7½ h × £12
    assert who(body, sam)["net"] == "100.00"


# ── for whom, and what counts for each ───────────────────────────────────────
async def test_everybody_is_worked_out_and_only_the_ticked_are_counted(
    client, boss, db, hotel
):
    hana, sam = await hourly(db, hotel), await salaried(db, hotel)
    await worked(db, hana, nov(2))
    await worked(db, sam, nov(2))
    body = await look(client, boss, nov(2), nov(2), hana)
    assert {p["name"] for p in body["people"]} == {"Hana", "Sam"}
    assert body["totals"]["people"] == 1 and body["totals"]["net"] == "96.00"
    assert all(p["suggested"] for p in body["people"])


async def test_typed_hours_typed_amount_and_a_rate_for_this_run_only(
    client, boss, db, hotel
):
    hana, sam = await hourly(db, hotel), await salaried(db, hotel)
    run = await make(
        client, boss, nov(2), nov(8),
        about(hana, basis="MANUAL", minutes=38 * 60 + 30, rate="13.00"),
        about(sam, basis="MANUAL", amount="412.50"),
    )
    got = {s["employee_name"]: s for s in run["slips"]}
    assert got["Hana"]["net_pay"] == "500.50" and got["Hana"]["minutes"] == 2310
    assert got["Sam"]["net_pay"] == "412.50"
    await db.refresh(hana)
    assert hana.hourly_rate == D("12.00"), "their own record is not touched"
    # A typed figure settles the dates it was typed for.
    again = who(await look(client, boss, nov(2), nov(8), hana), hana)
    assert again["in_run_days"] == 7


async def test_a_day_can_be_left_out_put_in_and_typed(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2), nov(3))
    run = await make(
        client, boss, nov(2), nov(5),
        about(hana, days=[
            {"date": "2026-11-03", "include": False},
            {"date": "2026-11-04", "minutes": 90},
        ]),
    )
    assert run["net"] == "114.00"  # 8h + 1h 30m at £12
    d = (await client.get(f"/api/payroll/slips/{run['slips'][0]['id']}", headers=boss)).json()
    assert [(x["date"], x["minutes"], x["typed"]) for x in d["day_list"]] == [
        ("2026-11-02", 480, False), ("2026-11-04", 90, True),
    ]


async def test_a_bonus_on_its_own_uses_up_no_days(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    run = await make(
        client, boss, nov(1), nov(30),
        about(hana, basis="MANUAL", adjustments=[
            {"kind": "BONUS", "label": "Christmas", "amount": "50"},
        ]),
    )
    assert run["net"] == "50.00"
    assert await count(db, PayrollDay) == 0
    assert who(await look(client, boss, nov(1), nov(30), hana), hana)["net"] == "96.00"


async def test_a_leaver_with_days_unpaid_is_still_offered(client, boss, db, hotel):
    lee = await hourly(db, hotel, "Lee")
    await worked(db, lee, nov(2))
    lee.is_active = False
    await db.commit()
    body = await look(client, boss, nov(1), nov(7))
    p = who(body, lee)
    assert p["active"] is False and p["net"] == "96.00" and p["suggested"] is False
    run = await make(client, boss, nov(1), nov(7), lee)
    assert run["net"] == "96.00"


async def test_bonus_tips_money_back_and_deductions_each_have_a_name(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    run = await make(
        client, boss, nov(2), nov(2),
        about(hana, adjustments=[
            {"kind": "BONUS", "label": "Covered Friday", "amount": "20"},
            {"kind": "TIPS", "label": "Tips", "amount": "15.25"},
            {"kind": "REIMBURSEMENT", "label": "Taxi", "amount": "8.40"},
            {"kind": "DEDUCTION", "label": "Broken phone", "amount": "10"},
        ]),
    )
    s = run["slips"][0]
    assert (s["gross_pay"], s["additions"], s["other_deductions"], s["net_pay"]) == (
        "96.00", "43.65", "10.00", "129.65",
    )
    assert [a["amount"] for a in s["adjustments"]] == ["20.00", "15.25", "8.40", "-10.00"]


async def test_more_taken_off_than_there_is_stops_the_run(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    p = about(hana, adjustments=[{"kind": "DEDUCTION", "label": "Till", "amount": "200"}])
    flags = who(await look(client, boss, nov(2), nov(2), p), hana)["flags"]
    assert any(f["code"] == "too_much_off" and f["blocking"] for f in flags)
    r = await client.post("/api/payroll/runs", headers=boss, json=ask(nov(2), nov(2), p))
    assert r.status_code == 400 and "Hana" in r.json()["detail"]


# ── guards ───────────────────────────────────────────────────────────────────
async def test_no_rate_below_minimum_and_nothing_to_pay_are_named(client, boss, db, hotel):
    a, b = await hourly(db, hotel, "Ann", rate=None), await hourly(db, hotel, "Ben", rate="9.00")
    c, d = await hourly(db, hotel, "Cat"), await salaried(db, hotel, "Dan", salary=None)
    for emp in (a, b, d):
        await worked(db, emp, nov(2))
    body = await look(client, boss, nov(2), nov(2), a, b, c, d)
    codes = {p["name"]: {f["code"] for f in p["flags"] if f["blocking"]} for p in body["people"]}
    assert codes == {
        "Ann": {"no_rate"}, "Ben": {"below_min"}, "Cat": {"nothing"}, "Dan": {"no_rate"},
    }
    assert not any(p["suggested"] for p in body["people"])
    r = await client.post("/api/payroll/runs", headers=boss, json=ask(nov(2), nov(2), a, b))
    assert r.status_code == 400
    assert "Ann" in r.json()["detail"] and "Ben" in r.json()["detail"]
    # One tap: a rate for this run.
    run = await make(client, boss, nov(2), nov(2), about(a, rate="12.00"))
    assert run["net"] == "96.00"


async def test_a_missing_clock_out_is_flagged_and_can_be_fixed_or_skipped(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    db.add(Attendance(
        hotel_id=hotel.id, employee_id=hana.id, date=nov(2), status="PRESENT",
        clock_in=datetime(2026, 11, 2, 11, 0, tzinfo=UTC),
    ))
    await db.commit()
    await worked(db, hana, nov(3))
    body = await look(client, boss, nov(2), nov(3), hana, detail=[str(hana.id)])
    p = who(body, hana)
    flag = next(f for f in p["flags"] if f["code"] == "no_clock_out")
    assert flag["dates"] == ["2026-11-02"] and not flag["blocking"]
    assert p["net"] == "96.00"
    for said, net in (({"minutes": 300}, "156.00"), ({"include": False}, "96.00")):
        fixed = who(await look(
            client, boss, nov(2), nov(3), about(hana, days=[{"date": "2026-11-02", **said}]),
        ), hana)
        assert fixed["net"] == net
        assert not any(f["code"] == "no_clock_out" for f in fixed["flags"])


async def test_absent_with_hours_is_left_out_until_somebody_says(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2), status="ABSENT")
    p = who(await look(client, boss, nov(2), nov(2), hana), hana)
    assert p["net"] == "0.00" and any(f["code"] == "marked_off" for f in p["flags"])
    p = who(await look(
        client, boss, nov(2), nov(2), about(hana, days=[{"date": "2026-11-02", "include": True}])
    ), hana)
    assert p["net"] == "96.00"


async def test_a_day_in_another_run_is_left_out_and_never_paid_twice_silently(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2), nov(3), nov(4))
    first = await make(client, boss, nov(2), nov(3), hana)
    body = await look(client, boss, nov(2), nov(8), hana, detail=[str(hana.id)])
    p = who(body, hana)
    assert p["net"] == "96.00" and p["in_run_days"] == 2
    taken = next(d for d in p["day_lines"] if d["date"] == "2026-11-03")
    assert taken["include"] is False
    assert taken["in_run"]["number"] == first["number"]
    assert "already in run 1" in taken["why"]
    assert any(f["code"] == "in_run" for f in p["flags"])

    # Asking for it without saying "again" is refused, by name and by day.
    sly = about(hana, days=[{"date": "2026-11-03", "include": True}])
    r = await client.post("/api/payroll/runs", headers=boss, json=ask(nov(2), nov(8), sly))
    assert r.status_code == 409
    assert "Hana" in r.json()["detail"] and "3 Nov 2026" in r.json()["detail"]

    # Saying it is said about that day, and it shows.
    sure = about(hana, days=[{"date": "2026-11-03", "include": True, "again": True}])
    run = await make(client, boss, nov(2), nov(8), sure)
    assert run["net"] == "192.00"
    assert await count(db, PayrollDay, again=True) == 1


async def test_two_people_saving_the_same_week_pay_it_once(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2), nov(3))
    body = ask(nov(2), nov(8), hana, expect_net="192.00")
    both = await asyncio.gather(
        *(client.post("/api/payroll/runs", headers=boss, json=body) for _ in range(2))
    )
    assert sorted(r.status_code for r in both) in ([201, 400], [201, 409])
    assert await count(db, Payroll) == 1
    assert await count(db, PayrollDay) == 2


async def test_figures_that_moved_since_the_screen_are_not_saved(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    assert (await look(client, boss, nov(2), nov(3), hana))["totals"]["net"] == "96.00"
    await worked(db, hana, nov(3))
    r = await client.post(
        "/api/payroll/runs", headers=boss,
        json=ask(nov(2), nov(3), hana, expect_net="96.00"),
    )
    assert r.status_code == 409 and "£192.00" in r.json()["detail"]
    assert await count(db, PayrollRun) == 0


async def test_old_payslips_still_cover_the_whole_of_their_dates(client, boss, db, hotel):
    """From before day lines: no day is listed, so every day of it is taken."""
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2), nov(9))
    db.add(Payroll(
        hotel_id=hotel.id, employee_id=hana.id, pay_period="2026-W45", status="PAID",
        period_start=nov(2), period_end=nov(8), gross_pay=D("96"), net_pay=D("96"),
    ))
    await db.commit()
    p = who(await look(client, boss, nov(1), nov(30), hana), hana)
    assert p["net"] == "96.00" and p["in_run_days"] == 7


async def test_the_old_one_period_run_respects_the_new_ones(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    await make(client, boss, nov(2), nov(2), hana)
    r = await client.post(
        "/api/payroll/process", headers=boss,
        json={"pay_period": "2026-W45", "employee_id": str(hana.id)},
    )
    assert r.status_code == 409 and "already has pay covering" in r.json()["detail"]


# ── approving is not paying ──────────────────────────────────────────────────
async def _profit(client, h, frm="2026-11-01", to="2026-11-30") -> dict:
    r = await client.get(f"/api/reports/pnl?date_from={frm}&date_to={to}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


async def test_approving_puts_nothing_anywhere(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    before = await _profit(client, boss)
    run = await make(client, boss, nov(2), nov(2), hana)
    r = await do(client, boss, run, "approve")
    assert r.status_code == 200 and r.json()["status"] == "APPROVED"
    assert r.json()["status_text"] == "Approved, not paid yet"
    assert await wages(db, hotel.id) == []
    assert (await client.get("/api/expenses", headers=boss)).json() == []
    assert await _profit(client, boss) == before
    rep = await client.get(
        "/api/reports/mbr?date_from=2026-11-01&date_to=2026-11-30&sections=staff",
        headers=boss,
    )
    if rep.status_code == 200 and rep.headers["content-type"].startswith("application/json"):
        staff = [s for s in rep.json().get("sections", []) if s["key"] == "staff"]
        assert all(s["rows"] == [] for s in staff)


async def test_every_old_door_to_approval_is_shut_too(client, boss, db, hotel):
    """The one-payslip button, and approve-all by period: the two that leaked."""
    hana, sam = await hourly(db, hotel), await salaried(db, hotel)
    for emp in (hana, sam):
        await worked(db, emp, nov(2))
    one = (await client.post(
        "/api/payroll/process", headers=boss,
        json={"pay_period": "2026-W45", "employee_id": str(hana.id)},
    )).json()[0]
    await client.post(f"/api/payroll/{one['id']}/approve", headers=boss)
    await client.post("/api/payroll/process", headers=boss, json={"pay_period": "2026-11"})
    await client.post("/api/payroll/approve-all?pay_period=2026-11", headers=boss)
    assert {s for s in (await db.execute(select(Payroll.status))).scalars()} == {"APPROVED"}
    assert await wages(db, hotel.id) == []


async def test_paying_makes_exactly_one_expense_on_the_day_by_the_method(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    run = await make(client, boss, nov(2), nov(2), hana)
    # A draft cannot be paid.
    assert (await pay(client, boss, run)).status_code == 409
    await do(client, boss, run, "approve")
    r = await pay(client, boss, run, method="CASH", reference="envelope 4")
    assert r.status_code == 200 and r.json()["status"] == "PAID"
    (e,) = await wages(db, hotel.id)
    assert (e.amount, e.date, e.payment_method) == (D("96.00"), nov(20), "CASH")
    assert str(e.payroll_id) == run["slips"][0]["id"]
    # Again is refused, and there is still one.
    assert (await pay(client, boss, run)).status_code == 409
    assert (
        await pay(client, boss, run, payslip_ids=[run["slips"][0]["id"]])
    ).status_code == 409
    assert len(await wages(db, hotel.id)) == 1
    row = (await client.get("/api/expenses", headers=boss)).json()[0]
    assert row["from_payroll"] is True and row["payroll_id"] == run["slips"][0]["id"]
    assert "[payroll:" not in row["description"] and "envelope 4" in row["description"]
    pnl = await _profit(client, boss)
    assert D(str(pnl["operating_expenses"])) == D("96.00")


async def test_paid_in_cash_leaves_the_till_on_that_day_and_no_other(
    client, boss, db, hotel
):
    from app.sales import cash

    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    run = await make(client, boss, nov(2), nov(2), hana)
    await do(client, boss, run, "approve")
    assert await cash.cash_expenses_for(db, hotel.id, nov(20)) == 0
    await pay(client, boss, run, method="CASH")
    assert await cash.cash_expenses_for(db, hotel.id, nov(20)) == D("96.00")
    await do(client, boss, run, "unpay")
    assert await cash.cash_expenses_for(db, hotel.id, nov(20)) == 0


async def test_undoing_a_payment_takes_the_expense_back_and_leaves_it_approved(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    run = await make(client, boss, nov(2), nov(2), hana)
    await do(client, boss, run, "approve")
    await pay(client, boss, run)
    r = await do(client, boss, run, "unpay")
    assert r.status_code == 200 and r.json()["status"] == "APPROVED"
    s = r.json()["slips"][0]
    assert s["paid_on"] is None and s["paid_method"] is None and s["paid_reference"] is None
    assert await wages(db, hotel.id) == []
    # And it can be paid again: one, not two.
    await pay(client, boss, run)
    assert len(await wages(db, hotel.id)) == 1


async def test_some_people_paid_reads_part_paid(client, boss, db, hotel):
    people = [await hourly(db, hotel, n) for n in ("Ann", "Ben", "Cat")]
    for emp in people:
        await worked(db, emp, nov(2))
    run = await make(client, boss, nov(2), nov(2), *people)
    await do(client, boss, run, "approve")
    ann = next(s for s in run["slips"] if s["employee_name"] == "Ann")
    r = await pay(client, boss, run, payslip_ids=[ann["id"]])
    body = r.json()
    assert body["status"] == "PART_PAID" and body["status_text"] == "Part paid (1 of 3)"
    assert (body["paid_net"], body["unpaid_net"]) == ("96.00", "192.00")
    assert len(await wages(db, hotel.id)) == 1
    # The rest, in one go: the one already paid is not paid again.
    body = (await pay(client, boss, run, method="CASH")).json()
    assert body["status"] == "PAID"
    assert sorted(e.payment_method for e in await wages(db, hotel.id)) == [
        "BANK", "CASH", "CASH",
    ]


async def test_a_payment_cannot_be_dated_in_the_future_or_by_a_made_up_method(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    run = await make(client, boss, nov(2), nov(2), hana)
    await do(client, boss, run, "approve")
    r = await pay(client, boss, run, paid_on="2999-01-01")
    assert r.status_code == 400 and "future" in r.json()["detail"]
    assert (await pay(client, boss, run, method="MAGIC")).status_code == 422
    assert await wages(db, hotel.id) == []


async def test_an_advance_that_takes_it_all_is_paid_with_no_expense(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    db.add(SalaryAdvance(
        hotel_id=hotel.id, employee_id=hana.id, amount=D("500"), given_date=nov(1),
        deduct_period="2026-11",
    ))
    await db.commit()
    run = await make(client, boss, nov(2), nov(2), hana)
    assert run["net"] == "0.00" and run["slips"][0]["advance_deduction"] == "96.00"
    await do(client, boss, run, "approve")
    assert (await pay(client, boss, run)).json()["status"] == "PAID"
    assert await wages(db, hotel.id) == []


# ── hold, take out, back to draft, change ────────────────────────────────────
async def test_somebody_on_hold_is_neither_approved_nor_paid_with_the_rest(
    client, boss, db, hotel
):
    ann, ben = await hourly(db, hotel, "Ann"), await hourly(db, hotel, "Ben")
    for emp in (ann, ben):
        await worked(db, emp, nov(2))
    run = await make(client, boss, nov(2), nov(2), ann, about(ben, hold=True))
    ben_id = next(s["id"] for s in run["slips"] if s["employee_name"] == "Ben")
    body = (await do(client, boss, run, "approve")).json()
    assert body["status"] == "PART_APPROVED" and body["held"] == 1
    body = (await pay(client, boss, run)).json()
    assert body["status_text"] == "Part paid (1 of 2)"
    assert (await do(client, boss, run, "approve", payslip_ids=[ben_id])).status_code == 409
    r = await client.post(
        f"/api/payroll/slips/{ben_id}/hold", headers=boss, json={"held": False}
    )
    assert r.status_code == 200 and r.json()["held"] is False
    assert (await do(client, boss, run, "approve")).status_code == 200
    assert (await pay(client, boss, run)).json()["status"] == "PAID"


async def test_taking_one_person_out_frees_their_days_and_not_the_others(
    client, boss, db, hotel
):
    ann, ben = await hourly(db, hotel, "Ann"), await hourly(db, hotel, "Ben")
    for emp in (ann, ben):
        await worked(db, emp, nov(2))
    run = await make(client, boss, nov(2), nov(2), ann, ben)
    ids = {s["employee_name"]: s["id"] for s in run["slips"]}
    r = await client.delete(f"/api/payroll/{ids['Ann']}", headers=boss)
    assert r.status_code == 200
    body = await look(client, boss, nov(2), nov(2), ann, ben)
    assert who(body, ann)["net"] == "96.00" and who(body, ben)["net"] == "0.00"
    # A paid one is not simply removed.
    await do(client, boss, run, "approve")
    await pay(client, boss, run)
    r = await client.delete(f"/api/payroll/{ids['Ben']}", headers=boss)
    assert r.status_code == 409 and "Recall" in r.json()["detail"]
    # The last one out takes the run with them.
    await do(client, boss, run, "unpay")
    await client.delete(f"/api/payroll/{ids['Ben']}", headers=boss)
    assert await count(db, PayrollRun) == 0


async def test_a_draft_can_be_opened_again_and_an_approved_one_cannot(
    client, boss, db, hotel
):
    ann, ben = await hourly(db, hotel, "Ann"), await hourly(db, hotel, "Ben")
    for emp in (ann, ben):
        await worked(db, emp, nov(2), nov(3))
    run = await make(client, boss, nov(2), nov(2), ann, note="first go")
    assert run["can_change"] is True and run["setup"]["people"][0]["employee_id"] == str(ann.id)
    # Its own days do not count against it.
    body = await look(client, boss, nov(2), nov(3), ann, ben, run_id=run["id"])
    assert body["totals"]["net"] == "384.00"
    r = await client.put(
        f"/api/payroll/runs/{run['id']}", headers=boss,
        json=ask(nov(2), nov(3), ann, ben, expect_net="384.00"),
    )
    assert r.status_code == 200, r.text
    assert r.json()["net"] == "384.00" and r.json()["number"] == run["number"]
    assert await count(db, Payroll) == 2 and await count(db, PayrollDay) == 4
    await do(client, boss, run, "approve")
    r = await client.put(
        f"/api/payroll/runs/{run['id']}", headers=boss, json=ask(nov(2), nov(3), ann)
    )
    assert r.status_code == 409
    assert (await do(client, boss, run, "unapprove")).json()["status"] == "DRAFT"
    r = await client.put(
        f"/api/payroll/runs/{run['id']}", headers=boss, json=ask(nov(2), nov(3), ann)
    )
    assert r.status_code == 200 and r.json()["net"] == "192.00"


async def test_the_last_run_moves_on_to_the_next_dates(client, boss, db, hotel):
    ann, sam = await hourly(db, hotel, "Ann"), await salaried(db, hotel)
    await worked(db, ann, nov(2))
    await make(
        client, boss, nov(2), nov(8),
        about(ann, adjustments=[{"kind": "BONUS", "label": "Once", "amount": "5"}]),
        about(sam, basis="MANUAL", amount="600"),
        everyone=True, working_days=22,
    )
    nxt = (await client.get("/api/payroll/runs/next", headers=boss)).json()
    req = nxt["request"]
    assert (req["date_from"], req["date_to"]) == ("2026-11-09", "2026-11-15")
    assert req["everyone"] is True and req["working_days"] == 22
    by = {p["employee_id"]: p for p in req["people"]}
    assert by[str(ann.id)]["adjustments"] == [], "a bonus is not copied without a thought"
    assert by[str(sam.id)]["amount"] == "600"
    # A whole month is followed by a whole month, whatever its length.
    assert periods.next_range(date(2026, 1, 1), date(2026, 1, 31)) == (
        date(2026, 2, 1), date(2026, 2, 28),
    )
    # No run yet, nothing to copy.
    other = Hotel(name="New", country="GB", base_currency="GBP", city="Hull")
    db.add(other)
    await db.commit()


# ── advances ─────────────────────────────────────────────────────────────────
async def _advance(db, hotel, emp, amount="300", period="2026-11", given=None):
    a = SalaryAdvance(
        hotel_id=hotel.id, employee_id=emp.id, amount=D(amount),
        given_date=given or nov(1), deduct_period=period,
    )
    db.add(a)
    await db.commit()
    return a


async def test_an_advance_is_taken_back_part_by_part_and_given_back_by_a_recall(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2), nov(3))
    adv = await _advance(db, hotel, hana)
    run = await make(client, boss, nov(2), nov(2), hana)
    await db.refresh(adv)
    assert (adv.amount_recovered, adv.is_deducted) == (D("96.00"), False)
    second = await make(client, boss, nov(3), nov(3), about(hana, advance="50"))
    assert second["net"] == "46.00"
    await db.refresh(adv)
    assert adv.amount_recovered == D("146.00")
    await do(client, boss, run, "recall")
    await db.refresh(adv)
    assert adv.amount_recovered == D("50.00"), "only what that run took"
    await do(client, boss, second, "recall")
    await db.refresh(adv)
    assert adv.amount_recovered == D("0.00")


async def test_changing_a_draft_does_not_lose_the_advance(client, boss, db, hotel):
    """Run again, the advance read as already taken, and it dropped off."""
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    adv = await _advance(db, hotel, hana, "40")
    run = await make(client, boss, nov(2), nov(2), hana)
    assert run["net"] == "56.00"
    r = await client.put(
        f"/api/payroll/runs/{run['id']}", headers=boss, json=ask(nov(2), nov(2), hana)
    )
    assert r.json()["net"] == "56.00"
    await db.refresh(adv)
    assert adv.amount_recovered == D("40.00") and adv.is_deducted is True


async def test_an_advance_from_an_earlier_month_is_still_asked_for(client, boss, db, hotel):
    """It was matched on the very same period, so July's remainder was never in
    an August run."""
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    await _advance(db, hotel, hana, "30", period="2026-07", given=date(2026, 7, 1))
    await _advance(db, hotel, hana, "30", period="2026-12", given=nov(1))
    p = who(await look(client, boss, nov(2), nov(2), hana), hana)
    assert (p["advance_due"], p["advance_owed"], p["net"]) == ("30.00", "60.00", "66.00")


async def test_more_advance_than_they_owe_is_refused(client, boss, db, hotel):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    await _advance(db, hotel, hana, "30")
    r = await client.post(
        "/api/payroll/runs", headers=boss, json=ask(nov(2), nov(2), about(hana, advance="31"))
    )
    assert r.status_code == 400 and "more than the £30.00 they owe" in r.json()["detail"]


# ── recall ───────────────────────────────────────────────────────────────────
async def _traces(db, hotel_id) -> dict:
    return {
        "runs": await count(db, PayrollRun, hotel_id=hotel_id),
        "slips": await count(db, Payroll, hotel_id=hotel_id),
        "days": await count(db, PayrollDay, hotel_id=hotel_id),
        "extras": await count(db, PayrollAdjustment, hotel_id=hotel_id),
        "recoveries": await count(db, PayrollAdvanceRecovery, hotel_id=hotel_id),
        "expenses": len(await wages(db, hotel_id)),
    }


NOTHING = {"runs": 0, "slips": 0, "days": 0, "extras": 0, "recoveries": 0, "expenses": 0}


async def _payroll_log(db, hotel_id) -> list[AuditEvent]:
    rows = await db.execute(
        select(AuditEvent).where(
            AuditEvent.hotel_id == hotel_id, AuditEvent.action.startswith("payroll.")
        ).execution_options(populate_existing=True)
    )
    return list(rows.scalars())


@pytest.mark.parametrize("stage", ["draft", "approved", "part paid", "paid"])
async def test_recall_at_any_stage_removes_every_trace_but_one_line(
    client, boss, db, hotel, stage
):
    hid = hotel.id
    ann, ben = await hourly(db, hotel, "Ann"), await hourly(db, hotel, "Ben")
    for emp in (ann, ben):
        await worked(db, emp, nov(2), nov(3))
    adv = await _advance(db, hotel, ann, "20")
    before = await _profit(client, boss)
    run = await make(
        client, boss, nov(2), nov(3), ann,
        about(ben, adjustments=[{"kind": "BONUS", "label": "Extra", "amount": "10"}]),
    )
    ids = {s["employee_name"]: s["id"] for s in run["slips"]}
    if stage != "draft":
        await do(client, boss, run, "approve")
    if stage == "part paid":
        await pay(client, boss, run, payslip_ids=[ids["Ann"]])
    if stage == "paid":
        await pay(client, boss, run)
    # Somebody has read the bell: what it remembers about these goes too.
    bell = (await client.get("/api/notifications", headers=boss)).json()
    assert "payroll" in str(bell).lower()
    ev = (await _payroll_log(db, hid))[0]
    db.add(NotificationState(
        hotel_id=hid, user_id=ev.user_id, key=f"act:{ev.id}", read_at=datetime.now(UTC),
    ))
    await db.commit()

    said = (await do(client, boss, run, "recall/preview")).json()
    assert said["people"] == 2 and said["days"] == 4 and said["whole_run"] is True
    assert said["net"] == "374.00"
    paid = {"part paid": ("1", "172.00"), "paid": ("2", "374.00")}.get(stage)
    assert said["needs_word"] is bool(paid)
    if paid:
        assert (str(said["paid_people"]), said["paid_net"]) == paid
        assert (str(said["expenses"]), said["expenses_total"]) == paid
        # The second step is the server's, not only the page's.
        r = await do(client, boss, run, "recall", reason="wrong week")
        assert r.status_code == 409 and "RECALL" in r.json()["detail"]
        r = await do(client, boss, run, "recall", confirm="RECALL")
        assert r.status_code == 409 and "why" in r.json()["detail"].lower()
    r = await do(client, boss, run, "recall", confirm="recall", reason="wrong week")
    assert r.status_code == 200 and r.json() == {"recalled": 2, "run_gone": True}

    assert await _traces(db, hid) == NOTHING
    await db.refresh(adv)
    assert adv.amount_recovered == 0 and adv.is_deducted is False
    assert await count(db, NotificationState, hotel_id=hid) == 0
    log = await _payroll_log(db, hid)
    assert [e.action for e in log] == ["payroll.recall"]
    assert "£374.00" in log[0].summary and "wrong week" in log[0].summary
    assert log[0].user_email == "boss@runs.test"
    if paid:
        assert f"£{paid[1]} was marked paid" in log[0].summary
    assert await _profit(client, boss) == before
    # The days can be paid again, all of them, and the run is not there.
    assert (await look(client, boss, nov(2), nov(3), ann, ben))["totals"]["left_out_days"] == 0
    assert (
        await client.get(f"/api/payroll/runs/{run['id']}", headers=boss)
    ).status_code == 404
    again = await make(client, boss, nov(2), nov(3), ann, ben)
    assert again["people"] == 2


async def test_recalling_one_person_leaves_the_rest_of_the_run(client, boss, db, hotel):
    ann, ben = await hourly(db, hotel, "Ann"), await hourly(db, hotel, "Ben")
    for emp in (ann, ben):
        await worked(db, emp, nov(2))
    run = await make(client, boss, nov(2), nov(2), ann, ben)
    await do(client, boss, run, "approve")
    await pay(client, boss, run)
    ids = {s["employee_name"]: s["id"] for s in run["slips"]}
    r = await do(
        client, boss, run, "recall", payslip_ids=[ids["Ann"]], confirm="RECALL",
        reason="paid twice",
    )
    assert r.json() == {"recalled": 1, "run_gone": False}
    (e,) = await wages(db, hotel.id)
    assert str(e.payroll_id) == ids["Ben"]
    body = (await client.get(f"/api/payroll/runs/{run['id']}", headers=boss)).json()
    assert [s["employee_name"] for s in body["slips"]] == ["Ben"]
    log = [x for x in await _payroll_log(db, hotel.id) if x.action == "payroll.recall"]
    assert len(log) == 1 and "Ann" in log[0].summary
    # Recalling the rest later keeps that line: it is a record, not a trace.
    await do(client, boss, run, "recall", confirm="RECALL", reason="all wrong")
    assert len([x for x in await _payroll_log(db, hotel.id)]) == 2


async def test_a_long_reason_does_not_push_the_money_out_of_the_record(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel, "Hana " + "x" * 80)
    await worked(db, hana, nov(2))
    run = await make(client, boss, nov(2), nov(2), hana)
    await do(client, boss, run, "approve")
    await pay(client, boss, run)
    await do(client, boss, run, "recall", confirm="RECALL", reason="y" * 160)
    (line,) = await _payroll_log(db, hotel.id)
    assert len(line.summary) <= 300 and "£96.00 was marked paid" in line.summary


async def test_a_recall_of_an_old_payslip_puts_its_advance_back(client, boss, db, hotel):
    """It took £60 and did not write down from which advance."""
    hana = await hourly(db, hotel)
    adv = await _advance(db, hotel, hana, "60", period="2026-10", given=date(2026, 10, 1))
    adv.amount_recovered, adv.is_deducted = D("60"), True
    run = PayrollRun(
        hotel_id=hotel.id, number=1, period_start=date(2026, 10, 1),
        period_end=date(2026, 10, 31), setup={"label": "2026-10"},
    )
    db.add(run)
    await db.flush()
    db.add(Payroll(
        hotel_id=hotel.id, employee_id=hana.id, run_id=run.id, pay_period="2026-10",
        status="APPROVED", gross_pay=D("100"), advance_deduction=D("60"), net_pay=D("40"),
    ))
    db.add(AuditEvent(
        hotel_id=hotel.id, user_email="x", action="payroll.run", entity_type="payroll",
        summary="Ran payroll for 2026-10: 1 staff, net £40",
    ))
    db.add(AuditEvent(
        hotel_id=hotel.id, user_email="x", action="payroll.run", entity_type="payroll",
        summary="Ran payroll for 2026-11: 1 staff, net £40",
    ))
    await db.commit()
    r = await client.post(
        f"/api/payroll/runs/{run.id}/recall", headers=boss, json={"reason": "never happened"}
    )
    assert r.status_code == 200, r.text
    await db.refresh(adv)
    assert adv.amount_recovered == 0 and adv.is_deducted is False
    left = sorted(e.summary for e in await _payroll_log(db, hotel.id))
    assert len(left) == 2 and left[0].startswith("Ran payroll for 2026-11")


# ── who may, and whose ───────────────────────────────────────────────────────
async def test_another_restaurants_payroll_is_not_there_at_all(
    client, boss, db, hotel, make_user, auth_header
):
    other = Hotel(name="Elsewhere", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    thief = auth_header(
        await make_user("thief@runs.test", Role.SUPER_ADMIN.value, hotel_id=other.id)
    )
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    run = await make(client, boss, nov(2), nov(2), hana)
    slip = run["slips"][0]["id"]
    rid = run["id"]

    assert (await client.get("/api/payroll/runs", headers=thief)).json()["runs"] == []
    for path in (f"/runs/{rid}", f"/runs/{rid}/export.csv", f"/runs/{rid}/payslips.pdf",
                 f"/slips/{slip}", f"/{slip}/payslip.pdf", f"/runs/next?run_id={rid}"):
        r = await client.get(f"/api/payroll{path}", headers=thief)
        assert r.status_code == 404, path
    body = {"paid_on": "2026-11-20", "method": "BANK"}
    for path, payload in (
        (f"/runs/{rid}/approve", {}), (f"/runs/{rid}/unapprove", {}),
        (f"/runs/{rid}/pay", body), (f"/runs/{rid}/unpay", {}),
        (f"/runs/{rid}/recall", {"reason": "mine now", "confirm": "RECALL"}),
        (f"/runs/{rid}/recall/preview", {}), (f"/runs/{rid}/email", {}),
        (f"/slips/{slip}/hold", {"held": True}),
        (f"/{slip}/approve", {}), (f"/{slip}/pay", body), (f"/{slip}/email", {}),
    ):
        r = await client.post(f"/api/payroll{path}", headers=thief, json=payload)
        assert r.status_code == 404, path
    assert (await client.delete(f"/api/payroll/{slip}", headers=thief)).status_code == 404
    r = await client.put(
        f"/api/payroll/runs/{rid}", headers=thief, json=ask(nov(2), nov(2), hana)
    )
    assert r.status_code == 404
    # Nor can their own run be made with somebody else's staff.
    r = await client.post("/api/payroll/runs", headers=thief, json=ask(nov(2), nov(2), hana))
    assert r.status_code == 404
    r = await client.post(
        "/api/payroll/runs/preview", headers=thief, json=ask(nov(2), nov(2), hana, run_id=rid)
    )
    assert r.status_code == 404
    body = await look(client, thief, nov(2), nov(2), hana)
    assert body["people"] == []
    # And a payslip of one run cannot be reached through another of your own.
    hana2 = await hourly(db, other, "Other")
    await worked(db, hana2, nov(2))
    mine = await make(client, thief, nov(2), nov(2), hana2)
    r = await do(client, thief, mine, "approve", payslip_ids=[slip])
    assert r.status_code == 404
    assert await count(db, Payroll, status="DRAFT") == 2


async def test_seeing_is_not_changing_and_neither_is_for_everybody(
    client, boss, db, hotel, make_user, auth_header
):
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    run = await make(client, boss, nov(2), nov(2), hana)
    slip, rid = run["slips"][0]["id"], run["id"]
    sees = auth_header(await make_user("mgr@runs.test", Role.MANAGER.value))
    none = auth_header(await make_user("till@runs.test", Role.CASHIER.value))
    for path in ("/runs", f"/runs/{rid}", f"/slips/{slip}", "/owed", "/runs/next"):
        assert (await client.get(f"/api/payroll{path}", headers=sees)).status_code == 200, path
        assert (await client.get(f"/api/payroll{path}", headers=none)).status_code == 403, path
    body = {"paid_on": "2026-11-20", "method": "BANK"}
    for path, payload in (
        ("/runs", ask(nov(3), nov(3), hana)),
        (f"/runs/{rid}/approve", {}), (f"/runs/{rid}/unapprove", {}),
        (f"/runs/{rid}/pay", body), (f"/runs/{rid}/unpay", {}),
        (f"/runs/{rid}/recall/preview", {}), (f"/runs/{rid}/recall", {"reason": "no"}),
        (f"/runs/{rid}/email", {}), (f"/slips/{slip}/hold", {"held": True}),
        ("/legacy/paid", {}), (f"/{slip}/approve", {}), (f"/{slip}/pay", body),
    ):
        for h in (sees, none):
            r = await client.post(f"/api/payroll{path}", headers=h, json=payload)
            assert r.status_code == 403, path
    for h in (sees, none):
        assert (await client.delete(f"/api/payroll/{slip}", headers=h)).status_code == 403
    assert await count(db, Payroll, status="DRAFT") == 1


async def test_staff_see_their_own_payslip_once_it_is_agreed(
    client, boss, db, hotel, make_user, auth_header
):
    login = await make_user("hana@runs.test", Role.STAFF.value)
    hana = await hourly(db, hotel)
    hana.user_id = login.id
    await db.commit()
    await worked(db, hana, nov(2))
    run = await make(client, boss, nov(2), nov(2), hana)
    mine, slip = auth_header(login), run["slips"][0]["id"]
    assert (await client.get("/api/me/payslips", headers=mine)).json() == []
    assert (
        await client.get(f"/api/me/payslips/{slip}.pdf", headers=mine)
    ).status_code == 404
    await do(client, boss, run, "approve")
    (row,) = (await client.get("/api/me/payslips", headers=mine)).json()
    assert row["label"] == "2 Nov 2026" and row["status"] == "APPROVED"
    pdf = await client.get(f"/api/me/payslips/{slip}.pdf", headers=mine)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"


# ── owed, history, export, email ─────────────────────────────────────────────
async def test_who_is_owed_is_what_a_run_would_pay_them(client, boss, db, hotel):
    from app.core.timezones import hotel_today

    today = hotel_today(hotel)
    ago = lambda n: date.fromordinal(today.toordinal() - n)  # noqa: E731
    ann, ben = await hourly(db, hotel, "Ann"), await hourly(db, hotel, "Ben")
    await hourly(db, hotel, "Idle")
    await worked(db, ann, ago(6), ago(5), ago(2))
    await worked(db, ben, ago(2))
    run = await make(client, boss, ago(6), ago(4), ann)
    body = (await client.get("/api/payroll/owed", headers=boss)).json()
    by = {p["name"]: p for p in body["people"]}
    assert set(by) == {"Ann", "Ben"}
    assert by["Ann"]["days"] == 1 and by["Ann"]["estimate"] == "96.00"
    assert by["Ann"]["waiting"] == "192.00" and by["Ann"]["paid_to"] is None
    assert body["estimate"] == "192.00" and body["waiting"] == "192.00"
    await do(client, boss, run, "approve")
    await pay(client, boss, run, paid_on=today.isoformat())
    by = {
        p["name"]: p
        for p in (await client.get("/api/payroll/owed", headers=boss)).json()["people"]
    }
    assert by["Ann"]["paid_to"] == ago(5).isoformat() and by["Ann"]["waiting"] == "0.00"
    assert by["Ann"]["paid_on"] == today.isoformat()


async def test_who_is_owed_says_what_to_look_at(client, boss, db, hotel):
    """A missing clock-out, and somebody with hours and no rate, are named there."""
    from app.core.timezones import hotel_today

    day = date.fromordinal(hotel_today(hotel).toordinal() - 3)
    tom, leo = await hourly(db, hotel, "Tom"), await hourly(db, hotel, "Leo", rate=None)
    db.add(Attendance(
        hotel_id=hotel.id, employee_id=tom.id, date=day, status="PRESENT",
        clock_in=datetime(day.year, day.month, day.day, 9, 0, tzinfo=UTC),
    ))
    await db.commit()
    await worked(db, leo, day)
    r = await client.get("/api/payroll/owed", headers=boss)
    assert r.status_code == 200, r.text
    by = {p["name"]: p for p in r.json()["people"]}
    assert [f["code"] for f in by["Tom"]["flags"]] == ["no_clock_out"]
    assert by["Tom"]["flags"][0]["dates"] == [day.isoformat()]
    assert [f["code"] for f in by["Leo"]["flags"]] == ["no_rate"]


async def test_the_list_is_narrowed_by_state_dates_and_person(client, boss, db, hotel):
    ann, ben = await hourly(db, hotel, "Ann"), await hourly(db, hotel, "Ben")
    for emp in (ann, ben):
        await worked(db, emp, nov(2), nov(9))
    one = await make(client, boss, nov(2), nov(8), ann, ben)
    await make(client, boss, nov(9), nov(15), ann)
    await do(client, boss, one, "approve")
    await pay(client, boss, one)

    async def got(q=""):
        return (await client.get(f"/api/payroll/runs{q}", headers=boss)).json()

    assert [r["number"] for r in (await got())["runs"]] == [2, 1]
    body = await got("?status=PAID")
    assert [r["number"] for r in body["runs"]] == [1]
    assert body["totals"]["paid_net"] == "192.00"
    assert [r["number"] for r in (await got("?status=UNPAID"))["runs"]] == [2]
    assert [r["number"] for r in (await got(f"?employee_id={ben.id}"))["runs"]] == [1]
    assert [r["number"] for r in (await got("?date_from=2026-11-09"))["runs"]] == [2]
    assert (await client.get("/api/payroll/runs?status=LOST", headers=boss)).status_code == 422


async def test_the_spreadsheet_adds_up_and_cannot_run_anything(client, boss, db, hotel):
    hana = await hourly(db, hotel, "=HYPERLINK(1)")
    await worked(db, hana, nov(2), hours="7.33")
    run = await make(
        client, boss, nov(2), nov(2),
        about(hana, adjustments=[{"kind": "TIPS", "label": "Tips", "amount": "2"}]),
    )
    r = await client.get(f"/api/payroll/runs/{run['id']}/export.csv", headers=boss)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    line = next(x for x in rows if x and x[0] == "'=HYPERLINK(1)" and len(x) > 10)
    assert line[6] == "7:20" and line[8] == "88.00" and line[13] == "90.00"
    total = next(x for x in rows if x and x[0] == "Total")
    assert total[13] == "90.00"
    assert ["'=HYPERLINK(1)", "2026-11-02", "7:20", "88.00", ""] in rows


async def test_payslips_for_any_dates_open_and_say_what_they_are_for(
    client, boss, db, hotel
):
    """A custom run's label has an arrow in it: the PDF and its name both died."""
    hana = await hourly(db, hotel, "Zoë")
    await worked(db, hana, nov(3))
    run = await make(
        client, boss, nov(3), nov(5),
        about(hana, adjustments=[{"kind": "BONUS", "label": "Extra", "amount": "1"}]),
        note="x",
    )
    await do(client, boss, run, "approve")
    await pay(client, boss, run, reference="abc")
    assert "→" in run["slips"][0]["pay_period"]
    for path in (
        f"/{run['slips'][0]['id']}/payslip.pdf", f"/runs/{run['id']}/payslips.pdf",
        "/payslips.pdf?pay_period=2026-11-03→2026-11-05",
        f"/history/{hana.id}/statement.pdf",
    ):
        r = await client.get(f"/api/payroll{path}", headers=boss)
        assert r.status_code == 200, path
        assert r.content[:4] == b"%PDF"
        assert r.headers["content-disposition"].isascii()


async def test_emailing_is_remembered_so_a_recall_can_warn(
    client, boss, db, hotel, make_user, monkeypatch
):
    from app.core import notify

    sent = []

    async def fake(to, subject, text, html=None, attachments=None):
        sent.append((to, subject, attachments[0]["filename"]))
        return True

    monkeypatch.setattr(notify, "send_email", fake)
    login = await make_user("mail@runs.test", Role.STAFF.value)
    hana = await hourly(db, hotel)
    hana.user_id = login.id
    await db.commit()
    await worked(db, hana, nov(3))
    run = await make(client, boss, nov(3), nov(5), hana)
    assert (await do(client, boss, run, "email")).json()["sent"] == 0, "never a draft"
    await do(client, boss, run, "approve")
    assert (await do(client, boss, run, "email")).json()["sent"] == 1
    assert sent[0][0] == "mail@runs.test" and "3 to 5 Nov 2026" in sent[0][1]
    assert sent[0][2].isascii()
    said = (await do(client, boss, run, "recall/preview")).json()
    assert said["emailed"] == 1 and any("email" in w for w in said["warnings"])


# ── what the old version left behind ─────────────────────────────────────────
async def _parked(db, hotel, emp, on=date(2026, 7, 31), net="200") -> Payroll:
    cat = await runs.wages_category(db, hotel.id)
    run = PayrollRun(
        hotel_id=hotel.id, number=7, period_start=date(2026, 7, 1),
        period_end=date(2026, 7, 31), setup={"label": "2026-07"},
    )
    db.add(run)
    await db.flush()
    slip = Payroll(
        hotel_id=hotel.id, employee_id=emp.id, run_id=run.id, pay_period="2026-07",
        period_start=date(2026, 7, 1), period_end=date(2026, 7, 31),
        status="APPROVED", gross_pay=D(net), net_pay=D(net),
    )
    db.add(slip)
    await db.flush()
    db.add(ParkedWage(
        hotel_id=hotel.id, payroll_id=slip.id, category_id=cat.id, date=on, amount=D(net),
        payment_method="BANK", description=f"Payroll 2026-07 [payroll:{slip.id}]",
    ))
    await db.commit()
    return slip


async def test_approved_by_the_old_version_is_offered_back_on_its_own_day(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    slip = await _parked(db, hotel, hana)
    body = (await client.get("/api/payroll/runs", headers=boss)).json()["legacy"]
    assert body["payslips"] == 1 and body["total"] == "200.00"
    assert body["rows"][0]["was_booked_on"] == "2026-07-31"
    assert await wages(db, hotel.id) == []
    r = await client.post("/api/payroll/legacy/paid", headers=boss, json={})
    assert r.status_code == 200 and r.json()["payslips"] == 0
    (e,) = await wages(db, hotel.id)
    assert (e.date, e.amount, e.payment_method) == (date(2026, 7, 31), D("200.00"), "BANK")
    assert e.payroll_id == slip.id
    assert (
        await client.post("/api/payroll/legacy/paid", headers=boss, json={})
    ).status_code == 409
    assert await count(db, ParkedWage) == 0


async def test_paying_one_of_those_the_ordinary_way_does_not_book_it_twice(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    slip = await _parked(db, hotel, hana)
    r = await client.post(
        f"/api/payroll/runs/{slip.run_id}/pay", headers=boss,
        json={"paid_on": "2026-11-20", "method": "CASH"},
    )
    assert r.status_code == 200
    (e,) = await wages(db, hotel.id)
    assert e.date == nov(20)
    assert await count(db, ParkedWage) == 0


async def test_an_old_paid_wage_known_only_by_its_marker_is_undone_and_recalled(
    client, boss, db, hotel
):
    hana = await hourly(db, hotel)
    slip = await _parked(db, hotel, hana)
    cat = await runs.wages_category(db, hotel.id)
    slip.status = "PAID"
    db.add(Expense(
        hotel_id=hotel.id, category_id=cat.id, date=date(2026, 7, 31), amount=D("200"),
        description=f"Payroll 2026-07 · Hana [payroll:{slip.id}]",
    ))
    await db.commit()
    said = (await client.post(
        f"/api/payroll/runs/{slip.run_id}/recall/preview", headers=boss, json={}
    )).json()
    assert said["expenses"] == 1 and said["expenses_total"] == "200.00"
    r = await client.post(
        f"/api/payroll/runs/{slip.run_id}/unpay", headers=boss, json={}
    )
    assert r.status_code == 200
    assert await wages(db, hotel.id) == []


async def test_the_assistant_knows_approved_is_not_paid(client, boss, db, hotel, make_user):
    from app.assistant import tools

    owner = await make_user("ai@runs.test", Role.SUPER_ADMIN.value)
    hana = await hourly(db, hotel)
    await worked(db, hana, nov(2))
    run = await make(client, boss, nov(2), nov(2), hana)
    await do(client, boss, run, "approve")
    out = await tools.payroll_summary(db, owner, {})
    assert out["runs"][0]["status"] == "Approved, not paid yet"
    assert out["not_paid_yet_in_all"] == "96.00" and out["runs"][0]["paid"] == "0.00"
    assert out["approved_waiting_to_be_paid"] == 1
    assert "NOT" in out["what_the_states_mean"]
