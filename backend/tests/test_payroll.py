"""Payroll tests — calculation engine (critical), processing, payslip, RBAC."""
from datetime import date
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.employees import service as emp_service
from app.payroll import service
from app.payroll.calculator import MinWageError, calc_hourly, calc_monthly


# ── Calculation engine (pure, exact) ────────────────────────────────────────
def test_full_month_pay():
    r = calc_monthly(monthly_salary=Decimal("2600"), working_days=26, days_present=26)
    assert r["gross_pay"] == Decimal("2600.00")
    assert r["net_pay"] == Decimal("2600.00")


def test_absent_deduction():
    # 24 of 26 days, £2600/mo -> daily £100 -> £2400
    r = calc_monthly(monthly_salary=Decimal("2600"), working_days=26, days_present=24)
    assert r["gross_pay"] == Decimal("2400.00")


def test_half_days():
    # 25 full + 2 half of 26; daily 100 -> 2500 + 100 = 2600
    r = calc_monthly(monthly_salary=Decimal("2600"), working_days=26, days_present=25, half_days=2)
    assert r["gross_pay"] == Decimal("2600.00")


def test_overtime():
    # daily 100 -> hourly 12.5 -> 8 OT hours * 12.5 * 1.5 = 150
    r = calc_monthly(
        monthly_salary=Decimal("2600"), working_days=26, days_present=26,
        overtime_hours=Decimal("8"),
    )
    assert r["overtime_pay"] == Decimal("150.00")
    assert r["gross_pay"] == Decimal("2750.00")


def test_advance_deduction():
    r = calc_monthly(
        monthly_salary=Decimal("2600"), working_days=26, days_present=26, advance=Decimal("500")
    )
    assert r["advance_deduction"] == Decimal("500.00")
    assert r["net_pay"] == Decimal("2100.00")


def test_hourly_pay():
    r = calc_hourly(hourly_rate=Decimal("12.00"), total_hours=Decimal("40"))
    assert r["gross_pay"] == Decimal("480.00")
    assert r["net_pay"] == Decimal("480.00")


def test_hourly_below_min_wage_raises():
    with pytest.raises(MinWageError):
        calc_hourly(hourly_rate=Decimal("10.00"), total_hours=Decimal("40"))  # < £11.44


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
    rec = await service.process_payroll(db, emp, "2026-06")
    assert rec.total_hours == Decimal("40.00")
    assert rec.gross_pay == Decimal("480.00")


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
        json={"pay_period": "2026-06", "employee_id": str(emp.id)},
    )
    assert resp.status_code == 400  # below UK minimum wage
