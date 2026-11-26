"""An unfinished run is said out loud, and its days can be taken into the next one.

    "yesterday I selected 1 person, 1 week… and ran… but not approved… then I went
     to the next week and selected the same person… and ran… the confusion I got
     is the previous week also I didn't finish… we need to be very transparent"

So a new run says, for each person, which of their runs are still a draft or
approved and not paid; and one of the answers is to take those days into the run
being made, so that one payslip covers both weeks. A paid run's days never move.
"""
import uuid
from datetime import date
from decimal import Decimal as D

import pytest
from sqlalchemy import func, select

from app.audit.models import AuditEvent
from app.auth.models import Role
from app.employees import service as es
from app.hotels.models import Hotel
from app.payroll.models import Payroll, PayrollDay, PayrollRun, SalaryAdvance

pytestmark = pytest.mark.asyncio


def aug(d: int) -> date:
    return date(2026, 8, d)


async def hourly(db, hotel, name, rate="12.00"):
    return await es.create_employee(
        db, hotel.id, full_name=name, salary_type="HOURLY", hourly_rate=D(rate)
    )


async def worked(db, emp, *days, hours="8"):
    for d in days:
        await es.set_attendance(db, emp, d, status="PRESENT", working_hours_value=D(hours))


def ask(frm, to, *people, **more) -> dict:
    return {
        "date_from": frm.isoformat(),
        "date_to": to.isoformat(),
        "people": [p if isinstance(p, dict) else {"employee_id": str(p.id)} for p in people],
        **more,
    }


def about(emp, **more) -> dict:
    return {"employee_id": str(emp.id), **more}


def who(body, emp) -> dict:
    return next(p for p in body["people"] if p["employee_id"] == str(emp.id))


@pytest.fixture
async def boss(make_user, auth_header):
    return auth_header(await make_user("boss@waiting.test", Role.SUPER_ADMIN.value))


async def make(client, h, *args, **more) -> dict:
    r = await client.post("/api/payroll/runs", headers=h, json=ask(*args, **more))
    assert r.status_code == 201, r.text
    return r.json()


async def look(client, h, *args, **more) -> dict:
    r = await client.post("/api/payroll/runs/preview", headers=h, json=ask(*args, **more))
    assert r.status_code == 200, r.text
    return r.json()


async def week_one(client, h, db, hotel):
    """The owner's case: one person, one week, saved and never approved."""
    pandian = await hourly(db, hotel, "Pandian")
    other = await hourly(db, hotel, "Other")
    await worked(db, pandian, aug(3), aug(4), aug(10), aug(11))
    await worked(db, other, aug(3))
    run = await make(
        client, h, aug(3), aug(9), pandian, other,
    )
    slip = next(s for s in run["slips"] if s["employee_name"] == "Pandian")
    return pandian, other, run, slip


async def test_a_draft_left_behind_is_said_for_that_person(client, boss, db, hotel):
    pandian, other, run, slip = await week_one(client, boss, db, hotel)
    body = await look(client, boss, aug(10), aug(16), pandian)
    (w,) = who(body, pandian)["waiting"]
    assert (w["number"], w["status"], w["net"], w["days"]) == (run["number"], "DRAFT", "192.00", 2)
    assert w["label"] == "3 to 9 Aug 2026" and w["taken"] is False
    # The list page's line, and the run sheet's.
    waiting = (await client.get("/api/payroll/waiting", headers=boss)).json()
    assert waiting["drafts"] == 2 and waiting["approved"] == 0
    assert {p["name"] for p in waiting["people"]} == {"Pandian", "Other"}
    new = await make(client, boss, aug(10), aug(16), pandian)
    (s,) = new["slips"]
    assert [o["number"] for o in s["others"]] == [run["number"]]
    # Approved and not paid is still waiting; paid is not.
    await client.post(f"/api/payroll/runs/{run['id']}/approve", headers=boss, json={})
    body = await look(client, boss, aug(17), aug(23), pandian)
    assert {w["status"] for w in who(body, pandian)["waiting"]} == {"APPROVED", "DRAFT"}
    await client.post(
        f"/api/payroll/runs/{run['id']}/pay", headers=boss,
        json={"paid_on": "2026-08-20", "method": "BANK"},
    )
    body = await look(client, boss, aug(17), aug(23), pandian)
    assert [w["number"] for w in who(body, pandian)["waiting"]] == [new["number"]]


async def test_taking_those_days_in_makes_one_payslip_for_both_weeks(client, boss, db, hotel):
    pandian, other, run, slip = await week_one(client, boss, db, hotel)
    me = about(pandian, take_from=[slip["id"]])
    body = await look(client, boss, aug(10), aug(16), me, detail=[str(pandian.id)])
    p = who(body, pandian)
    assert p["net"] == "384.00", "both weeks, worked out here"
    assert [d["date"] for d in p["day_lines"] if d["include"]] == [
        "2026-08-03", "2026-08-04", "2026-08-10", "2026-08-11",
    ]
    assert p["waiting"][0]["taken"] is True and p["in_run_days"] == 0
    # Nothing was written by looking.
    assert await db.scalar(select(func.count()).select_from(Payroll)) == 2

    new = await make(client, boss, aug(10), aug(16), me, expect_net="384.00")
    (s,) = new["slips"]
    assert (s["net_pay"], s["days"], s["label"]) == ("384.00", 4, "3 to 16 Aug 2026")
    assert s["others"] == []
    # Run 1 keeps its other person, and its totals are theirs alone.
    old = (await client.get(f"/api/payroll/runs/{run['id']}", headers=boss)).json()
    assert [x["employee_name"] for x in old["slips"]] == ["Other"]
    assert old["net"] == "96.00" and old["people"] == 1
    # Opened again to change it, run 1 does not put Pandian back.
    assert [p["employee_id"] for p in old["setup"]["people"]] == [str(other.id)]
    # Every day is in exactly one payslip.
    rows = (await db.execute(
        select(PayrollDay.date, func.count()).where(PayrollDay.employee_id == pandian.id)
        .group_by(PayrollDay.date)
    )).all()
    assert sorted(d for d, _ in rows) == [aug(3), aug(4), aug(10), aug(11)]
    assert all(n == 1 for _, n in rows)
    log = (await db.execute(
        select(AuditEvent.summary).where(AuditEvent.action == "payroll.take")
    )).scalars().all()
    assert len(log) == 1 and "Pandian" in log[0] and f"run {run['number']}" in log[0]


async def test_changing_the_run_afterwards_keeps_the_days_it_took_in(client, boss, db, hotel):
    """Saved once with the first week taken in, then changed (a note): the first
    week is still in it, and is not left owed in no run."""
    pandian, other, run, slip = await week_one(client, boss, db, hotel)
    new = await make(client, boss, aug(10), aug(16), about(pandian, take_from=[slip["id"]]))
    got = (await client.get(f"/api/payroll/runs/{new['id']}", headers=boss)).json()
    (kept,) = got["setup"]["people"]
    assert kept["take_from"] == [] and kept["also"] == ["2026-08-03", "2026-08-04"]
    # What the page sends back when "Change" is pressed: the setup as it is.
    again = {**got["setup"], "note": "Checked"}
    r = await client.put(f"/api/payroll/runs/{new['id']}", headers=boss, json=again)
    assert r.status_code == 200, r.text
    (s,) = r.json()["slips"]
    assert (s["net_pay"], s["days"], s["label"]) == ("384.00", 4, "3 to 16 Aug 2026")
    # "Same again" does not carry them on to the week after.
    nxt = (await client.get(f"/api/payroll/runs/next?run_id={new['id']}", headers=boss)).json()
    assert nxt["request"]["people"][0].get("also", []) == []
    # Left out after all: back to owed, in no run.
    plain = {**again, "people": [about(pandian)]}
    r = await client.put(f"/api/payroll/runs/{new['id']}", headers=boss, json=plain)
    assert r.json()["slips"][0]["net_pay"] == "192.00"
    days = (await db.execute(
        select(PayrollDay.date).where(PayrollDay.employee_id == pandian.id)
    )).scalars().all()
    assert sorted(days) == [aug(10), aug(11)]
    # And nobody can reach far back by typing days in.
    far = about(pandian, also=["2025-01-06"])
    r = await client.post("/api/payroll/runs/preview", headers=boss, json=ask(aug(10), aug(16), far))
    assert r.status_code in (400, 422), r.text


async def test_taking_the_last_person_out_of_a_run_removes_the_run(client, boss, db, hotel):
    pandian = await hourly(db, hotel, "Pandian")
    await worked(db, pandian, aug(3), aug(10))
    run = await make(client, boss, aug(3), aug(9), pandian)
    slip = run["slips"][0]
    new = await make(
        client, boss, aug(10), aug(16), about(pandian, take_from=[slip["id"]]),
    )
    assert new["net"] == "192.00"
    assert await db.get(PayrollRun, uuid.UUID(run["id"])) is None
    r = await client.get(f"/api/payroll/runs/{run['id']}", headers=boss)
    assert r.status_code == 404


async def test_an_advance_taken_back_in_the_old_run_is_worked_out_again(client, boss, db, hotel):
    """It goes back to owed with the old payslip and comes off the new one: the
    figure on the screen and the saved one agree."""
    pandian = await hourly(db, hotel, "Pandian")
    await worked(db, pandian, aug(3), aug(10))
    db.add(SalaryAdvance(
        hotel_id=hotel.id, employee_id=pandian.id, amount=D("150"), given_date=aug(1),
        deduct_period="2026-08",
    ))
    await db.commit()
    run = await make(client, boss, aug(3), aug(9), pandian)
    assert run["net"] == "0.00"  # £96 of pay, all of it taken back
    me = about(pandian, take_from=[run["slips"][0]["id"]])
    body = await look(client, boss, aug(10), aug(16), me)
    p = who(body, pandian)
    assert (p["pay"], p["advance"], p["net"]) == ("192.00", "150.00", "42.00")
    new = await make(client, boss, aug(10), aug(16), me, expect_net="42.00")
    assert new["net"] == "42.00"
    (adv,) = (await db.execute(select(SalaryAdvance))).scalars().all()
    await db.refresh(adv)
    assert adv.amount_recovered == D("150.00") and adv.is_deducted is True


async def test_a_paid_runs_days_are_never_moved(client, boss, db, hotel):
    pandian, other, run, slip = await week_one(client, boss, db, hotel)
    await client.post(f"/api/payroll/runs/{run['id']}/approve", headers=boss, json={})
    await client.post(
        f"/api/payroll/runs/{run['id']}/pay", headers=boss,
        json={"paid_on": "2026-08-20", "method": "BANK"},
    )
    me = about(pandian, take_from=[slip["id"]])
    for path in ("/api/payroll/runs/preview", "/api/payroll/runs"):
        r = await client.post(path, headers=boss, json=ask(aug(10), aug(16), me))
        assert r.status_code == 409 and "paid" in r.json()["detail"]
    # And the guard for its days stays exactly as it was.
    body = await look(client, boss, aug(3), aug(16), pandian)
    assert who(body, pandian)["in_run_days"] == 2
    assert (await client.get(f"/api/payroll/runs/{run['id']}", headers=boss)).json()["people"] == 2


async def test_only_their_own_payslip_and_never_this_runs(client, boss, db, hotel):
    pandian, other, run, slip = await week_one(client, boss, db, hotel)
    # Somebody else's payslip, under Pandian's name.
    theirs = next(s for s in run["slips"] if s["employee_name"] == "Other")
    r = await client.post(
        "/api/payroll/runs/preview", headers=boss,
        json=ask(aug(10), aug(16), about(pandian, take_from=[theirs["id"]])),
    )
    assert r.status_code == 404
    # The very run being changed.
    r = await client.put(
        f"/api/payroll/runs/{run['id']}", headers=boss,
        json=ask(aug(3), aug(9), about(pandian, take_from=[slip["id"]]), other),
    )
    assert r.status_code == 400


async def test_another_restaurant_cannot_take_or_see(
    client, boss, db, hotel, make_user, auth_header
):
    pandian, other, run, slip = await week_one(client, boss, db, hotel)
    elsewhere = Hotel(name="Elsewhere", country="GB", base_currency="GBP", city="Leeds")
    db.add(elsewhere)
    await db.commit()
    thief = auth_header(
        await make_user("thief@waiting.test", Role.SUPER_ADMIN.value, hotel_id=elsewhere.id)
    )
    mine = await hourly(db, elsewhere, "Mine")
    await worked(db, mine, aug(10))
    r = await client.post(
        "/api/payroll/runs", headers=thief,
        json=ask(aug(10), aug(16), about(mine, take_from=[slip["id"]])),
    )
    assert r.status_code == 404
    assert (await client.get("/api/payroll/waiting", headers=thief)).json()["people"] == []
    assert await db.scalar(select(func.count()).select_from(Payroll)) == 2


async def test_seeing_is_not_taking(client, boss, db, hotel, make_user, auth_header):
    pandian, other, run, slip = await week_one(client, boss, db, hotel)
    sees = auth_header(await make_user("mgr@waiting.test", Role.MANAGER.value))
    none = auth_header(await make_user("till@waiting.test", Role.CASHIER.value))
    me = ask(aug(10), aug(16), about(pandian, take_from=[slip["id"]]))
    assert (await client.post("/api/payroll/runs/preview", headers=sees, json=me)).status_code == 200
    assert (await client.post("/api/payroll/runs", headers=sees, json=me)).status_code == 403
    assert (await client.get("/api/payroll/waiting", headers=sees)).status_code == 200
    assert (await client.get("/api/payroll/waiting", headers=none)).status_code == 403
    assert (await client.post("/api/payroll/runs/preview", headers=none, json=me)).status_code == 403
    assert await db.scalar(select(func.count()).select_from(Payroll)) == 2


async def test_a_negative_payslip_from_the_old_version_is_owed_back_not_paid(
    client, boss, db, hotel
):
    """"Paid −£3,400" was a payslip below nothing, counted as money paid out."""
    pandian = await hourly(db, hotel, "Pandian")
    other = await hourly(db, hotel, "Other")
    run = PayrollRun(
        hotel_id=hotel.id, number=1, period_start=date(2026, 7, 1),
        period_end=date(2026, 7, 31), setup={"label": "2026-07"},
    )
    db.add(run)
    await db.flush()
    for emp, net in ((pandian, "-3500"), (other, "100")):
        minus = net.startswith("-")
        db.add(Payroll(
            hotel_id=hotel.id, employee_id=emp.id, run_id=run.id, pay_period="2026-07",
            status="PAID", gross_pay=D("0") if minus else D("100"), net_pay=D(net),
            advance_deduction=D("3500") if minus else D("0"), paid_on=date(2026, 7, 31),
        ))
    await db.commit()
    body = (await client.get("/api/payroll/runs", headers=boss)).json()
    (r,) = body["runs"]
    assert (r["net"], r["paid_net"], r["owed_back"]) == ("100.00", "100.00", "3500.00")
    # Pay − taken off = they get: the minus payslip is in none of the three.
    assert (r["gross"], r["deductions"]) == ("100.00", "0.00")
    assert body["totals"]["owed_back"] == "3500.00"
    rep = await client.get(
        "/api/reports/mbr?date_from=2026-07-01&date_to=2026-07-31&sections=staff",
        headers=boss,
    )
    if rep.status_code == 200 and rep.headers["content-type"].startswith("application/json"):
        staff = next(s for s in rep.json()["sections"] if s["key"] == "staff")
        assert [row[0] for row in staff["rows"]] == ["Other"]
