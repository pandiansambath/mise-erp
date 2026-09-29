"""Receiving stock must reach cost of sales — once, and only for what arrived.

`reports.pnl()` reads `cost_of_sales` straight from the expenses table, so this
link is the difference between a correct P&L and one that believes the food was
free. The idempotency case matters most: part deliveries receive the same PO
more than once, and each one used to be a chance to book the cost twice.
"""

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.expenses.models import Expense, ExpenseCategory, ExpenseKind
from app.inventory import service as inv
from app.purchasing import service
from app.purchasing.expense_link import CATEGORY_NAME
from app.vendors import service as ven


async def _po_for(db, hotel_id, *, qty="10", price="5.00"):
    """One PO: `qty` of rice at `price` from its chosen vendor."""
    rice = await inv.create_item(db, hotel_id, name="Rice", unit="kg")
    v1 = await ven.create_vendor(db, hotel_id, name="V1")
    await ven.upsert_vendor_item(db, v1.id, rice.id, Decimal(price))
    await ven.set_preferred_vendor(db, hotel_id, rice.id, v1.id)
    indent = await service.create_indent(
        db, hotel_id, [{"item_id": rice.id, "required_qty": Decimal(qty)}]
    )
    return (await service.generate_pos(db, indent))["purchase_orders"][0]


async def _expenses_for(db, po):
    rows = await db.execute(select(Expense).where(Expense.purchase_order_id == po.id))
    return list(rows.scalars().all())


@pytest.mark.asyncio
async def test_receiving_posts_one_expense_for_what_arrived(db, hotel):
    po = await _po_for(db, hotel.id, qty="10", price="5.00")
    await service.receive_po(db, po)

    booked = await _expenses_for(db, po)
    assert len(booked) == 1, "receiving should post exactly one expense"
    assert booked[0].amount == Decimal("50.00")  # 10 kg x £5.00
    assert booked[0].vendor_id == po.vendor_id


@pytest.mark.asyncio
async def test_it_lands_in_cost_of_sales_not_just_a_list(db, hotel):
    """The whole point — a VARIABLE category is what the P&L counts."""
    po = await _po_for(db, hotel.id)
    await service.receive_po(db, po)

    booked = (await _expenses_for(db, po))[0]
    cat = await db.get(ExpenseCategory, booked.category_id)
    assert cat.name == CATEGORY_NAME
    assert cat.kind == ExpenseKind.VARIABLE.value


@pytest.mark.asyncio
async def test_receiving_twice_updates_rather_than_duplicating(db, hotel):
    """A part delivery receives the same PO again. That must not book it twice."""
    po = await _po_for(db, hotel.id, qty="10", price="5.00")
    await service.receive_po(db, po)
    await service.receive_po(db, po)

    booked = await _expenses_for(db, po)
    assert len(booked) == 1, "a second receive must update the expense, not add one"
    assert booked[0].amount == Decimal("50.00")


@pytest.mark.asyncio
async def test_a_short_delivery_is_not_paid_for_on_paper(db, hotel):
    """Ordered 10, only 4 turned up: book 4, not 10."""
    po = await _po_for(db, hotel.id, qty="10", price="5.00")
    poi = (await service.po_items(db, po.id))[0]
    await service.receive_po(db, po, lines={str(poi["po_item_id"]): Decimal("4")})

    booked = await _expenses_for(db, po)
    assert len(booked) == 1
    assert booked[0].amount == Decimal("20.00")  # 4 kg x £5.00, not 50


@pytest.mark.asyncio
async def test_the_hotel_can_turn_it_off(db, hotel):
    """Kitchens that key their supplier invoices in by hand would double-count."""
    hotel.prefs = {"post_purchases_to_expenses": False}
    await db.flush()

    po = await _po_for(db, hotel.id)
    await service.receive_po(db, po)

    assert await _expenses_for(db, po) == []


@pytest.mark.asyncio
async def test_keying_the_same_delivery_in_by_hand_warns(
    client, make_user, auth_header, db, hotel
):
    """His worry, made concrete.

    Receiving posts the cost automatically. Somebody then types the same
    delivery note in under "Vegetables" — a different category, but just as
    VARIABLE, so both reach cost of sales and the food is paid for twice.
    """
    from app.auth.models import Role
    from app.expenses import service as exp_service

    po = await _po_for(db, hotel.id, qty="10", price="5.00")  # £50
    await service.receive_po(db, po)

    user = await make_user("dupe@x.com", Role.SUPER_ADMIN.value)
    h = auth_header(user)
    veg = await exp_service.create_category(
        db, hotel.id, name="Vegetables", kind=ExpenseKind.VARIABLE.value
    )

    body = {
        "category_id": str(veg.id),
        "date": str(po.received_at.date()),
        "amount": "50.00",
        "vendor_id": str(po.vendor_id),
    }
    warned = await client.post("/api/expenses", headers=h, json=body)
    assert warned.status_code == 409
    assert "twice" in warned.json()["detail"]

    # Warn, never block — the same supplier really can be paid twice in a week.
    forced = await client.post("/api/expenses?force=true", headers=h, json=body)
    assert forced.status_code == 201


# ── the copy cannot be edited behind its source's back ────────────────────
#
# The page made payroll expenses read-only, but PATCH and DELETE accepted them
# — and accepted PO expenses too, which the page did not even label. So the P&L
# could be made to disagree with the goods-in record, silently.


@pytest.mark.asyncio
async def test_the_list_says_which_expenses_came_from_a_po(client, make_user, auth_header, db):
    """⚠️ `purchase_order_id` was declared on ExpenseOut and never put in the
    row, so it reached the page as null for every expense. The page could not
    label a PO expense because it was never told one was."""
    from app.auth.models import Role

    owner = await make_user("owner@po-exp.test", Role.SUPER_ADMIN.value)
    po = await _po_for(db, owner.hotel_id)
    await service.receive_po(db, po)

    rows = (
        await client.get(
            "/api/expenses?date_from=2000-01-01&date_to=2099-01-01", headers=auth_header(owner)
        )
    ).json()
    linked = [r for r in rows if r.get("purchase_order_id")]
    assert linked, "no expense in the list admits to coming from a PO"
    assert linked[0]["purchase_order_id"] == str(po.id)


@pytest.mark.asyncio
async def test_a_po_expense_cannot_be_edited_or_deleted_here(client, make_user, auth_header, db):
    from app.auth.models import Role

    owner = await make_user("owner2@po-exp.test", Role.SUPER_ADMIN.value)
    po = await _po_for(db, owner.hotel_id)
    await service.receive_po(db, po)
    exp = (await _expenses_for(db, po))[0]
    h = auth_header(owner)

    patched = await client.patch(f"/api/expenses/{exp.id}", headers=h, json={"amount": "1.00"})
    assert patched.status_code == 409, "an edit here would make the P&L disagree with the PO"
    assert "purchase order" in patched.json()["detail"]

    deleted = await client.delete(f"/api/expenses/{exp.id}", headers=h)
    assert deleted.status_code == 409

    await db.refresh(exp)
    assert exp.amount == Decimal("50.00"), "the refused edit still changed the amount"


@pytest.mark.asyncio
async def test_a_payroll_expense_is_refused_at_the_api_too(client, make_user, auth_header, db):
    """The page already refused these; the API did not."""
    from app.auth.models import Role

    owner = await make_user("owner3@po-exp.test", Role.SUPER_ADMIN.value)
    cat = ExpenseCategory(hotel_id=owner.hotel_id, name="Wages", kind=ExpenseKind.FIXED.value)
    db.add(cat)
    await db.commit()
    import datetime as _dt

    exp = Expense(
        hotel_id=owner.hotel_id, category_id=cat.id, date=_dt.date(2026, 7, 31),
        amount=Decimal("3500"), vat_amount=Decimal("0"),
        description="July wages [payroll:abc]", payment_method="BANK",
    )
    db.add(exp)
    await db.commit()

    res = await client.delete(f"/api/expenses/{exp.id}", headers=auth_header(owner))
    assert res.status_code == 409
    assert "payroll" in res.json()["detail"]


@pytest.mark.asyncio
async def test_an_ordinary_expense_is_still_editable(client, make_user, auth_header, db):
    """The guard is for copies. Everything typed on the Expenses page stays
    exactly as editable as it was."""
    from app.auth.models import Role

    owner = await make_user("owner4@po-exp.test", Role.SUPER_ADMIN.value)
    cat = ExpenseCategory(hotel_id=owner.hotel_id, name="Misc", kind=ExpenseKind.VARIABLE.value)
    db.add(cat)
    await db.commit()
    import datetime as _dt

    exp = Expense(
        hotel_id=owner.hotel_id, category_id=cat.id, date=_dt.date(2026, 7, 31),
        amount=Decimal("20"), vat_amount=Decimal("0"),
        description="Blue roll", payment_method="CASH",
    )
    db.add(exp)
    await db.commit()

    res = await client.patch(
        f"/api/expenses/{exp.id}", headers=auth_header(owner), json={"amount": "25.00"}
    )
    assert res.status_code == 200, res.text
