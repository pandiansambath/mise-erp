"""Money SET ASIDE is not money spent (checklist 58.12).

His August report, page 3 — "RESERVES / CASH-FLOW ITEMS — NOT P&L EXPENSE":

    Rent reserve          £8,500.00   Reserve / transfer — not added to August P&L expense
    Chef salary reserve   £1,300.00   Reserve / transfer — not added to August P&L expense

A reserve is money moved into a pot to pay later. Counting it as cost books
the rent twice: once when it is put aside, again when it is actually paid.

What these hold:
  * a set-aside category's expenses are out of EVERY profit figure — the
    expense totals, the P&L, the dashboard, the Money page, the business
    report's tables, the supplier report and the assistant's tools;
  * they are not lost: the business report lists them in their own section,
    in all four formats, and the P&L export prints them apart;
  * flipping the flag moves a category's whole history in or out of profit;
  * the categories the app books REAL cost into by itself — received stock,
    approved wages — can never be marked set aside.

⚠️ The flag is the only signal. Nothing here matches "reserve" in a name.
"""
import io
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.assistant import tools
from app.audit.models import AuditEvent
from app.auth.models import Role
from app.expenses import service as exp
from app.expenses.models import Expense, ExpenseCategory
from app.reports import export, insights, mbr, service
from app.sales import service as sales

D = date(2026, 8, 10)
F, T = date(2026, 8, 1), date(2026, 8, 31)
Q = "date_from=2026-08-01&date_to=2026-08-31"


@pytest.fixture
async def owner(make_user):
    return await make_user("owner@reserves.test", Role.SUPER_ADMIN.value)


async def _seed(db, hotel_id, *, on: date = D) -> dict:
    """£3,000 of cash sales; £400 veg + £1,000 rent spent; £9,800 set aside.

    So profit is £1,600 — and would be -£8,200 if the reserves were counted.
    The rent reserve carries a "supplier" and £5 of VAT on purpose: neither
    may drag it into the supplier tables or the VAT total.
    """
    from app.vendors import service as ven

    await sales.ensure_default_channels(db, hotel_id)
    chans = {c.name: c for c in await sales.list_channels(db, hotel_id)}
    day = await sales.upsert_day(db, hotel_id, on)
    await sales.add_line(db, day, chans["Dine-In"].id, Decimal("3000"), "CASH")

    await exp.ensure_default_categories(db, hotel_id)
    cats = {c.name: c for c in await exp.list_categories(db, hotel_id)}
    rent_reserve = await exp.create_category(
        db, hotel_id, "Rent reserve", "FIXED", is_transfer=True
    )
    chef_reserve = await exp.create_category(
        db, hotel_id, "Chef salary reserve", "FIXED", is_transfer=True
    )
    landlord = await ven.create_vendor(db, hotel_id, name="Landlord Ltd")

    await exp.create_expense(
        db, hotel_id, category_id=cats["Vegetables"].id, date=on, amount=Decimal("400")
    )
    await exp.create_expense(
        db, hotel_id, category_id=cats["Rent"].id, date=on, amount=Decimal("1000")
    )
    await exp.create_expense(
        db, hotel_id, category_id=rent_reserve.id, date=on, amount=Decimal("8500"),
        vat_amount=Decimal("5"), vendor_id=landlord.id,
    )
    await exp.create_expense(
        db, hotel_id, category_id=chef_reserve.id, date=on, amount=Decimal("1300")
    )
    return {"rent_reserve": rent_reserve, "chef_reserve": chef_reserve, "landlord": landlord}


# ── out of every profit figure ────────────────────────────────────────────


async def test_set_aside_money_is_out_of_every_spend_total(db, hotel) -> None:
    """`expense_service.summary` is where every P&L reads its costs from, so
    the split is proved here first."""
    await _seed(db, hotel.id)
    s = await exp.summary(db, hotel.id, F, T)

    assert s["fixed_total"] == Decimal("1000")
    assert s["variable_total"] == Decimal("400")
    assert s["grand_total"] == Decimal("1400")
    assert s["vat_total"] == Decimal("0"), "a reserve's VAT is not reclaimable spend"
    assert {c["category_name"] for c in s["by_category"]} == {"Vegetables", "Rent"}

    # …and not lost.
    assert s["reserves_total"] == Decimal("9800")
    assert [(c["category_name"], c["total"]) for c in s["reserves"]] == [
        ("Rent reserve", Decimal("8500")),
        ("Chef salary reserve", Decimal("1300")),
    ]


async def test_profit_ignores_set_aside_money(db, hotel) -> None:
    """⭐ The P&L, the dashboard and the Money page all agree: £1,600 profit,
    not the -£8,200 it would be with £9,800 of reserves counted as cost."""
    await _seed(db, hotel.id)

    p = await service.pnl(db, hotel.id, F, T)
    assert p["cost_of_sales"] == Decimal("400")
    assert p["operating_expenses"] == Decimal("1000")
    assert p["net_profit"] == Decimal("1600.00")
    assert {c["category_name"] for c in p["expense_breakdown"]} == {"Vegetables", "Rent"}
    assert p["reserves_total"] == Decimal("9800")

    dash = await service.dashboard(db, hotel.id, on=date(2026, 8, 20))
    assert dash["month_expenses"] == Decimal("1400.00")
    assert dash["month_net_profit"] == Decimal("1600.00")

    money = await insights.money_centre(db, hotel.id, F, T)
    assert money["net_profit"] == Decimal("1600.00")
    # Break-even is fixed cost ÷ margin. A reserve is not a cost to break even on.
    assert money["break_even"]["fixed_costs"] == Decimal("1000")


async def test_the_apis_declare_the_reserves(client, auth_header, owner, db) -> None:
    """`response_model` DROPS undeclared fields — nine times in this codebase.
    A reserve total that never reaches the page is a reserve nobody can see."""
    await _seed(db, owner.hotel_id)
    h = auth_header(owner)

    s = (await client.get(f"/api/expenses/summary?{Q}", headers=h)).json()
    assert Decimal(s["grand_total"]) == Decimal("1400")
    assert Decimal(s["reserves_total"]) == Decimal("9800")
    assert {c["category_name"] for c in s["reserves"]} == {"Rent reserve", "Chef salary reserve"}

    p = (await client.get(f"/api/reports/pnl?{Q}", headers=h)).json()
    assert Decimal(p["net_profit"]) == Decimal("1600.00")
    assert Decimal(p["reserves_total"]) == Decimal("9800")

    cats = (await client.get("/api/expenses/categories", headers=h)).json()
    flags = {c["name"]: c["is_transfer"] for c in cats}
    assert flags["Rent reserve"] is True
    assert flags["Rent"] is False

    rows = (await client.get(f"/api/expenses?{Q}", headers=h)).json()
    marked = {r["category_name"]: r["is_transfer"] for r in rows}
    assert marked == {
        "Vegetables": False,
        "Rent": False,
        "Rent reserve": True,
        "Chef salary reserve": True,
    }


async def test_the_supplier_report_does_not_count_it_as_paid(db, hotel) -> None:
    """A reserve with a landlord named on it was not paid to the landlord — and
    the supplier report must agree with the business report's supplier table."""
    from app.vendors import report as vendor_report

    seeded = await _seed(db, hotel.id)
    r = await vendor_report.build(db, hotel.id, seeded["landlord"].id, F, T)
    by = {s.key: s for s in r["sections"]}
    paid = {row[0]: row[1] for row in by["summary"].rows}["Paid"]
    assert paid == Decimal("0")
    assert by["payments"].rows == []


async def test_the_assistant_is_told_it_is_set_aside(db, hotel, make_user) -> None:
    """The copilot answers "what did I spend" from these tools. It must not be
    handed a total with the rent reserve inside it — nor lose the reserve."""
    user = await make_user("ai@reserves.test", Role.SUPER_ADMIN.value)
    await _seed(db, hotel.id, on=date.today())

    spent = await tools.expenses_summary(db, user, {})
    assert Decimal(spent["total"]) == Decimal("1400")
    assert Decimal(spent["set_aside_not_spent"]) == Decimal("9800")

    profit = await tools.profit_for_range(db, user, {})
    assert Decimal(profit["net_profit"]) == Decimal("1600.00")
    assert Decimal(profit["set_aside_not_in_profit"]) == Decimal("9800")


# ── the Reserves section of the business report ──────────────────────────


async def test_the_business_report_lists_them_on_their_own(db, hotel) -> None:
    """His page 3, as a section — and in NONE of the tables that add up to cost."""
    await _seed(db, hotel.id)
    report = await mbr.build(db, hotel.id, F, T)
    by = {s.key: s for s in report["sections"]}

    assert "reserves" in mbr.ALL_KEYS
    res = by["reserves"]
    assert [row[:2] for row in res.rows] == [
        ["Rent reserve", Decimal("8500")],
        ["Chef salary reserve", Decimal("1300")],
    ]
    assert res.total[1] == Decimal("9800")

    # The categories table totals to the P&L's costs, not costs + reserves.
    assert by["categories"].total[2] == Decimal("1400")
    # A rent reserve is FIXED with no supplier — the exact shape the services
    # table selects — so this is the one most likely to double-list it.
    assert [row[0] for row in by["services"].rows] == ["Rent"]
    assert [row[0] for row in by["vendors"].rows] == []

    headline = {row[0]: row[1] for row in by["summary"].rows}
    assert headline["Net profit"] == Decimal("1600.00")
    assert headline["Set aside (reserves)"] == Decimal("9800")


async def test_no_reserves_is_an_empty_section_not_a_headline_row(db, hotel) -> None:
    """A restaurant that keeps no reserves gets an empty table with a zero
    total — and no "Set aside" line among its headline numbers."""
    await exp.ensure_default_categories(db, hotel.id)
    report = await mbr.build(db, hotel.id, F, T, ["summary", "reserves"])
    by = {s.key: s for s in report["sections"]}
    assert by["reserves"].rows == []
    assert by["reserves"].total[1] == Decimal("0")
    assert "Set aside (reserves)" not in {row[0] for row in by["summary"].rows}


async def test_the_reserves_section_is_in_all_four_formats(
    client, auth_header, owner, db
) -> None:
    """One structure, four renderers — so the section is checked in each file,
    not assumed from the preview."""
    from docx import Document
    from openpyxl import load_workbook

    await _seed(db, owner.hotel_id)
    h = auth_header(owner)
    title = "Reserves — set aside, not spent"

    preview = (await client.get(f"/api/reports/mbr?{Q}", headers=h)).json()
    sec = next(s for s in preview["sections"] if s["key"] == "reserves")
    assert sec["title"] == title
    assert sec["rows"][0][:2] == ["Rent reserve", "£8,500.00"]
    assert sec["total"][1] == "£9,800.00"

    csv = await client.get(f"/api/reports/mbr.csv?{Q}", headers=h)
    text = csv.content.decode("utf-8-sig")
    assert title in text and "£8,500.00" in text and "Chef salary reserve" in text

    xlsx = await client.get(f"/api/reports/mbr.xlsx?{Q}", headers=h)
    wb = load_workbook(io.BytesIO(xlsx.content))
    assert title in wb.sheetnames
    values = [c.value for row in wb[title].iter_rows() for c in row]
    assert 8500.0 in values, "the reserve went into Excel as text, or not at all"

    docx = await client.get(f"/api/reports/mbr.docx?{Q}", headers=h)
    doc = Document(io.BytesIO(docx.content))
    cells = [c.text for t in doc.tables for row in t.rows for c in row.cells]
    assert "Rent reserve" in cells and "£8,500.00" in cells

    pdf = await client.get(f"/api/reports/mbr.pdf?{Q}", headers=h)
    assert pdf.status_code == 200
    assert pdf.content[:4] == b"%PDF"


async def test_the_pnl_export_prints_them_apart(db, hotel) -> None:
    """Out of profit must not mean out of the document an accountant reads."""
    await _seed(db, hotel.id)
    p = await service.pnl(db, hotel.id, F, T)
    text = export.to_csv(p).decode("utf-8")
    head, _, tail = text.partition("Set aside — not spent, not in profit")
    assert tail, "the P&L export has no set-aside block"
    assert "Rent reserve" not in head, "a reserve is sitting in the expense breakdown"
    assert "Rent reserve" in tail
    assert export.to_xlsx(p)[:2] == b"PK"
    assert export.to_pdf(p)[:4] == b"%PDF"


# ── the flag, and moving it ───────────────────────────────────────────────


async def test_toggling_the_flag_moves_the_money(client, auth_header, owner, db) -> None:
    """⭐ The flag is on the CATEGORY, so flipping it moves every past expense
    in it — into profit, and back out — and each flip is on the record."""
    seeded = await _seed(db, owner.hotel_id)
    h = auth_header(owner)
    rid = seeded["rent_reserve"].id

    async def profit() -> Decimal:
        return Decimal((await client.get(f"/api/reports/pnl?{Q}", headers=h)).json()["net_profit"])

    async def reserve_rows() -> list[str]:
        r = (await client.get(f"/api/reports/mbr?{Q}&sections=reserves", headers=h)).json()
        return [row[0] for row in r["sections"][0]["rows"]]

    assert await profit() == Decimal("1600.00")

    off = await client.patch(f"/api/expenses/categories/{rid}", headers=h, json={"is_transfer": False})
    assert off.status_code == 200, off.text
    assert off.json()["is_transfer"] is False
    assert await profit() == Decimal("-6900.00"), "the £8,500 should now be a cost"
    assert await reserve_rows() == ["Chef salary reserve"]

    on = await client.patch(f"/api/expenses/categories/{rid}", headers=h, json={"is_transfer": True})
    assert on.status_code == 200, on.text
    assert on.json()["is_transfer"] is True
    assert await profit() == Decimal("1600.00")
    assert await reserve_rows() == ["Rent reserve", "Chef salary reserve"]

    events = (
        await db.execute(
            select(AuditEvent).where(
                AuditEvent.hotel_id == owner.hotel_id, AuditEvent.action == "expense.reserve"
            )
        )
    ).scalars().all()
    assert len(events) == 2, "both flips must be on the record, with a name against them"

    # A rename that leaves the flag alone is not a flip and is not audited as one.
    renamed = await client.patch(
        f"/api/expenses/categories/{rid}", headers=h, json={"name": "Rent pot"}
    )
    assert renamed.status_code == 200
    assert renamed.json()["is_transfer"] is True


async def test_a_new_category_can_be_set_aside_from_the_start(client, auth_header, owner) -> None:
    h = auth_header(owner)
    made = await client.post(
        "/api/expenses/categories", headers=h,
        json={"name": "VAT pot", "kind": "FIXED", "is_transfer": True},
    )
    assert made.status_code == 201, made.text
    assert made.json()["is_transfer"] is True

    plain = await client.post(
        "/api/expenses/categories", headers=h, json={"name": "Flowers", "kind": "VARIABLE"}
    )
    assert plain.json()["is_transfer"] is False, "spending is the default, not set aside"


async def test_nothing_is_set_aside_by_its_name(db, hotel) -> None:
    """⚠️ NO NAME MATCHING. A category called "Rent reserve" that nobody has
    marked is spending — guessing from the word is the silently-wrong pattern
    this flag exists to replace."""
    await exp.ensure_default_categories(db, hotel.id)
    unmarked = await exp.create_category(db, hotel.id, "Rent reserve", "FIXED")
    await exp.create_expense(db, hotel.id, category_id=unmarked.id, date=D, amount=Decimal("500"))
    s = await exp.summary(db, hotel.id, F, T)
    assert s["fixed_total"] == Decimal("500")
    assert s["reserves_total"] == Decimal("0")


# ── where real cost lands can never be set aside ──────────────────────────


async def test_received_stock_and_wages_cannot_be_set_aside(
    client, auth_header, owner, db
) -> None:
    """One click would take every delivery, or every payslip, out of profit —
    so the two categories the app books into by itself refuse the flag."""
    h = auth_header(owner)
    await client.get("/api/expenses/categories", headers=h)  # seeds the defaults

    stock = await client.post(
        "/api/expenses/categories", headers=h,
        json={"name": "Stock purchases", "kind": "VARIABLE", "is_transfer": True},
    )
    assert stock.status_code == 409
    assert "food bought" in stock.json()["detail"]

    wages = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.hotel_id == owner.hotel_id, ExpenseCategory.name == "Staff Salaries"
        )
    )
    refused = await client.patch(
        f"/api/expenses/categories/{wages.id}", headers=h, json={"is_transfer": True}
    )
    assert refused.status_code == 409
    await db.refresh(wages)
    assert wages.is_transfer is False

    # A set-aside category cannot be RENAMED into the place deliveries land.
    pot = await exp.create_category(db, owner.hotel_id, "Pot", "FIXED", is_transfer=True)
    sneaky = await client.patch(
        f"/api/expenses/categories/{pot.id}", headers=h, json={"name": "Stock purchases"}
    )
    assert sneaky.status_code == 409


async def test_a_category_holding_real_wages_cannot_be_set_aside(
    client, auth_header, owner, db
) -> None:
    """Caught by what is IN the category, not only by its name — a renamed one
    still holding approved wages is still where pay went."""
    h = auth_header(owner)
    cat = await exp.create_category(db, owner.hotel_id, "Kitchen wages", "FIXED")
    db.add(
        Expense(
            hotel_id=owner.hotel_id, category_id=cat.id, date=D, amount=Decimal("900"),
            description="Payroll 2026-08 · Chef [payroll:00000000-0000-0000-0000-000000000001]",
        )
    )
    await db.commit()
    res = await client.patch(
        f"/api/expenses/categories/{cat.id}", headers=h, json={"is_transfer": True}
    )
    assert res.status_code == 409
    assert "wages" in res.json()["detail"]


async def test_a_category_holding_a_delivery_cannot_be_set_aside(db, hotel) -> None:
    """Received stock renamed away from "Stock purchases" is still food bought."""
    from app.inventory import service as inv
    from app.purchasing import service as purchasing
    from app.vendors import service as ven

    rice = await inv.create_item(db, hotel.id, name="Rice", unit="kg")
    v = await ven.create_vendor(db, hotel.id, name="V1")
    await ven.upsert_vendor_item(db, v.id, rice.id, Decimal("5.00"))
    await ven.set_preferred_vendor(db, hotel.id, rice.id, v.id)
    indent = await purchasing.create_indent(
        db, hotel.id, [{"item_id": rice.id, "required_qty": Decimal("10")}]
    )
    po = (await purchasing.generate_pos(db, indent))["purchase_orders"][0]
    await purchasing.receive_po(db, po)

    booked = await db.scalar(select(Expense).where(Expense.purchase_order_id == po.id))
    cat = await db.get(ExpenseCategory, booked.category_id)
    cat.name = "Food bought"
    await db.commit()

    why = await exp.transfer_refusal(db, hotel.id, cat.name, cat.id)
    assert why and "food bought" in why
