"""Employee & attendance tests."""
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.employees import service
from app.employees.service import working_hours


# ── Pure function ─────────────────────────────────────────────────────────
def test_working_hours_minus_break():
    ci = datetime(2026, 6, 1, 9, 0, tzinfo=UTC)
    co = datetime(2026, 6, 1, 17, 0, tzinfo=UTC)
    assert working_hours(ci, co, 30) == Decimal("7.50")  # 8h − 30m
    assert working_hours(ci, co, 0) == Decimal("8.00")


def test_working_hours_never_negative():
    ci = datetime(2026, 6, 1, 9, 0, tzinfo=UTC)
    assert working_hours(ci, ci, 60) == Decimal("0.00")


# ── Service ────────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_employee_code_autoincrements(db, hotel):
    a = await service.create_employee(db, hotel.id, full_name="Rajkumar")
    b = await service.create_employee(db, hotel.id, full_name="Sundar")
    assert a.employee_code == "EMP001"
    assert b.employee_code == "EMP002"


@pytest.mark.asyncio
async def test_visa_alerts(db, hotel):
    today = date.today()
    soon = await service.create_employee(
        db, hotel.id, full_name="Soon", visa_expiry_date=today + timedelta(days=30)
    )
    far = await service.create_employee(
        db, hotel.id, full_name="Far", visa_expiry_date=today + timedelta(days=200)
    )
    expired = await service.create_employee(
        db, hotel.id, full_name="Expired", visa_expiry_date=today - timedelta(days=5)
    )
    alerts = await service.visa_alerts(db, hotel.id, within_days=60)
    ids = {a["employee_id"] for a in alerts}
    assert soon.id in ids
    assert expired.id in ids  # already expired -> still flagged
    assert far.id not in ids  # 200 days away
    # expired sorts first (most negative days_left)
    assert alerts[0]["employee_id"] == expired.id


@pytest.mark.asyncio
async def test_punch_flow(db, hotel):
    emp = await service.create_employee(db, hotel.id, full_name="Mohamed")
    rec = await service.punch(db, emp, "CLOCK_IN")
    assert rec.clock_in is not None
    with pytest.raises(service.PunchError):
        await service.punch(db, emp, "CLOCK_IN")  # double clock-in
    await service.punch(db, emp, "BREAK_START")
    await service.punch(db, emp, "BREAK_END")
    rec = await service.punch(db, emp, "CLOCK_OUT")
    assert rec.clock_out is not None
    assert rec.working_hours is not None


@pytest.mark.asyncio
async def test_break_before_clock_in_fails(db, hotel):
    emp = await service.create_employee(db, hotel.id, full_name="X")
    with pytest.raises(service.PunchError):
        await service.punch(db, emp, "BREAK_START")


# ── API + RBAC ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_manager_can_add_employee(client, make_user, auth_header):
    mgr = await make_user("mgr@nirai.com", Role.MANAGER.value)
    resp = await client.post(
        "/api/employees",
        headers=auth_header(mgr),
        json={"full_name": "New Chef", "job_title": "Chef", "salary_type": "MONTHLY", "monthly_salary": "2200"},
    )
    assert resp.status_code == 201
    assert resp.json()["employee_code"] == "EMP001"


@pytest.mark.asyncio
async def test_cashier_cannot_view_employees(client, make_user, auth_header):
    cashier = await make_user("cash@nirai.com", Role.CASHIER.value)
    resp = await client.get("/api/employees", headers=auth_header(cashier))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_accountant_can_view_employees(client, make_user, auth_header):
    acct = await make_user("acct@nirai.com", Role.ACCOUNTANT.value)
    resp = await client.get("/api/employees", headers=auth_header(acct))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_punch_via_api(client, make_user, auth_header):
    mgr = await make_user("mgr@nirai.com", Role.MANAGER.value)
    h = auth_header(mgr)
    emp = (await client.post("/api/employees", headers=h, json={"full_name": "Punchy"})).json()
    resp = await client.post(
        "/api/attendance/punch", headers=h, json={"employee_id": emp["id"], "type": "CLOCK_IN"}
    )
    assert resp.status_code == 200
    assert resp.json()["clock_in"] is not None


@pytest.mark.asyncio
async def test_timesheet_pdf_and_xlsx(client, make_user, auth_header):
    """Attendance timesheet exports as a valid PDF and Excel file."""
    mgr = await make_user("mgr@nirai.com", Role.MANAGER.value)
    h = auth_header(mgr)
    emp = (await client.post("/api/employees", headers=h, json={"full_name": "Punchy"})).json()
    await client.post(
        "/api/attendance/punch", headers=h, json={"employee_id": emp["id"], "type": "CLOCK_IN"}
    )
    pdf = await client.get("/api/attendance/timesheet.pdf", headers=h)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"

    xlsx = await client.get("/api/attendance/timesheet.xlsx", headers=h)
    assert xlsx.status_code == 200
    assert xlsx.content[:2] == b"PK"  # xlsx is a zip


@pytest.mark.asyncio
async def test_employees_isolated_between_hotels(client, make_user, auth_header, db):
    from app.hotels.models import Hotel

    other = Hotel(name="Other", country="IN", base_currency="INR")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    a = await make_user("a@nirai.com", Role.SUPER_ADMIN.value)
    b = await make_user("a@other.com", Role.SUPER_ADMIN.value, hotel_id=other.id)
    await client.post("/api/employees", headers=auth_header(a), json={"full_name": "Mine"})
    other_list = (await client.get("/api/employees", headers=auth_header(b))).json()
    assert other_list == []
