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


def test_break_penalty_pure():
    assert service.break_penalty(40, 30, Decimal("0.50")) == (10, Decimal("5.00"))
    assert service.break_penalty(20, 30, Decimal("0.50")) == (0, Decimal("0.00"))
    assert service.break_penalty(30, 30, Decimal("0.50")) == (0, Decimal("0.00"))


@pytest.mark.asyncio
async def test_attendance_penalty_in_rows(db, hotel):
    """Over-break minutes beyond the hotel allowance carry a per-minute penalty."""
    hotel.break_allowance_minutes = 30
    hotel.break_penalty_per_min = Decimal("0.50")
    await db.commit()
    emp = await service.create_employee(db, hotel.id, full_name="Over Breaker")
    rec = await service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    rec.break_minutes = 45  # 15 over the 30-min allowance
    await db.commit()

    rows = await service.list_attendance(db, hotel.id, date(2026, 6, 2))
    row = next(r for r in rows if r["employee_id"] == emp.id)
    assert row["over_break_minutes"] == 15
    assert row["break_penalty"] == Decimal("7.50")  # 15 * 0.50


@pytest.mark.asyncio
async def test_create_login_for_employee(client, make_user, auth_header):
    """Manager attaches a login to an employee; the employee can then sign in."""
    mgr = await make_user("mgr@nirai.com", Role.MANAGER.value)
    h = auth_header(mgr)
    emp = (await client.post("/api/employees", headers=h, json={"full_name": "Selvi"})).json()
    assert emp["user_id"] is None

    resp = await client.post(
        f"/api/employees/{emp['id']}/account",
        headers=h,
        json={"email": "selvi@nirai.com", "password": "StaffPass123", "role": "STAFF"},
    )
    assert resp.status_code == 200
    assert resp.json()["user_id"] is not None

    # the new staff login works
    login = await client.post(
        "/api/auth/login", json={"email": "selvi@nirai.com", "password": "StaffPass123"}
    )
    assert login.status_code == 200

    # duplicate email is rejected
    dup = await client.post(
        f"/api/employees/{emp['id']}/account",
        headers=h,
        json={"email": "selvi@nirai.com", "password": "StaffPass123", "role": "STAFF"},
    )
    assert dup.status_code == 400


@pytest.mark.asyncio
async def test_self_service_views(client, make_user, auth_header, db, hotel):
    """A linked staff login sees only their own employee record + attendance; an
    unlinked login gets 404 from /me."""
    staff = await make_user("selvi@nirai.com", Role.STAFF.value)
    emp = await service.create_employee(
        db, hotel.id, full_name="Selvi", monthly_salary=Decimal("2000")
    )
    await service.update_employee(db, emp, user_id=staff.id)  # link login -> employee
    await service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    h = auth_header(staff)

    me = await client.get("/api/me/employee", headers=h)
    assert me.status_code == 200
    assert me.json()["full_name"] == "Selvi"

    att = await client.get("/api/me/attendance", headers=h)
    assert att.status_code == 200
    assert len(att.json()) >= 1

    ps = await client.get("/api/me/payslips", headers=h)
    assert ps.status_code == 200  # empty list is fine

    # a login with no linked employee -> 404
    other = await make_user("nolink@nirai.com", Role.CASHIER.value)
    miss = await client.get("/api/me/employee", headers=auth_header(other))
    assert miss.status_code == 404


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
