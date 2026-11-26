"""Payroll tests — calculation engine (critical), processing, payslip, RBAC."""
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import pytest

from app.auth.models import Role
from app.employees import service as emp_service
from app.employees.models import Attendance, Employee
from app.payroll import engine, service
from app.payroll.models import SalaryAdvance
from app.payroll.schemas import PersonIn


# ── Calculation engine (pure, exact) ────────────────────────────────────────
def _pay(*, salary=None, rate=None, days=(), working_days=26, advance=None):
    """One person's month, worked out with no database: `days` is (status, hours)."""
    emp = Employee(
        id=uuid4(), full_name="Pat", is_active=True,
        salary_type="HOURLY" if rate else "MONTHLY",
        hourly_rate=Decimal(rate) if rate else None,
        monthly_salary=Decimal(salary) if salary else None,
    )
    dates = [date(2026, 6, 1) + timedelta(days=i) for i in range(30)]
    facts = engine.Facts(hotel=None, dates=dates, now=datetime(2026, 7, 1, tzinfo=UTC))
    for d, (status, hours) in zip(dates, days, strict=False):
        facts.attendance[(emp.id, d)] = Attendance(
            employee_id=emp.id, date=d, status=status, working_hours=Decimal(hours)
        )
    if advance:
        facts.advances[emp.id] = [SalaryAdvance(
            amount=Decimal(advance), amount_recovered=Decimal("0"), deduct_period="2026-06",
        )]
    return engine.work_out(
        emp, PersonIn(employee_id=emp.id), facts, working_days=working_days
    )


def test_full_month_pay():
    w = _pay(salary="2600", days=[("PRESENT", "8")] * 26)
    assert w.pay == Decimal("2600.00")
    assert w.net == Decimal("2600.00")


def test_absent_deduction():
    # 24 of 26 days, £2600/mo -> daily £100 -> £2400
    w = _pay(salary="2600", days=[("PRESENT", "8")] * 24 + [("ABSENT", "0")] * 2)
    assert w.pay == Decimal("2400.00")


def test_half_days():
    # 25 full + 2 half of 26; daily 100 -> 2500 + 100 = 2600
    w = _pay(salary="2600", days=[("PRESENT", "8")] * 25 + [("HALF_DAY", "4")] * 2)
    assert w.pay == Decimal("2600.00")


def test_overtime():
    # daily 100 -> hourly 12.5 -> 8 OT hours * 12.5 * 1.5 = 150
    w = _pay(salary="2600", days=[("PRESENT", "16")] + [("PRESENT", "8")] * 25)
    assert w.overtime == Decimal("150.00")
    assert w.pay == Decimal("2750.00")


def test_advance_deduction():
    w = _pay(salary="2600", days=[("PRESENT", "8")] * 26, advance="500")
    assert w.advance == Decimal("500.00")
    assert w.net == Decimal("2100.00")


def test_hourly_pay():
    w = _pay(rate="12.00", days=[("PRESENT", "8")] * 5)
    assert w.pay == Decimal("480.00")
    assert w.net == Decimal("480.00")


def test_hourly_below_min_wage_is_stopped():
    w = _pay(rate="10.00", days=[("PRESENT", "8")] * 5)  # < £11.44
    assert w.blocked and any(f.code == "below_min" for f in w.flags)


def test_an_advance_bigger_than_the_pay_is_taken_in_part_and_still_owed():
    """The live bug: nothing worked, £3,500 owed, a payslip of minus £3,500."""
    w = _pay(salary="2600", days=[("PRESENT", "8")] * 4, advance="3500")
    assert (w.pay, w.advance, w.net) == (
        Decimal("400.00"), Decimal("400.00"), Decimal("0.00"),
    )
    assert w.advance_owed - w.advance == Decimal("3100.00")
    none = _pay(salary="3500", advance="3500")
    assert (none.net, none.advance) == (Decimal("0.00"), Decimal("0.00"))


# ── Process (DB) ──────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_process_monthly_with_advance(db, hotel):
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Balaji", salary_type="MONTHLY", monthly_salary=Decimal("2600")
    )
    await emp_service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT", working_hours_value=Decimal("8"))
    await emp_service.set_attendance(db, emp, date(2026, 6, 3), status="PRESENT", working_hours_value=Decimal("8"))
    await service.create_advance(
        db, hotel.id, employee_id=emp.id, amount=Decimal("600"), deduct_period="2026-06"
    )

    rec = await service.process_payroll(db, emp, "2026-06", working_days=2)
    assert rec.days_present == 2
    assert rec.gross_pay == Decimal("2600.00")  # 2 days * (2600/2)
    assert rec.advance_deduction == Decimal("600.00")
    assert rec.net_pay == Decimal("2000.00")

    # advance now marked deducted
    advances = await service.list_advances(db, hotel.id, emp.id)
    assert advances[0].is_deducted is True


@pytest.mark.asyncio
async def test_process_hourly(db, hotel):
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Mohamed", salary_type="HOURLY", hourly_rate=Decimal("12.00")
    )
    for d in range(2, 7):  # 5 days x 8h = 40h
        await emp_service.set_attendance(
            db, emp, date(2026, 6, d), status="PRESENT", working_hours_value=Decimal("8")
        )
    rec = await service.process_payroll(
        db, emp, None, date_from=date(2026, 6, 1), date_to=date(2026, 6, 30)
    )
    assert rec.total_hours == Decimal("40.00")
    assert rec.gross_pay == Decimal("480.00")
    assert rec.pay_period == "2026-06-01\u21922026-06-30"  # custom label


# ── Weekly runs ─────────────────────────────────────────────────────────────
def test_period_range_weekly():
    # ISO week 2026-W28 = Mon 2026-07-06 → Sun 2026-07-12
    start, end = service.period_range("2026-W28")
    assert start == date(2026, 7, 6)
    assert end == date(2026, 7, 12)
    assert service.is_weekly("2026-W28") is True
    assert service.is_weekly("2026-07") is False


@pytest.mark.asyncio
async def test_process_weekly_hourly(db, hotel):
    """Weekly run pays only the hours inside that ISO week and grabs advances
    scheduled for the month the week ends in."""
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Weekly Wes", salary_type="HOURLY", hourly_rate=Decimal("12.00")
    )
    # 3 days in week 28 (Jul 6–12) + 1 day outside it
    for d in (6, 7, 8):
        await emp_service.set_attendance(
            db, emp, date(2026, 7, d), status="PRESENT", working_hours_value=Decimal("8")
        )
    await emp_service.set_attendance(db, emp, date(2026, 7, 20), status="PRESENT", working_hours_value=Decimal("8"))
    await service.create_advance(
        db, hotel.id, employee_id=emp.id, amount=Decimal("50"), deduct_period="2026-07"
    )
    rec = await service.process_payroll(db, emp, "2026-W28")
    assert rec.total_hours == Decimal("24.00")  # only the week's 3×8h
    assert rec.gross_pay == Decimal("288.00")
    assert rec.advance_deduction == Decimal("50.00")  # July advance, next-pay rule
    assert rec.net_pay == Decimal("238.00")
    assert rec.pay_period_type == "WEEKLY"


@pytest.mark.asyncio
async def test_weekly_run_rejects_monthly_staff(db, hotel):
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Salaried Sam", salary_type="MONTHLY", monthly_salary=Decimal("2600")
    )
    with pytest.raises(ValueError):
        await service.process_payroll(db, emp, "2026-W28")


# ── API + payslip + RBAC ────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_process_and_payslip_via_api(client, make_user, auth_header, db, hotel):
    acct = await make_user("acct@nirai.com", Role.ACCOUNTANT.value)
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Bal", salary_type="MONTHLY", monthly_salary=Decimal("2600")
    )
    await emp_service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    h = auth_header(acct)

    resp = await client.post(
        "/api/payroll/process", headers=h, json={"pay_period": "2026-06", "working_days": 1}
    )
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) >= 1
    pid = rows[0]["id"]

    pdf = await client.get(f"/api/payroll/{pid}/payslip.pdf", headers=h)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"


@pytest.mark.asyncio
async def test_approve_all_and_consolidated_pdf(client, make_user, auth_header, db, hotel):
    acct = await make_user("acct2@nirai.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Bala", salary_type="MONTHLY", monthly_salary=Decimal("2600")
    )
    await emp_service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    await client.post(
        "/api/payroll/process", headers=h, json={"pay_period": "2026-06", "working_days": 1}
    )

    # approve-all flips every DRAFT -> APPROVED
    resp = await client.post("/api/payroll/approve-all?pay_period=2026-06", headers=h)
    assert resp.status_code == 200
    body = resp.json()
    assert body and all(r["status"] == "APPROVED" for r in body)

    # one PDF with everyone's payslip
    pdf = await client.get("/api/payroll/payslips.pdf?pay_period=2026-06", headers=h)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"


@pytest.mark.asyncio
async def test_cashier_cannot_run_payroll(client, make_user, auth_header):
    cashier = await make_user("cash@nirai.com", Role.CASHIER.value)
    resp = await client.post(
        "/api/payroll/process", headers=auth_header(cashier), json={"pay_period": "2026-06"}
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_hourly_below_min_wage_blocked_via_api(client, make_user, auth_header, db, hotel):
    acct = await make_user("acct@nirai.com", Role.ACCOUNTANT.value)
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Underpaid", salary_type="HOURLY", hourly_rate=Decimal("9.00")
    )
    await emp_service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT", working_hours_value=Decimal("8"))
    resp = await client.post(
        "/api/payroll/process",
        headers=auth_header(acct),
        json={"pay_period": "2026-W23", "employee_id": str(emp.id)},
    )
    assert resp.status_code == 400  # below UK minimum wage


@pytest.mark.asyncio
async def test_configurable_min_wage_allows_lower_rate(client, make_user, auth_header, db, hotel):
    """Lowering the hotel's min_hourly_rate lets an otherwise-blocked rate through."""
    hotel.min_hourly_rate = Decimal("8.00")
    await db.commit()
    acct = await make_user("acct2@nirai.com", Role.ACCOUNTANT.value)
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="LowRate", salary_type="HOURLY", hourly_rate=Decimal("9.00")
    )
    await emp_service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT", working_hours_value=Decimal("8"))
    resp = await client.post(
        "/api/payroll/process",
        headers=auth_header(acct),
        json={"pay_period": "2026-W23", "employee_id": str(emp.id)},
    )
    assert resp.status_code == 200  # 9.00 >= configured 8.00


@pytest.mark.asyncio
async def test_a_payslip_that_is_not_paid_can_be_removed_and_is_gone(
    client, make_user, auth_header, db, hotel
):
    """Approved or not: it is in no book, so there is nothing to put right."""
    from sqlalchemy import select

    from app.expenses.models import Expense

    acct = await make_user("acctrm@nirai.com", Role.ACCOUNTANT.value)
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Remo", salary_type="MONTHLY", monthly_salary=Decimal("3000")
    )
    await emp_service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    h = auth_header(acct)

    rows = (
        await client.post(
            "/api/payroll/process", headers=h, json={"pay_period": "2026-06", "working_days": 1}
        )
    ).json()
    pid = rows[0]["id"]
    assert (await client.post(f"/api/payroll/{pid}/approve", headers=h)).status_code == 200
    assert (await db.execute(select(Expense))).scalars().all() == []

    r = await client.delete(f"/api/payroll/{pid}", headers=h)
    assert r.status_code == 200 and r.json()["removed"] is True
    after = (await client.get("/api/payroll?pay_period=2026-06", headers=h)).json()
    assert all(row["id"] != pid for row in after)
    assert (await client.get(f"/api/payroll/{pid}/payslip.pdf", headers=h)).status_code == 404


@pytest.mark.asyncio
async def test_running_a_period_again_does_not_lose_the_advance(db, hotel):
    """Pressed twice, the advance read as already taken and fell off the payslip:
    the person kept the money and the restaurant had no record of it."""
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Ada", salary_type="MONTHLY", monthly_salary=Decimal("2600")
    )
    await emp_service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    await service.create_advance(
        db, hotel.id, employee_id=emp.id, amount=Decimal("60"), deduct_period="2026-06"
    )
    for _ in range(3):
        rec = await service.process_payroll(db, emp, "2026-06")
        assert rec.advance_deduction == Decimal("60.00")
    (adv,) = await service.list_advances(db, hotel.id, emp.id)
    await db.refresh(adv)
    assert adv.amount_recovered == Decimal("60.00") and adv.is_deducted is True
