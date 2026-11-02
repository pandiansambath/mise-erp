"""What you owe each supplier, and how that came about.

The rhythm this exists for: deliveries arrive daily, money leaves weekly. In
between there is a balance, and until now the app could not state it.

    owed = delivered (RECEIVED purchase orders) − paid

**Only received orders count.** A purchase order that has not arrived is not a
debt; counting it would show money owed for goods still on a lorry, and every
balance would read high. Equally, a delivery that arrived but was never marked
received is invisible here — which is a real limitation, and the reason the
statement shows the deliveries it counted rather than only a total.

**What arrived, not what was ordered.** A delivery counts at what actually
arrived, priced (`expense_link.received_values`) — the same figure its expense
is posted at. It used to count the ORDERED total, so a short delivery showed
money owed for food that never came; and once pay-later let an order be
"Received & paid" for what arrived, that shortfall would have sat here as a
debt for ever.

**Waiting for payment.** Pay-later orders (§70) are in stock and on this
balance but not yet in Expenses. `awaiting()` lists them oldest first — the
order a payment on the supplier page pays them off in.

**Statement, not just a number.** A bare "you owe £1,240" is unarguable and
therefore useless in a dispute. The statement interleaves deliveries and
payments in date order with a running balance, so a supplier's invoice can be
checked against it line by line.
"""
from __future__ import annotations

import uuid
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezones import hotel_today, to_local
from app.purchasing.expense_link import received_values
from app.purchasing.models import POStatus, PurchaseOrder
from app.purchasing.settle import money, waiting_orders
from app.vendors.models import VendorPayment

ZERO = Decimal("0")


async def delivered_total(db: AsyncSession, hotel_id: uuid.UUID, vendor_id: uuid.UUID) -> Decimal:
    """Value of everything actually received from this supplier — what ARRIVED,
    priced, not what was ordered."""
    ids = (
        await db.execute(
            select(PurchaseOrder.id).where(
                PurchaseOrder.hotel_id == hotel_id,
                PurchaseOrder.vendor_id == vendor_id,
                PurchaseOrder.status == POStatus.RECEIVED.value,
            )
        )
    ).scalars().all()
    return sum((await received_values(db, ids)).values(), ZERO)


async def paid_total(db: AsyncSession, hotel_id: uuid.UUID, vendor_id: uuid.UUID) -> Decimal:
    rows = await db.execute(
        select(VendorPayment.amount).where(
            VendorPayment.hotel_id == hotel_id,
            VendorPayment.vendor_id == vendor_id,
        )
    )
    return sum((r[0] or ZERO for r in rows.all()), ZERO)


async def balance(db: AsyncSession, hotel_id: uuid.UUID, vendor_id: uuid.UUID) -> dict:
    """The headline three numbers."""
    delivered = await delivered_total(db, hotel_id, vendor_id)
    paid = await paid_total(db, hotel_id, vendor_id)
    return {
        "delivered": delivered,
        "paid": paid,
        # Negative means paid ahead — an advance, not an error. Restaurants do
        # pay up front for some suppliers, so it must not be clamped at zero.
        "outstanding": delivered - paid,
    }


async def statement(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    vendor_id: uuid.UUID,
    *,
    since: date_type | None = None,
) -> list[dict]:
    """Deliveries and payments in date order, with a running balance.

    Sorted oldest-first because a running balance only reads correctly forwards;
    the UI reverses it for display if it wants newest at the top.
    """
    po_rows = await db.execute(
        select(PurchaseOrder).where(
            PurchaseOrder.hotel_id == hotel_id,
            PurchaseOrder.vendor_id == vendor_id,
            PurchaseOrder.status == POStatus.RECEIVED.value,
        )
    )
    pay_rows = await db.execute(
        select(VendorPayment).where(
            VendorPayment.hotel_id == hotel_id,
            VendorPayment.vendor_id == vendor_id,
        )
    )

    pos = list(po_rows.scalars())
    # Charged at what arrived, like the balance above — or the running total
    # at the bottom of the statement and the headline "owed" would disagree.
    arrived = await received_values(db, [po.id for po in pos])

    entries: list[dict] = []
    for po in pos:
        # received_at is a timestamp; the statement works in calendar days.
        when = po.received_at.date() if po.received_at else None
        if when is None:
            continue
        entries.append(
            {
                "date": when,
                "kind": "delivery",
                "reference": po.po_number,
                "charge": arrived.get(po.id, ZERO),
                "payment": ZERO,
                "note": po.receive_note,
            }
        )
    for pay in pay_rows.scalars():
        entries.append(
            {
                "date": pay.date,
                "kind": "payment",
                "reference": pay.reference or pay.method,
                "charge": ZERO,
                "payment": pay.amount or ZERO,
                "note": pay.note,
            }
        )

    if since is not None:
        entries = [e for e in entries if e["date"] >= since]

    # Deliveries before payments on the same day: you receive the goods, then
    # settle. The other order would show a balance going negative mid-day.
    entries.sort(key=lambda e: (e["date"], 0 if e["kind"] == "delivery" else 1))

    running = ZERO
    for e in entries:
        running += e["charge"] - e["payment"]
        e["balance"] = running
    return entries


async def awaiting(db: AsyncSession, hotel_id: uuid.UUID, vendor_id: uuid.UUID, hotel) -> dict:
    """Received but not paid yet — the supplier page's "Waiting for payment".

        "even in that vendor page also it need to show payment pending"

    Oldest arrival first, because that is the order a payment on that page pays
    them off in (`settle.plan_settlement`); listed any other way, the preview of
    a payment would look as if it had picked orders at random. Read only — no
    row locks.
    """
    today = hotel_today(hotel)
    orders: list[dict] = []
    total = ZERO
    for po, due in await waiting_orders(db, hotel_id, vendor_id, lock=False):
        local = to_local(po.received_at, hotel)
        received_on = local.date() if local else None
        orders.append(
            {
                "po_id": str(po.id),
                "po_number": po.po_number,
                "received_on": received_on.isoformat() if received_on else None,
                "amount_due": money(due),
                "days_waiting": max((today - received_on).days, 0) if received_on else 0,
            }
        )
        total += due
    return {"orders": orders, "total": money(total)}
