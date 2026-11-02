"""Posting the cost of received stock to Expenses.

He asked why a purchase does not appear under Expenses. It never did — and the
damage is not a missing list entry:

    reports.pnl():  cost_of_sales = exp["variable_total"]

Cost of sales is read ENTIRELY from the expenses table, so receiving stock
moved the stock, updated the weighted-average cost, and put nothing at all on
the cost side of the P&L. Profit came out overstated by the exact value of
every delivery, unless somebody separately typed the same spend in by hand.

Two things make posting it automatically safe rather than reckless:

  * ONE expense per purchase order, found by `purchase_order_id` and updated in
    place. Part deliveries are normal — 30 today, 70 on Friday — and each of
    those receives the same PO again.
  * The amount is what was actually RECEIVED, not what was ordered. A short
    delivery must not be paid for on paper.

Since pay-later (§70) it is posted when the order is PAID, not necessarily when
it arrives: "once payment done then we can added in expense". `settle.py` is
the one place that decides that moment; this module only knows how to post.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.expenses.models import Expense, ExpenseCategory, ExpenseKind
from app.hotels.prefs import pref
from app.purchasing.models import POItem, PurchaseOrder

#: The category received stock is booked to. VARIABLE so it lands in cost of
#: sales, which is the whole point.
CATEGORY_NAME = "Stock purchases"


async def _category(db: AsyncSession, hotel_id: uuid.UUID) -> ExpenseCategory:
    """Find or make the category, without disturbing one the hotel already has."""
    existing = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.hotel_id == hotel_id,
            ExpenseCategory.name == CATEGORY_NAME,
        )
    )
    if existing is not None:
        return existing
    cat = ExpenseCategory(
        hotel_id=hotel_id, name=CATEGORY_NAME, kind=ExpenseKind.VARIABLE.value
    )
    db.add(cat)
    await db.flush()
    return cat


async def received_values(
    db: AsyncSession, po_ids: list[uuid.UUID] | set[uuid.UUID]
) -> dict[uuid.UUID, Decimal]:
    """What actually arrived on each of these orders, priced. One query.

    THE definition of "amount due" on a purchase order. The expense, the
    supplier ledger, the waiting-for-payment list and the oldest-first payment
    rule all read it from here, so they cannot disagree about a penny. An id
    with no lines is simply absent — read it as zero.
    """
    ids = list(po_ids)
    if not ids:
        return {}
    # autoflush is OFF in this app, and an aggregate reads the DATABASE, not the
    # objects in memory — so a receive that has just changed `received_qty`
    # would be summed at its old value. Write pending changes first.
    await db.flush()
    rows = await db.execute(
        # Each line rounded to the penny FIRST, as the order's own total is —
        # otherwise per-gram prices made "£2.99 to pay" on a £2.98 order.
        select(POItem.po_id, func.sum(func.round(POItem.received_qty * POItem.unit_price, 2)))
        .where(POItem.po_id.in_(ids))
        .group_by(POItem.po_id)
    )
    return {pid: Decimal(v or 0).quantize(Decimal("0.01")) for pid, v in rows.all()}


async def received_value(db: AsyncSession, po: PurchaseOrder) -> Decimal:
    """What actually arrived, priced. Not what was ordered."""
    return (await received_values(db, [po.id])).get(po.id, Decimal("0.00"))


async def post_for_po(
    db: AsyncSession,
    po: PurchaseOrder,
    hotel,
    *,
    created_by: uuid.UUID | None = None,
    on: date | None = None,
    method: str | None = None,
) -> Expense | None:
    """Create or update the expense for a received PO. Returns it, or None.

    Returns None when the hotel has turned this off — some kitchens enter their
    purchase invoices by hand, and posting both would double their food cost.

    `on` and `method` are the day and the way it was PAID, when it was paid
    after it arrived. A cash settlement has to be a CASH expense on that day,
    because that is how the till learns the money left it
    (`sales/cash.cash_expenses_for`). Left out, the expense is dated the day
    the stock arrived, as it always was.
    """
    if not pref(hotel, "post_purchases_to_expenses"):
        return None

    amount = await received_value(db, po)

    existing = await db.scalar(
        select(Expense).where(Expense.purchase_order_id == po.id)
    )

    # Nothing actually arrived: drop any expense a previous receive had posted
    # rather than leaving a zero sitting in the books.
    if amount <= 0:
        if existing is not None:
            await db.delete(existing)
        return None

    when: date = on or (po.received_at or datetime.now(UTC)).date()
    note = f"Stock received on {po.po_number}"

    if existing is not None:
        existing.amount = amount
        existing.date = when
        existing.description = note
        existing.vendor_id = po.vendor_id
        if method:
            existing.payment_method = method
        return existing

    cat = await _category(db, po.hotel_id)
    exp = Expense(
        hotel_id=po.hotel_id,
        category_id=cat.id,
        date=when,
        amount=amount,
        description=note,
        vendor_id=po.vendor_id,
        purchase_order_id=po.id,
        created_by=created_by,
    )
    if method:
        exp.payment_method = method
    db.add(exp)
    return exp
