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
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select
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


async def received_value(db: AsyncSession, po: PurchaseOrder) -> Decimal:
    """What actually arrived, priced. Not what was ordered."""
    rows = await db.execute(select(POItem).where(POItem.po_id == po.id))
    total = Decimal("0")
    for pi in rows.scalars().all():
        total += (pi.received_qty or Decimal("0")) * (pi.unit_price or Decimal("0"))
    return total.quantize(Decimal("0.01"))


async def post_for_po(
    db: AsyncSession,
    po: PurchaseOrder,
    hotel,
    *,
    created_by: uuid.UUID | None = None,
) -> Expense | None:
    """Create or update the expense for a received PO. Returns it, or None.

    Returns None when the hotel has turned this off — some kitchens enter their
    purchase invoices by hand, and posting both would double their food cost.
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

    when: date = (po.received_at or datetime.now(UTC)).date()
    note = f"Stock received on {po.po_number}"

    if existing is not None:
        existing.amount = amount
        existing.date = when
        existing.description = note
        existing.vendor_id = po.vendor_id
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
    db.add(exp)
    return exp
