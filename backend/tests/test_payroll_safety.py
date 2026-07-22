"""Payroll safety: the double-pay kill-switch, overlap guard, preview dry-run,
and the payroll→expenses bridge. These are the confusion-report fixes."""
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.auth.models import Role
from app.employees import service as emp_service
from app.expenses.models import Expense


@pytest.mark.asyncio
async def test_monthly_all_run_excludes_hourly_staff(client, make_user, auth_header, db, hotel):
    """THE FIX: an hourly (weekly-paid) person must NEVER land in a monthly
    all-staff run — that's how the same hours got paid twice."""
    acct = await make_user("safety1@x.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    sal = await emp_service.create_employee(
        db, hotel.id, full_name="Salaried Sam", salary_type="MONTHLY",
        monthly_salary=Decimal("2600"),
    )
    hr = await emp_service.create_employee(
        db, hotel.id, full_name="Hourly Hana", salary_type="HOURLY",
        hourly_rate=Decimal("12.00"),
    )
    for d in (1, 2, 3):
        await emp_service.set_attendance(
            db, sal, date(2026, 6, d), status="PRESENT", working_hours_value=Decimal("8"),
        )
        await emp_service.set_attendance(
            db, hr, date(2026, 6, d), status="PRESENT", working_hours_value=Decimal("8"),
        )

    resp = await client.post(
        "/api/payroll/process", headers=h, json={"pay_period": "2026-06", "working_days": 3}
    )
    assert resp.status_code == 200
    names = [r["employee_name"] for r in resp.json()]
    assert "Salaried Sam" in names
    assert "Hourly Hana" not in names  # she is paid by her weekly runs

    # and running her month EXPLICITLY is refused with a human explanation
    direct = await client.post(
        "/api/payroll/process", headers=h,
        json={"pay_period": "2026-06", "employee_id": str(hr.id)},
    )
    assert direct.status_code == 400
    assert "weekly-paid" in direct.json()["detail"]


@pytest.mark.asyncio
async def test_overlap_guard_blocks_double_pay(client, make_user, auth_header, db, hotel):
    """Paying a custom range that covers an already-paid week answers 409."""
    acct = await make_user("safety2@x.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Wes", salary_type="HOURLY", hourly_rate=Decimal("12.00")
    )
    for d in (6, 7, 8):  # inside ISO week 2026-W28 (Jul 6-12)
        await emp_service.set_attendance(
            db, emp, date(2026, 7, d), status="PRESENT", working_hours_value=Decimal("8")
        )
    week = await client.post(
        "/api/payroll/process", headers=h,
        json={"pay_period": "2026-W28", "employee_id": str(emp.id)},
    )
    assert week.status_code == 200

    clash = await client.post(
        "/api/payroll/process", headers=h,
        json={"employee_id": str(emp.id), "date_from": "2026-07-01", "date_to": "2026-07-31"},
    )
    assert clash.status_code == 409
    assert "already has pay covering" in clash.json()["detail"]

    # a range that does NOT overlap sails through
    ok = await client.post(
        "/api/payroll/process", headers=h,
        json={"employee_id": str(emp.id), "date_from": "2026-07-13", "date_to": "2026-07-19"},
    )
    assert ok.status_code == 200

    # re-running the SAME week just recomputes (upsert) — never a second record
    rerun = await client.post(
        "/api/payroll/process", headers=h,
        json={"pay_period": "2026-W28", "employee_id": str(emp.id)},
    )
    assert rerun.status_code == 200


@pytest.mark.asyncio
async def test_preview_is_a_dry_run_with_clash_warning(
    client, make_user, auth_header, db, hotel
):
    acct = await make_user("safety3@x.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Pia", salary_type="HOURLY", hourly_rate=Decimal("12.00")
    )
    for d in (6, 7):
        await emp_service.set_attendance(
            db, emp, date(2026, 7, d), status="PRESENT", working_hours_value=Decimal("8")
        )
    prev = await client.post(
        "/api/payroll/preview", headers=h,
        json={"pay_period": "2026-W28", "employee_id": str(emp.id)},
    )
    assert prev.status_code == 200
    body = prev.json()
    assert body["total_hours"] == "16.00"
    assert body["net_pay"] == "192.00"
    assert body["already_paid"] == []

    # nothing was written by the preview
    listing = await client.get("/api/payroll?pay_period=2026-W28", headers=h)
    assert listing.json() == []

    # after a real run, previewing an overlapping range WARNS instead of hiding it
    await client.post(
        "/api/payroll/process", headers=h,
        json={"pay_period": "2026-W28", "employee_id": str(emp.id)},
    )
    prev2 = await client.post(
        "/api/payroll/preview", headers=h,
        json={"employee_id": str(emp.id), "date_from": "2026-07-01", "date_to": "2026-07-31"},
    )
    assert prev2.status_code == 200
    assert prev2.json()["already_paid"][0]["pay_period"] == "2026-W28"


@pytest.mark.asyncio
async def test_approved_payroll_books_a_salary_expense(
    client, make_user, auth_header, db, hotel
):
    """Approve a payslip → it appears in Expenses ('Staff Salaries'), exactly once."""
    acct = await make_user("safety4@x.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Bala", salary_type="MONTHLY", monthly_salary=Decimal("2600")
    )
    await emp_service.set_attendance(db, emp, date(2026, 6, 2), status="PRESENT")
    run = await client.post(
        "/api/payroll/process", headers=h, json={"pay_period": "2026-06", "working_days": 1}
    )
    pid = run.json()[0]["id"]
    net = run.json()[0]["net_pay"]

    await client.post(f"/api/payroll/{pid}/approve", headers=h)
    await client.post(f"/api/payroll/{pid}/approve", headers=h)  # idempotency probe

    hid = hotel.id  # capture BEFORE expire_all — expired attrs can't lazy-load in async
    db.expire_all()
    rows = (
        await db.execute(
            select(Expense).where(
                Expense.hotel_id == hid, Expense.description.contains("[payroll:")
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert str(rows[0].amount) == net
    assert "Bala" in rows[0].description


@pytest.mark.asyncio
async def test_history_endpoint_and_statement_pdf(client, make_user, auth_header, db, hotel):
    acct = await make_user("safety5@x.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    emp = await emp_service.create_employee(
        db, hotel.id, full_name="Historia", salary_type="HOURLY", hourly_rate=Decimal("12.00")
    )
    for d in (6, 7, 13, 14):
        await emp_service.set_attendance(
            db, emp, date(2026, 7, d), status="PRESENT", working_hours_value=Decimal("8")
        )
    for wk in ("2026-W28", "2026-W29"):
        await client.post(
            "/api/payroll/process", headers=h,
            json={"pay_period": wk, "employee_id": str(emp.id)},
        )

    hist = await client.get(f"/api/payroll/history/{emp.id}", headers=h)
    assert hist.status_code == 200
    body = hist.json()
    assert body["employee"]["name"] == "Historia"
    assert len(body["runs"]) == 2
    assert {r["pay_period"] for r in body["runs"]} == {"2026-W28", "2026-W29"}

    pdf = await client.get(f"/api/payroll/history/{emp.id}/statement.pdf", headers=h)
    assert pdf.status_code == 200
    assert pdf.content[:4] == b"%PDF"


@pytest.mark.asyncio
async def test_fixed_expense_duplicate_guard_and_carry_forward(
    client, make_user, auth_header, db, hotel
):
    """Rent twice in one month → 409 warning (force overrides). A MONTHLY
    recurring expense materialises next month's copy automatically."""
    from datetime import date as d
    from datetime import timedelta

    acct = await make_user("exp1@x.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    cats = (await client.get("/api/expenses/categories", headers=h)).json()
    rent = next(c for c in cats if c["name"] == "Rent")

    first = await client.post(
        "/api/expenses", headers=h,
        json={"category_id": rent["id"], "date": d.today().isoformat(),
              "amount": "1200", "payment_method": "BANK"},
    )
    assert first.status_code == 201

    dup = await client.post(
        "/api/expenses", headers=h,
        json={"category_id": rent["id"], "date": d.today().isoformat(),
              "amount": "1200", "payment_method": "BANK"},
    )
    assert dup.status_code == 409
    assert "already logged this month" in dup.json()["detail"]

    forced = await client.post(
        "/api/expenses?force=true", headers=h,
        json={"category_id": rent["id"], "date": d.today().isoformat(),
              "amount": "50", "payment_method": "BANK"},
    )
    assert forced.status_code == 201

    # carry-forward: a recurring gas bill dated ~2 months ago spawns copies
    gas = next(c for c in cats if c["name"] == "Gas")
    old = (d.today() - timedelta(days=63)).isoformat()
    made = await client.post(
        "/api/expenses?force=true", headers=h,
        json={"category_id": gas["id"], "date": old, "amount": "180",
              "payment_method": "BANK", "is_recurring": True, "recurrence": "MONTHLY"},
    )
    assert made.status_code == 201
    listing = (await client.get("/api/expenses", headers=h)).json()
    gas_rows = [e for e in listing if e["category_name"] == "Gas"]
    assert len(gas_rows) >= 3  # original + at least 2 auto-materialised months
    assert any(e["auto_added"] for e in gas_rows)
    # idempotent: listing again creates nothing new
    listing2 = (await client.get("/api/expenses", headers=h)).json()
    assert len([e for e in listing2 if e["category_name"] == "Gas"]) == len(gas_rows)


@pytest.mark.asyncio
async def test_attendance_history_range_and_export(client, make_user, auth_header, db, hotel):
    """Per-person attendance history over a range: totals + indicative pay, and a
    range xlsx download."""
    from datetime import date as d

    from app.employees import service as es

    acct = await make_user("att1@x.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    emp = await es.create_employee(
        db, hotel.id, full_name="Rita", salary_type="HOURLY", hourly_rate=Decimal("12.00")
    )
    for day in (6, 7, 8):
        await es.set_attendance(db, emp, d(2026, 7, day), status="PRESENT",
                                working_hours_value=Decimal("8"))

    hist = await client.get(
        f"/api/attendance/history/{emp.id}?date_from=2026-07-01&date_to=2026-07-31", headers=h
    )
    assert hist.status_code == 200
    body = hist.json()
    assert body["employee"]["name"] == "Rita"
    assert body["totals"]["present"] == 3
    assert body["totals"]["total_hours"] == "24.00"
    assert body["totals"]["indicative_pay"] == "288.00"  # 24h × £12

    xlsx = await client.get(
        "/api/attendance/range.xlsx?date_from=2026-07-01&date_to=2026-07-31", headers=h
    )
    assert xlsx.status_code == 200
    assert xlsx.content[:2] == b"PK"  # xlsx is a zip
