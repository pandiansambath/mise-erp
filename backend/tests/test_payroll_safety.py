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

    acct = await make_user("att1@x.com", Role.SUPER_ADMIN.value)
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


@pytest.mark.asyncio
async def test_one_persons_attendance_excel_holds_only_that_person(
    client, make_user, auth_header, db, hotel
):
    """The "↓ Excel" on a person's history. It called a route that never existed,
    so every click was a 422 and nothing downloaded."""
    import io
    from datetime import date as d

    from openpyxl import load_workbook

    from app.employees import service as es
    from app.hotels.models import Hotel

    h = auth_header(await make_user("att2@x.com", Role.SUPER_ADMIN.value))
    rita = await es.create_employee(db, hotel.id, full_name="Rita")
    sam = await es.create_employee(db, hotel.id, full_name="Sam")
    for emp in (rita, sam):
        await es.set_attendance(db, emp, d(2026, 7, 6), status="PRESENT",
                                working_hours_value=Decimal("8"))

    url = "/api/attendance/range.xlsx?date_from=2026-07-01&date_to=2026-07-31"
    r = await client.get(f"{url}&employee_id={rita.id}", headers=h)
    assert r.status_code == 200, r.text
    cells = {
        str(c) for ws in load_workbook(io.BytesIO(r.content)).worksheets
        for row in ws.iter_rows(values_only=True) for c in row if c is not None
    }
    assert any("Rita" in c for c in cells)
    assert not any("Sam" in c for c in cells), "another person's row in their file"

    # Another restaurant's employee id brings back none of their attendance.
    other = Hotel(name="Elsewhere", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    stranger = await es.create_employee(db, other.id, full_name="Zed")
    await es.set_attendance(db, stranger, d(2026, 7, 6), status="PRESENT",
                            working_hours_value=Decimal("8"))
    r = await client.get(f"{url}&employee_id={stranger.id}", headers=h)
    assert r.status_code == 200
    cells = {
        str(c) for ws in load_workbook(io.BytesIO(r.content)).worksheets
        for row in ws.iter_rows(values_only=True) for c in row if c is not None
    }
    assert not any("Zed" in c for c in cells)


@pytest.mark.asyncio
async def test_staff_email_verification_and_admin_controls(
    client, make_user, auth_header, db, hotel
):
    """New staff logins must verify before entering; the admin can see status,
    resend, change email, reset password, deactivate — all audited."""
    from sqlalchemy import select as _select

    from app.auth.models import User
    from app.employees import service as es

    admin = await make_user("boss@x.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    emp = await es.create_employee(db, hotel.id, full_name="Priya")
    emp_id = emp.id  # capture BEFORE any expire_all — the URLs reuse it later

    made = await client.post(
        f"/api/employees/{emp_id}/account", headers=h,
        json={"email": "priya@staff.com", "password": "StaffPass123", "role": "STAFF"},
    )
    assert made.status_code == 200

    # unverified → gets IN (loosened 2026-09-05), but the recovery route stays
    # shut. That pairing is the whole design: an address nobody has proved they
    # own must never become a way back into the account, or a typo becomes a
    # way into someone else's.
    ok = await client.post(
        "/api/auth/login", json={"email": "priya@staff.com", "password": "StaffPass123"}
    )
    assert ok.status_code == 200, ok.text

    reset = await client.post("/api/auth/forgot-password", json={"email": "priya@staff.com"})
    assert reset.status_code == 200, "the response must not reveal who exists"
    db.expire_all()
    unproven = (
        await db.execute(_select(User).where(User.email == "priya@staff.com"))
    ).scalar_one()
    assert unproven.reset_token is None, "an unverified address must not get a reset link"

    # admin sees the unverified chip
    login_status = await client.get(f"/api/employees/{emp_id}/login", headers=h)
    assert login_status.json()["login"]["email_verified"] is False
    assert login_status.json()["login"]["email"] == "priya@staff.com"

    # verify via the token the email carried
    db.expire_all()
    u = (await db.execute(_select(User).where(User.email == "priya@staff.com"))).scalar_one()
    assert u.verify_token
    ok = await client.post("/api/auth/verify-email", json={"token": u.verify_token})
    assert ok.status_code == 200
    now_in = await client.post(
        "/api/auth/login", json={"email": "priya@staff.com", "password": "StaffPass123"}
    )
    assert now_in.status_code == 200

    # admin controls: change email → back to unverified
    ce = await client.post(f"/api/employees/{emp_id}/login/email", headers=h,
                           json={"email": "priya2@staff.com"})
    assert ce.status_code == 200 and ce.json()["login"]["email_verified"] is False

    # reset password (staff notified, not emailed the password)
    rp = await client.post(f"/api/employees/{emp_id}/login/password", headers=h,
                           json={"password": "BrandNew456"})
    assert rp.status_code == 200

    # verify the new email, then deactivate → login refused even though verified
    db.expire_all()
    u2 = (await db.execute(_select(User).where(User.email == "priya2@staff.com"))).scalar_one()
    await client.post("/api/auth/verify-email", json={"token": u2.verify_token})
    await client.post(f"/api/employees/{emp_id}/login/active", headers=h,
                      json={"is_active": False})
    dead = await client.post(
        "/api/auth/login", json={"email": "priya2@staff.com", "password": "BrandNew456"}
    )
    assert dead.status_code == 401  # inactive users can't authenticate

    # the audit history tells the whole story
    hist = await client.get(f"/api/employees/{emp_id}/history", headers=h)
    actions = {e["action"] for e in hist.json()["events"]}
    assert {"staff.account_created", "staff.email_changed", "staff.password_reset"} <= actions


@pytest.mark.asyncio
async def test_payslips_go_only_to_the_persons_own_login(
    client, make_user, auth_header, db, hotel, monkeypatch
):
    """A payslip is private: an approved one, to that person's login, never a draft."""
    from app.core import notify
    from app.employees import service as es
    from app.hotels.models import Hotel
    from app.payroll.models import Payroll

    sent: list[dict] = []

    async def fake_send(to, subject, text, html=None, attachments=None):
        sent.append({"to": to, "attachments": attachments})
        return True

    monkeypatch.setattr(notify, "send_email", fake_send)
    h = auth_header(await make_user("pay-admin@x.com", Role.SUPER_ADMIN.value))
    staff = await make_user("rita-login@x.com", Role.STAFF.value)
    rita = await es.create_employee(db, hotel.id, full_name="Rita")
    rita.user_id = staff.id
    sam = await es.create_employee(db, hotel.id, full_name="Sam")  # no login

    def slip(emp, status, period="2026-07"):
        return Payroll(
            hotel_id=hotel.id, employee_id=emp.id, pay_period=period, status=status,
            gross_pay=Decimal("100"), net_pay=Decimal("100"),
        )

    good, draft, nologin = slip(rita, "APPROVED"), slip(rita, "DRAFT", "2026-06"), slip(sam, "PAID")
    db.add_all([good, draft, nologin])
    await db.commit()

    r = await client.post(f"/api/payroll/{good.id}/email", headers=h)
    assert r.status_code == 200, r.text
    assert [s["to"] for s in sent] == ["rita-login@x.com"]
    assert sent[0]["attachments"][0]["filename"].endswith(".pdf")

    assert (await client.post(f"/api/payroll/{draft.id}/email", headers=h)).status_code == 409
    assert (await client.post(f"/api/payroll/{nologin.id}/email", headers=h)).status_code == 409
    assert len(sent) == 1

    sent.clear()
    bulk = await client.post("/api/payroll/email-all?pay_period=2026-07", headers=h)
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["sent"] == 1
    assert "Sam" in bulk.json()["skipped"][0]
    assert [s["to"] for s in sent] == ["rita-login@x.com"]

    # Staff cannot send; another restaurant cannot reach the payslip.
    r = await client.post(f"/api/payroll/{good.id}/email", headers=auth_header(staff))
    assert r.status_code == 403
    other = Hotel(name="Elsewhere", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    stranger = await make_user("pay-stranger@x.com", Role.SUPER_ADMIN.value, hotel_id=other.id)
    r = await client.post(f"/api/payroll/{good.id}/email", headers=auth_header(stranger))
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_running_again_never_touches_a_settled_payslip(
    client, make_user, auth_header, db, hotel
):
    """Only a draft recalculates. Approved means the money is already booked."""
    h = auth_header(await make_user("settled@x.com", Role.SUPER_ADMIN.value))
    paid = await emp_service.create_employee(
        db, hotel.id, full_name="Paid Pia", salary_type="MONTHLY", monthly_salary=Decimal("2600")
    )
    draft = await emp_service.create_employee(
        db, hotel.id, full_name="Draft Dev", salary_type="MONTHLY", monthly_salary=Decimal("2600")
    )
    await emp_service.set_attendance(db, paid, date(2026, 5, 4), status="PRESENT")

    run = await client.post("/api/payroll/process", headers=h, json={"pay_period": "2026-05"})
    assert run.status_code == 200, run.text
    slip = next(r for r in run.json() if r["employee_name"] == "Paid Pia")
    before = slip["net_pay"]
    assert float(before) > 0
    for step in ("approve", "pay"):
        r = await client.post(f"/api/payroll/{slip['id']}/{step}", headers=h)
        assert r.status_code == 200, r.text

    # More attendance would change the sum, if the run were allowed to redo it.
    await emp_service.set_attendance(db, paid, date(2026, 5, 5), status="PRESENT")
    await emp_service.set_attendance(db, draft, date(2026, 5, 5), status="PRESENT")

    # By name: refused, in words.
    one = await client.post(
        "/api/payroll/process", headers=h,
        json={"pay_period": "2026-05", "employee_id": str(paid.id)},
    )
    assert one.status_code == 409
    assert "already paid" in one.json()["detail"]

    # The whole month: the paid one is left, the draft recalculates.
    again = await client.post("/api/payroll/process", headers=h, json={"pay_period": "2026-05"})
    assert again.status_code == 200, again.text
    rows = {r["employee_name"]: r for r in again.json()}
    assert rows["Paid Pia"]["status"] == "PAID"
    assert rows["Paid Pia"]["net_pay"] == before
    assert rows["Draft Dev"]["status"] == "DRAFT"
    assert float(rows["Draft Dev"]["net_pay"]) > 0

    # The dry run says so instead of offering to pay them again.
    prev = await client.post(
        "/api/payroll/preview", headers=h,
        json={"pay_period": "2026-05", "employee_id": str(paid.id)},
    )
    assert prev.status_code == 200, prev.text
    assert prev.json()["already_paid"][0]["status"] == "PAID"
