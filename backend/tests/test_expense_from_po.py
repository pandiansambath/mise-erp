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
    warned = await client.post("/expenses", headers=h, json=body)
    assert warned.status_code == 409
    assert "twice" in warned.json()["detail"]

    # Warn, never block — the same supplier really can be paid twice in a week.
    forced = await client.post("/expenses?force=true", headers=h, json=body)
    assert forced.status_code == 201
