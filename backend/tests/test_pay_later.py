"""Receive now, pay later (§70): stock in today, the cost in Expenses on the day it is paid.

    "receive stock into our stock but payment is still pending so that it wont
     added in expense ... once payment done then we can added in expense"

The rule these guard above all others: a purchase order's expense is posted
EXACTLY ONCE, whichever way it gets paid — on delivery, from the order, or by
one payment on the supplier page that covers several orders.

⚠️ The `db` fixture and the API are different connections. Anything read here
after an API call is re-read with `populate_existing`, or the test would be
checking the copy this session already had in memory.
"""

import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.auth.models import Role
from app.core.timezones import hotel_today
from app.expenses import service as exp_service
from app.expenses.models import Expense, ExpenseKind
from app.hotels.models import Hotel
from app.inventory import service as inv
from app.inventory.models import Item
from app.purchasing import service
from app.purchasing.models import PurchaseOrder
from app.purchasing.settle import PaidLocked, plan_settlement
from app.sales.cash import cash_expenses_for
from app.vendors import ledger
from app.vendors import service as ven
from app.vendors.models import VendorPayment

PO_URL = "/api/purchasing/purchase-orders"


# ── helpers ─────────────────────────────────────────────────────────────────
async def _catalog(db, hotel_id, *, price="1.00"):
    """Rice from ONE supplier. At the default £1/kg a quantity IS its price,
    which keeps the oldest-first sums readable."""
    rice = await inv.create_item(db, hotel_id, name="Rice", unit="kg")
    v = await ven.create_vendor(db, hotel_id, name="V1")
    await ven.upsert_vendor_item(db, v.id, rice.id, Decimal(price))
    await ven.set_preferred_vendor(db, hotel_id, rice.id, v.id)
    return rice, v


async def _po(db, hotel_id, rice, qty):
    """Another order of `qty` rice from that same supplier. (A second
    `create_vendor` with the same name raises, so every PO reuses the one.)"""
    indent = await service.create_indent(
        db, hotel_id, [{"item_id": rice.id, "required_qty": Decimal(str(qty))}]
    )
    return (await service.generate_pos(db, indent))["purchase_orders"][0]


async def _waiting(db, hotel_id, rice, dues):
    """Pay-later orders with these dues, arriving a day apart, oldest first.

    `received_at` is set by hand because it is what decides which order a
    payment pays off first, and "now" for all of them would leave that to
    the clock's resolution."""
    start = datetime.now(UTC) - timedelta(days=len(dues) + 5)
    pos = []
    for i, due in enumerate(dues):
        po = await _po(db, hotel_id, rice, due)
        await service.receive_po(db, po, pay="later")
        po.received_at = start + timedelta(days=i)
        await db.commit()
        pos.append(po)
    return pos


async def _fresh_po(db, po_id) -> PurchaseOrder:
    return (
        await db.execute(
            select(PurchaseOrder)
            .where(PurchaseOrder.id == po_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _expenses(db, **where) -> list[Expense]:
    q = select(Expense).execution_options(populate_existing=True)
    for col, val in where.items():
        q = q.where(getattr(Expense, col) == val)
    return list((await db.execute(q)).scalars())


async def _payments(db, vendor_id) -> list[VendorPayment]:
    return list(
        (
            await db.execute(
                select(VendorPayment)
                .where(VendorPayment.vendor_id == vendor_id)
                .execution_options(populate_existing=True)
            )
        ).scalars()
    )


async def _stock(db, item_id) -> Decimal:
    item = (
        await db.execute(
            select(Item).where(Item.id == item_id).execution_options(populate_existing=True)
        )
    ).scalar_one()
    return item.current_stock


async def _owner(make_user, auth_header, email="owner@paylater.test"):
    return auth_header(await make_user(email, Role.SUPER_ADMIN.value))


# ── 70.1 two ways to receive ────────────────────────────────────────────────
async def test_pay_later_puts_stock_in_and_nothing_in_expenses(db, hotel):
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")

    await service.receive_po(db, po, pay="later")

    assert await _stock(db, rice.id) == Decimal("10")
    assert po.payment_status == "PENDING"
    assert po.paid_on is None
    assert await _expenses(db, purchase_order_id=po.id) == [], "pay-later must not reach Expenses"
    assert await _payments(db, v.id) == []
    # It IS owed — the supplier delivered.
    assert (await ledger.balance(db, hotel.id, v.id))["outstanding"] == Decimal("50.00")


async def test_received_and_paid_in_cash_books_it_today_and_tells_the_till(db, hotel):
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")
    today = hotel_today(hotel)

    await service.receive_po(db, po, pay="now", paid_method="CASH")

    [exp] = await _expenses(db, purchase_order_id=po.id)
    assert exp.amount == Decimal("50.00")
    assert exp.payment_method == "CASH"
    assert exp.date == today, "the restaurant's today, not UTC's"
    [pay] = await _payments(db, v.id)
    assert (pay.amount, pay.method, pay.date) == (Decimal("50.00"), "CASH", today)
    assert (po.payment_status, po.paid_on, po.paid_method) == ("PAID", today, "CASH")
    assert po.payment_id == pay.id, "payment_id was stored before the payment had an id"
    # The till learns about cash ONLY through dated CASH expenses.
    assert await cash_expenses_for(db, hotel.id, today) == Decimal("50.00")
    assert (await ledger.balance(db, hotel.id, v.id))["outstanding"] == 0


async def test_paid_now_has_to_say_how(client, make_user, auth_header, db, hotel):
    """No default method: a wrong CASH moves the till, a wrong BANK misses cash."""
    rice, _v = await _catalog(db, hotel.id)
    po = await _po(db, hotel.id, rice, "10")
    h = await _owner(make_user, auth_header)

    res = await client.post(f"{PO_URL}/{po.id}/receive", headers=h, json={"pay": "now"})

    assert res.status_code == 422
    assert (await _fresh_po(db, po.id)).status != "RECEIVED"
    assert await _stock(db, rice.id) == 0


async def test_saying_nothing_keeps_the_old_meaning(db, hotel):
    """Callers that predate pay-later still book the cost on receipt."""
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")

    await service.receive_po(db, po)

    [exp] = await _expenses(db, purchase_order_id=po.id)
    assert exp.amount == Decimal("50.00")
    assert exp.payment_method == "BANK"
    assert exp.date == po.received_at.date()
    assert (po.payment_status, po.paid_on, po.payment_id) == ("PAID", None, None)
    assert await _payments(db, v.id) == []


# ── 70.2 Mark paid ──────────────────────────────────────────────────────────
async def test_mark_paid_books_it_on_the_day_it_was_paid_and_only_once(
    client, make_user, auth_header, db, hotel
):
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")
    await service.receive_po(db, po, pay="later")
    h = await _owner(make_user, auth_header)
    yesterday = hotel_today(hotel) - timedelta(days=1)
    body = {"paid_on": yesterday.isoformat(), "method": "BANK"}

    res = await client.post(f"{PO_URL}/{po.id}/mark-paid", headers=h, json=body)

    assert res.status_code == 200, res.text
    out = res.json()
    assert out["payment_status"] == "PAID"
    assert out["paid_on"] == yesterday.isoformat()
    assert out["paid_method"] == "BANK"
    [exp] = await _expenses(db, purchase_order_id=po.id)
    assert (exp.date, exp.payment_method, exp.amount) == (yesterday, "BANK", Decimal("50.00"))

    again = await client.post(f"{PO_URL}/{po.id}/mark-paid", headers=h, json=body)
    assert again.status_code == 409
    assert len(await _expenses(db, purchase_order_id=po.id)) == 1
    assert len(await _payments(db, v.id)) == 1


async def test_mark_paid_refuses_what_it_should(client, make_user, auth_header, db, hotel):
    rice, v = await _catalog(db, hotel.id)
    waiting = await _po(db, hotel.id, rice, "10")
    await service.receive_po(db, waiting, pay="later")
    unreceived = await _po(db, hotel.id, rice, "5")
    legacy = await _po(db, hotel.id, rice, "7")
    await service.receive_po(db, legacy)  # booked on receipt, the pre-feature way

    h = await _owner(make_user, auth_header)
    chef = auth_header(await make_user("chef@paylater.test", Role.KITCHEN_MANAGER.value))
    other = Hotel(name="Next Door", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    stranger = auth_header(
        await make_user("owner@nextdoor.test", Role.SUPER_ADMIN.value, hotel_id=other.id)
    )
    today = hotel_today(hotel)
    body = {"paid_on": today.isoformat(), "method": "BANK"}

    def url(po_id):
        return f"{PO_URL}/{po_id}/mark-paid"

    future = await client.post(
        url(waiting.id), headers=h,
        json={**body, "paid_on": (today + timedelta(days=1)).isoformat()},
    )
    assert future.status_code == 422
    assert "future" in future.json()["detail"]
    assert (await client.post(url(unreceived.id), headers=h, json=body)).status_code == 409
    assert (await client.post(url(legacy.id), headers=h, json=body)).status_code == 409
    # Receiving stock is a kitchen job; paying for it is not.
    assert (await client.post(url(waiting.id), headers=chef, json=body)).status_code == 403
    # Another restaurant cannot pay off — or even find — our order.
    assert (await client.post(url(waiting.id), headers=stranger, json=body)).status_code == 404
    assert (await client.post(url(uuid.uuid4()), headers=h, json=body)).status_code == 404

    assert (await _fresh_po(db, waiting.id)).payment_status == "PENDING"
    assert await _expenses(db, purchase_order_id=waiting.id) == []
    assert await _payments(db, v.id) == []


async def test_cash_pays_the_whole_amount_and_bank_can_pay_the_rest(
    client, make_user, auth_header, db, hotel
):
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")  # £50
    await service.receive_po(db, po, pay="later")
    h = await _owner(make_user, auth_header)
    today = hotel_today(hotel).isoformat()

    cash = await client.post(
        f"{PO_URL}/{po.id}/mark-paid", headers=h,
        json={"paid_on": today, "method": "CASH", "paying_now": "30"},
    )
    assert cash.status_code == 422, "cash leaves the till on its day — it must be the whole £50"
    too_much = await client.post(
        f"{PO_URL}/{po.id}/mark-paid", headers=h,
        json={"paid_on": today, "method": "BANK", "paying_now": "60"},
    )
    assert too_much.status_code == 422
    assert await _payments(db, v.id) == []

    # "Paid part of it earlier on the supplier page" — only the rest is paid now.
    bank = await client.post(
        f"{PO_URL}/{po.id}/mark-paid", headers=h,
        json={"paid_on": today, "method": "BANK", "paying_now": "30"},
    )
    assert bank.status_code == 200, bank.text
    [pay] = await _payments(db, v.id)
    assert pay.amount == Decimal("30.00")
    [exp] = await _expenses(db, purchase_order_id=po.id)
    assert exp.amount == Decimal("50.00"), "the expense is the whole delivery, posted once"


async def test_a_short_delivery_paid_later_costs_only_what_arrived(db, hotel):
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")
    poi = (await service.po_items(db, po.id))[0]
    await service.receive_po(db, po, lines={str(poi["po_item_id"]): Decimal("4")}, pay="later")

    await service.mark_paid(db, po, paid_on=hotel_today(hotel), method="BANK")

    [exp] = await _expenses(db, purchase_order_id=po.id)
    assert exp.amount == Decimal("20.00")  # 4 kg x £5, not the 10 ordered
    bal = await ledger.balance(db, hotel.id, v.id)
    assert bal["delivered"] == Decimal("20.00")
    assert bal["outstanding"] == 0, "the six kilos that never came are not owed"


# ── one payment, several orders ─────────────────────────────────────────────
async def test_one_payment_pays_off_the_oldest_whole_orders(
    client, make_user, auth_header, db, hotel
):
    rice, v = await _catalog(db, hotel.id)
    a, b, c = await _waiting(db, hotel.id, rice, [100, 80, 50])
    h = await _owner(make_user, auth_header)
    paid_on = hotel_today(hotel) - timedelta(days=1)

    res = await client.post(
        f"/api/vendors/{v.id}/payments", headers=h,
        json={"date": paid_on.isoformat(), "amount": "180", "method": "BANK"},
    )

    assert res.status_code == 201, res.text
    out = res.json()
    assert [s["po_number"] for s in out["settled"]] == [a.po_number, b.po_number]
    assert out["leftover"] == "0.00"
    assert out["still_waiting"] == 1
    [pay] = await _payments(db, v.id)
    for po in (a, b):
        fresh = await _fresh_po(db, po.id)
        assert (fresh.payment_status, fresh.paid_on, fresh.payment_id) == ("PAID", paid_on, pay.id)
        [exp] = await _expenses(db, purchase_order_id=po.id)
        assert exp.date == paid_on, "booked on the day it was paid, not the day it came"
    assert (await _fresh_po(db, c.id)).payment_status == "PENDING"
    assert await _expenses(db, purchase_order_id=c.id) == []


async def test_it_stops_at_the_first_order_it_cannot_cover(
    client, make_user, auth_header, db, hotel
):
    """Never skips ahead to a smaller, newer order that happens to fit."""
    rice, v = await _catalog(db, hotel.id)
    a, b, c = await _waiting(db, hotel.id, rice, [100, 200, 10])
    h = await _owner(make_user, auth_header)

    res = await client.post(
        f"/api/vendors/{v.id}/payments", headers=h,
        json={"date": hotel_today(hotel).isoformat(), "amount": "110", "method": "BANK"},
    )

    assert res.status_code == 201, res.text
    out = res.json()
    assert [s["po_number"] for s in out["settled"]] == [a.po_number]
    assert out["leftover"] == "10.00"
    assert (await _fresh_po(db, b.id)).payment_status == "PENDING"
    assert (await _fresh_po(db, c.id)).payment_status == "PENDING", "the £10 order jumped the queue"


async def test_cash_that_would_part_pay_an_order_is_refused(
    client, make_user, auth_header, db, hotel
):
    rice, v = await _catalog(db, hotel.id)
    a, b = await _waiting(db, hotel.id, rice, [100, 80])
    h = await _owner(make_user, auth_header)

    res = await client.post(
        f"/api/vendors/{v.id}/payments", headers=h,
        json={"date": hotel_today(hotel).isoformat(), "amount": "150", "method": "CASH"},
    )

    assert res.status_code == 422
    assert b.po_number in res.json()["detail"]
    assert await _payments(db, v.id) == []
    assert await _expenses(db, vendor_id=v.id) == []
    for po in (a, b):
        assert (await _fresh_po(db, po.id)).payment_status == "PENDING"


async def test_cash_settling_whole_orders_books_no_second_expense(
    client, make_user, auth_header, db, hotel
):
    """The order's own CASH expense IS the till's record. Booking the payment
    to a category as well would count the cash twice — P&L and drawer."""
    rice, v = await _catalog(db, hotel.id)
    a, b = await _waiting(db, hotel.id, rice, [100, 80])
    cat = await exp_service.create_category(
        db, hotel.id, name="Supplier cash", kind=ExpenseKind.FIXED.value
    )
    h = await _owner(make_user, auth_header)
    today = hotel_today(hotel)

    exact = await client.post(
        f"/api/vendors/{v.id}/payments", headers=h,
        json={"date": today.isoformat(), "amount": "100", "method": "CASH",
              "category_id": str(cat.id)},
    )
    assert exact.status_code == 201, exact.text
    [exp_a] = await _expenses(db, purchase_order_id=a.id)
    assert exp_a.payment_method == "CASH"
    assert await _expenses(db, category_id=cat.id) == []

    # Clears everything with £220 to spare: only the spare is booked to the category.
    rest = await client.post(
        f"/api/vendors/{v.id}/payments", headers=h,
        json={"date": today.isoformat(), "amount": "300", "method": "CASH",
              "category_id": str(cat.id)},
    )
    assert rest.status_code == 201, rest.text
    [spare] = await _expenses(db, category_id=cat.id)
    assert spare.amount == Decimal("220.00")
    # The till: 100 + 80 from the orders, 220 left over — 400 paid, 400 out.
    assert await cash_expenses_for(db, hotel.id, today) == Decimal("400.00")


async def test_the_preview_writes_nothing_and_agrees_with_the_payment(
    client, make_user, auth_header, db, hotel
):
    rice, v = await _catalog(db, hotel.id)
    a, b, c = await _waiting(db, hotel.id, rice, [100, 80, 50])
    h = await _owner(make_user, auth_header)
    body = {"date": hotel_today(hotel).isoformat(), "amount": "190", "method": "BANK"}

    preview = await client.post(f"/api/vendors/{v.id}/payments/preview", headers=h, json=body)

    assert preview.status_code == 200, preview.text
    plan = preview.json()
    assert plan["settled_total"] == "180.00"
    assert plan["leftover"] == "10.00"
    assert plan["next_waiting"] == {"po_number": c.po_number, "amount_due": "50.00"}
    assert plan["refusal"] is None
    assert await _payments(db, v.id) == []
    assert (await _fresh_po(db, a.id)).payment_status == "PENDING"

    paid = await client.post(f"/api/vendors/{v.id}/payments", headers=h, json=body)
    assert paid.json()["settled"] == plan["settles"]


async def test_the_preview_offers_amounts_cash_can_pay(client, make_user, auth_header, db, hotel):
    rice, v = await _catalog(db, hotel.id)
    a, b = await _waiting(db, hotel.id, rice, [100, 80])
    h = await _owner(make_user, auth_header)

    plan = (
        await client.post(
            f"/api/vendors/{v.id}/payments/preview", headers=h,
            json={"date": hotel_today(hotel).isoformat(), "amount": "150", "method": "CASH"},
        )
    ).json()

    assert plan["refusal"]
    assert plan["clear_amounts"] == [
        {"through": a.po_number, "amount": "100.00"},
        {"through": b.po_number, "amount": "180.00"},
    ]


async def test_turning_posting_off_still_settles_the_order(db, hotel):
    """Kitchens that key their invoices in by hand: no expense, but the order
    is still paid and the payment still on the supplier's balance."""
    hotel.prefs = {"post_purchases_to_expenses": False}
    await db.commit()
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")
    await service.receive_po(db, po, pay="later")

    await service.mark_paid(db, po, paid_on=hotel_today(hotel), method="BANK")

    assert po.payment_status == "PAID"
    assert await _expenses(db, purchase_order_id=po.id) == []
    [pay] = await _payments(db, v.id)
    assert pay.amount == Decimal("50.00")


# ── 70.5 exactly once ───────────────────────────────────────────────────────
async def test_a_paid_order_cannot_be_received_again(client, make_user, auth_header, db, hotel):
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")
    await service.receive_po(db, po, pay="now", paid_method="BANK")
    poi = (await service.po_items(db, po.id))[0]
    h = await _owner(make_user, auth_header)
    before = await _stock(db, rice.id)

    res = await client.post(
        f"{PO_URL}/{po.id}/receive", headers=h,
        json={"lines": [{"po_item_id": str(poi["po_item_id"]), "received_qty": "15"}],
              "pay": "now", "paid_method": "BANK"},
    )

    assert res.status_code == 409
    assert await _stock(db, rice.id) == before, "stock moved before the refusal"
    assert len(await _payments(db, v.id)) == 1
    with pytest.raises(PaidLocked):
        await service.receive_po(db, await _fresh_po(db, po.id), pay="later")
    await db.rollback()


async def test_receiving_a_waiting_order_again_keeps_it_waiting(db, hotel):
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")
    await service.receive_po(db, po, pay="later")

    await service.receive_po(db, po)  # a part delivery, caller says nothing
    await service.receive_po(db, po, pay="later")

    assert po.payment_status == "PENDING"
    assert await _expenses(db, purchase_order_id=po.id) == []
    assert await _payments(db, v.id) == []


async def test_two_taps_on_received_and_paid_pay_once(client, make_user, auth_header, db, hotel):
    """The row lock: the second request waits, then finds the order paid."""
    rice, v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")
    h = await _owner(make_user, auth_header)
    body = {"pay": "now", "paid_method": "CARD"}

    first, second = await asyncio.gather(
        client.post(f"{PO_URL}/{po.id}/receive", headers=h, json=body),
        client.post(f"{PO_URL}/{po.id}/receive", headers=h, json=body),
    )

    assert sorted([first.status_code, second.status_code]) == [200, 409]
    assert len(await _payments(db, v.id)) == 1
    assert len(await _expenses(db, purchase_order_id=po.id)) == 1
    assert await _stock(db, rice.id) == Decimal("10")


async def test_every_path_posts_the_expense_exactly_once(
    client, make_user, auth_header, db, hotel
):
    rice, v = await _catalog(db, hotel.id)
    [po] = await _waiting(db, hotel.id, rice, [40])
    h = await _owner(make_user, auth_header)
    today = hotel_today(hotel).isoformat()

    lump = await client.post(
        f"/api/vendors/{v.id}/payments", headers=h,
        json={"date": today, "amount": "40", "method": "BANK"},
    )
    assert lump.status_code == 201, lump.text
    assert [s["po_number"] for s in lump.json()["settled"]] == [po.po_number]

    marked = await client.post(
        f"{PO_URL}/{po.id}/mark-paid", headers=h, json={"paid_on": today, "method": "BANK"}
    )
    assert marked.status_code == 409
    again = await client.post(
        f"{PO_URL}/{po.id}/receive", headers=h, json={"pay": "now", "paid_method": "BANK"}
    )
    assert again.status_code == 409
    plain = await client.post(f"{PO_URL}/{po.id}/receive", headers=h)
    assert plain.status_code == 409

    [exp] = await _expenses(db, purchase_order_id=po.id)
    assert exp.amount == Decimal("40.00")
    assert len(await _payments(db, v.id)) == 1


# ── 70.3 the supplier page ──────────────────────────────────────────────────
async def test_the_statement_lists_what_is_waiting_oldest_first(
    client, make_user, auth_header, db, hotel
):
    rice, v = await _catalog(db, hotel.id)
    a, b = await _waiting(db, hotel.id, rice, [30, 20])
    paid = await _po(db, hotel.id, rice, "40")
    await service.receive_po(db, paid, pay="now", paid_method="BANK")
    short = await _po(db, hotel.id, rice, "10")
    poi = (await service.po_items(db, short.id))[0]
    await service.receive_po(db, short, lines={str(poi["po_item_id"]): Decimal("4")})
    h = await _owner(make_user, auth_header)

    res = await client.get(f"/api/vendors/{v.id}/statement", headers=h)

    assert res.status_code == 200, res.text
    body = res.json()
    assert [o["po_number"] for o in body["awaiting"]] == [a.po_number, b.po_number]
    assert [o["amount_due"] for o in body["awaiting"]] == ["30.00", "20.00"]
    assert body["awaiting"][0]["days_waiting"] > body["awaiting"][1]["days_waiting"]
    assert body["awaiting_total"] == "50.00"
    # Delivered is what ARRIVED: 30 + 20 + 40 + 4 — not the 10 ordered on the short one.
    assert Decimal(str(body["delivered"])) == Decimal("94.00")
    assert Decimal(str(body["outstanding"])) == Decimal("54.00")
    charges = {e["reference"]: Decimal(str(e["charge"])) for e in body["entries"]}
    assert charges[short.po_number] == Decimal("4.00")


async def test_another_restaurant_cannot_pay_our_supplier(
    client, make_user, auth_header, db, hotel
):
    rice, v = await _catalog(db, hotel.id)
    [po] = await _waiting(db, hotel.id, rice, [40])
    other = Hotel(name="Next Door", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    stranger = auth_header(
        await make_user("owner@nextdoor.test", Role.SUPER_ADMIN.value, hotel_id=other.id)
    )
    their_cat = await exp_service.create_category(
        db, other.id, name="Their cash", kind=ExpenseKind.FIXED.value
    )
    body = {"date": hotel_today(hotel).isoformat(), "amount": "40", "method": "BANK"}

    for url in (f"/api/vendors/{v.id}/payments", f"/api/vendors/{v.id}/payments/preview"):
        assert (await client.post(url, headers=stranger, json=body)).status_code == 404
    assert (await client.get(f"/api/vendors/{v.id}/statement", headers=stranger)).status_code == 404

    # Our own cash payment cannot be booked to THEIR category either.
    h = await _owner(make_user, auth_header)
    res = await client.post(
        f"/api/vendors/{v.id}/payments", headers=h,
        json={**body, "amount": "100", "method": "CASH", "category_id": str(their_cat.id)},
    )
    assert res.status_code == 404
    assert await _payments(db, v.id) == []
    assert (await _fresh_po(db, po.id)).payment_status == "PENDING"


async def test_a_payment_method_is_one_of_three(client, make_user, auth_header, db, hotel):
    _rice, v = await _catalog(db, hotel.id)
    h = await _owner(make_user, auth_header)
    res = await client.post(
        f"/api/vendors/{v.id}/payments", headers=h,
        json={"date": hotel_today(hotel).isoformat(), "amount": "10", "method": "cash "},
    )
    assert res.status_code == 422


# ── response_model drops undeclared fields — so check they arrive ───────────
async def test_the_po_list_and_detail_say_payment_pending(
    client, make_user, auth_header, db, hotel
):
    rice, _v = await _catalog(db, hotel.id, price="5.00")
    po = await _po(db, hotel.id, rice, "10")
    await service.receive_po(db, po, pay="later")
    h = await _owner(make_user, auth_header)

    rows = (await client.get(PO_URL, headers=h)).json()
    row = next(r for r in rows if r["id"] == str(po.id))
    assert row["payment_status"] == "PENDING"
    assert row["paid_on"] is None
    assert Decimal(str(row["amount_due"])) == Decimal("50.00")

    detail = (await client.get(f"{PO_URL}/{po.id}", headers=h)).json()
    assert detail["payment_status"] == "PENDING"
    assert detail["paid_method"] is None
    assert Decimal(str(detail["amount_due"])) == Decimal("50.00")
    assert detail["received_on"] == hotel_today(hotel).isoformat()


# ── the plan itself: pure sums, no database ─────────────────────────────────
def _w(*dues):
    return [
        (uuid.uuid4(), f"PO-{i + 1}", date(2026, 10, i + 1), Decimal(str(d)))
        for i, d in enumerate(dues)
    ]


def test_plan_with_nothing_waiting_is_an_ordinary_payment():
    plan = plan_settlement([], Decimal("50"), "CASH")
    assert plan.settles == []
    assert plan.leftover == Decimal("50")
    assert plan.still_waiting == 0
    assert plan.refusal is None, "cash with nothing waiting is exactly as before"
    assert plan.clear_amounts == []


def test_plan_exact():
    plan = plan_settlement(_w(100, 80), Decimal("180"), "CASH")
    assert [s["po_number"] for s in plan.settles] == ["PO-1", "PO-2"]
    assert plan.leftover == 0
    assert plan.refusal is None
    assert plan.next_waiting is None


def test_plan_left_over_by_bank_is_fine():
    plan = plan_settlement(_w(100, 80), Decimal("150"), "BANK")
    assert [s["po_number"] for s in plan.settles] == ["PO-1"]
    assert plan.leftover == Decimal("50")
    assert plan.still_waiting == 1
    assert plan.next_waiting == {"po_number": "PO-2", "amount_due": "80.00"}
    assert plan.refusal is None


def test_plan_left_over_by_cash_is_refused_with_amounts_that_work():
    plan = plan_settlement(_w(100, 80, 50), Decimal("150"), "CASH")
    assert plan.refusal and "PO-2" in plan.refusal
    assert [c["amount"] for c in plan.clear_amounts] == ["100.00", "180.00", "230.00"]


def test_plan_stops_at_the_first_that_does_not_fit():
    plan = plan_settlement(_w(100, 200, 10), Decimal("110"), "BANK")
    assert [s["po_number"] for s in plan.settles] == ["PO-1"]
    assert plan.leftover == Decimal("10")


# ── found by the adversarial review, before it shipped ──────────────────────


async def _boss(make_user, auth_header, email):
    u = await make_user(email, Role.SUPER_ADMIN.value)
    return u, auth_header(u)


async def test_received_and_paid_pays_what_the_bill_charged(
    client, make_user, auth_header, db, hotel
) -> None:
    """A scanned bill said £1.25/kg on an order at £1.00/kg. Paying the order's
    price recorded £10.00 while £12.50 left the till."""
    _, h = await _boss(make_user, auth_header, "bill-price@pay.test")
    rice, v = await _catalog(db, hotel.id)
    po = await _po(db, hotel.id, rice, 10)
    line = (await service.po_items(db, po.id))[0]
    r = await client.post(
        f"{PO_URL}/{po.id}/receive",
        headers=h,
        json={
            "lines": [{"po_item_id": str(line["po_item_id"]), "received_qty": "10", "unit_price": "1.25"}],
            "pay": "now",
            "paid_method": "CARD",
        },
    )
    assert r.status_code == 200, r.text
    pays = await _payments(db, v.id)
    assert [p.amount for p in pays] == [Decimal("12.50")]
    assert [e.amount for e in await _expenses(db, purchase_order_id=po.id)] == [Decimal("12.50")]


async def test_receiving_and_paying_needs_the_paying_permission(
    client, make_user, auth_header, db, hotel, monkeypatch
) -> None:
    """A runtime role that receives deliveries but may not pay suppliers."""
    from app.auth import deps

    u, h = await _boss(make_user, auth_header, "receiver@pay.test")
    rice, v = await _catalog(db, hotel.id)
    po = await _po(db, hotel.id, rice, 5)

    async def receiver_only(_db, _user):
        return ["indent:approve", "indent:read", "inventory:read", "vendors:read"]

    monkeypatch.setattr(deps, "effective_permissions", receiver_only)
    paid = await client.post(f"{PO_URL}/{po.id}/receive", headers=h, json={"pay": "now", "paid_method": "CASH"})
    assert paid.status_code == 403, paid.text
    assert await _payments(db, v.id) == []
    assert await _stock(db, rice.id) == Decimal("0")  # refused before anything moved
    later = await client.post(f"{PO_URL}/{po.id}/receive", headers=h, json={"pay": "later"})
    assert later.status_code == 200, later.text  # receiving alone is still theirs


async def _posting_off(db, hotel) -> None:
    h = (
        await db.execute(select(Hotel).where(Hotel.id == hotel.id).execution_options(populate_existing=True))
    ).scalar_one()
    h.prefs = {**(h.prefs or {}), "post_purchases_to_expenses": False}
    await db.commit()


async def test_cash_through_an_order_is_refused_when_posting_is_off(
    client, make_user, auth_header, db, hotel
) -> None:
    """With posting off no order gets an expense — so cash paid through an
    order would never reach the till."""
    _, h = await _boss(make_user, auth_header, "cash-off@pay.test")
    await _posting_off(db, hotel)
    rice, v = await _catalog(db, hotel.id)
    po = await _po(db, hotel.id, rice, 8)
    r = await client.post(f"{PO_URL}/{po.id}/receive", headers=h, json={"pay": "now", "paid_method": "CASH"})
    assert r.status_code == 422, r.text
    assert await _stock(db, rice.id) == Decimal("0")
    (waiting,) = await _waiting(db, hotel.id, rice, [8])
    m = await client.post(
        f"{PO_URL}/{waiting.id}/mark-paid",
        headers=h,
        json={"paid_on": hotel_today(hotel).isoformat(), "method": "CASH"},
    )
    assert m.status_code == 422, m.text


async def test_a_supplier_cash_payment_reaches_the_till_when_posting_is_off(db, hotel) -> None:
    """Before pay-later this page booked the whole cash amount to a category.
    Settling orders must not lose that when no order has an expense."""
    from app.purchasing import settle

    await _posting_off(db, hotel)
    rice, v = await _catalog(db, hotel.id)
    await _waiting(db, hotel.id, rice, [80])
    cat = await exp_service.create_category(db, hotel.id, "Supplier cash", ExpenseKind.VARIABLE.value)
    h = await db.get(Hotel, hotel.id)
    today = hotel_today(h)
    with pytest.raises(settle.BadPayment):  # no category: the till would never hear of it
        await settle.pay_vendor(
            db, h, v, on=today, amount=Decimal("80"), method="CASH", reference=None,
            note=None, category_id=None, created_by=None, dry_run=False,
        )
    await settle.pay_vendor(
        db, h, v, on=today, amount=Decimal("80"), method="CASH", reference=None,
        note=None, category_id=cat.id, created_by=None, dry_run=False,
    )
    cash = [e for e in await _expenses(db, payment_method="CASH") if e.date == today]
    assert [e.amount for e in cash] == [Decimal("80.00")]


async def test_a_payment_cannot_predate_the_delivery(db, hotel) -> None:
    """Paying on 15 Oct cannot settle food that arrived on 28 Oct."""
    from app.purchasing import settle

    rice, v = await _catalog(db, hotel.id)
    (po,) = await _waiting(db, hotel.id, rice, [20])  # arrived ~6 days ago
    h = await db.get(Hotel, hotel.id)
    too_early = hotel_today(h) - timedelta(days=30)
    locked = await _fresh_po(db, po.id)
    with pytest.raises(settle.BadPayment):
        await service.mark_paid(db, locked, paid_on=too_early, method="BANK")
    out = await settle.pay_vendor(
        db, h, v, on=too_early, amount=Decimal("20"), method="BANK", reference=None,
        note=None, category_id=None, created_by=None, dry_run=False,
    )
    assert out["settled"] == []  # it had not arrived yet on that day
    assert (await _fresh_po(db, po.id)).payment_status == "PENDING"


async def test_received_and_paid_with_nothing_received_is_refused(
    client, make_user, auth_header, db, hotel
) -> None:
    """Settling an empty receipt locked the order for good: the real delivery
    could then never be received."""
    _, h = await _boss(make_user, auth_header, "nothing@pay.test")
    rice, v = await _catalog(db, hotel.id)
    po = await _po(db, hotel.id, rice, 6)
    line = (await service.po_items(db, po.id))[0]
    r = await client.post(
        f"{PO_URL}/{po.id}/receive",
        headers=h,
        json={"lines": [{"po_item_id": str(line["po_item_id"]), "received_qty": "0"}], "pay": "now", "paid_method": "CARD"},
    )
    assert r.status_code == 422, r.text
    again = await client.post(f"{PO_URL}/{po.id}/receive", headers=h, json={"pay": "later"})
    assert again.status_code == 200, again.text  # still receivable
