"""Everything one supplier has sold us, over a period.

    "in vendor page for each vednor i need confolsitead report of what we
     purcahsed from that vedor ..total value till this date to this date or..
     last month last 2month tecet...i need a export featrue we can eport as
     excel , csv pdf tooo"

THE SAME `Section` SHAPE AS THE BUSINESS REPORT, deliberately. That buys all
four renderers — PDF, Excel, Word, CSV — without writing one of them again, and
it means the two reports look like they came from the same company, because
they did. He asked for three formats here; Word arrives free and is not worth
removing.

⚠️ DRAFTS ARE NOT PURCHASES. A `DRAFT` order is a shopping list somebody has
not sent, and counting it as spend would tell a restaurant it owed money it has
not committed. Only SENT and RECEIVED count, and the report says so in print
rather than leaving anyone to wonder why a total looks low.

⚠️ ORDERED IS NOT PAID. The orders and the payments are two different
questions, and this shows both rather than a single "total" that quietly means
one of them. A supplier you have ordered £4,000 from and paid £1,200 is a fact
worth seeing on one page.
"""
from __future__ import annotations

import uuid
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.expenses.models import Expense
from app.inventory.models import Item
from app.purchasing.models import POItem, POStatus, PurchaseOrder
from app.reports.mbr import Section

#: A shopping list is not a purchase.
_REAL = (POStatus.SENT.value, POStatus.RECEIVED.value)

CATALOGUE: list[tuple[str, str]] = [
    ("summary", "The headline numbers"),
    ("items", "What we buy from them"),
    ("orders", "Every order"),
    ("months", "Month by month"),
    ("payments", "What we have paid them"),
]
ALL_KEYS = [k for k, _ in CATALOGUE]

_Q2 = Decimal("0.01")


async def _orders_rows(db, hotel_id, vendor_id, date_from, date_to):
    q = await db.execute(
        select(PurchaseOrder)
        .where(
            PurchaseOrder.hotel_id == hotel_id,
            PurchaseOrder.vendor_id == vendor_id,
            PurchaseOrder.status.in_(_REAL),
            func.date(PurchaseOrder.created_at) >= date_from,
            func.date(PurchaseOrder.created_at) <= date_to,
        )
        .order_by(PurchaseOrder.created_at.desc())
    )
    return list(q.scalars().all())


async def _paid_total(db, hotel_id, vendor_id, date_from, date_to) -> Decimal:
    return Decimal(
        (
            await db.execute(
                select(func.coalesce(func.sum(Expense.amount), 0)).where(
                    Expense.hotel_id == hotel_id,
                    Expense.vendor_id == vendor_id,
                    Expense.date >= date_from,
                    Expense.date <= date_to,
                )
            )
        ).scalar_one()
        or 0
    )


async def build(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    vendor_id: uuid.UUID,
    date_from: date_type,
    date_to: date_type,
    want: list[str] | None = None,
    *,
    vendor_name: str = "",
    currency: str = "GBP",
) -> dict:
    """The supplier's report, or only the sections asked for.

    EMPTY MEANS EVERYTHING, the same rule as the business report — asking for
    nothing is how somebody says "the usual".
    """
    chosen = [k for k in ALL_KEYS if k in set(want)] if want else ALL_KEYS
    orders = await _orders_rows(db, hotel_id, vendor_id, date_from, date_to)
    ordered_total = sum((o.total_amount for o in orders), Decimal("0"))
    paid = await _paid_total(db, hotel_id, vendor_id, date_from, date_to)

    out: list[Section] = []

    if "summary" in chosen:
        received = [o for o in orders if o.status == POStatus.RECEIVED.value]
        avg = (ordered_total / len(orders)).quantize(_Q2) if orders else Decimal("0")
        rows = [
            ["Ordered", ordered_total, f"across {len(orders)} order(s)"],
            ["Paid", paid, "costs recorded against this supplier"],
            [
                "Difference",
                (ordered_total - paid).quantize(_Q2),
                "ordered minus paid — not a bill, a gap worth knowing",
            ],
            ["Average order", avg, "what a typical order from them costs"],
            [
                "Delivered",
                sum((o.total_amount for o in received), Decimal("0")),
                f"{len(received)} of {len(orders)} order(s) marked received",
            ],
        ]
        out.append(
            Section(
                key="summary",
                title="The headline numbers",
                columns=["Metric", "Amount", "Notes"],
                rows=rows,
                note=(
                    "Draft orders are excluded — a shopping list nobody has sent is "
                    "not money committed. Ordered and paid are different questions, "
                    "so both are shown rather than one total that quietly means one "
                    "of them."
                ),
                money_cols=[1],
            )
        )

    if "items" in chosen:
        q = await db.execute(
            select(
                Item.name,
                Item.unit,
                func.coalesce(func.sum(POItem.ordered_qty), 0),
                func.coalesce(func.sum(POItem.line_total), 0),
                func.max(POItem.unit_price),
                func.min(POItem.unit_price),
            )
            .join(POItem, POItem.item_id == Item.id)
            .join(PurchaseOrder, POItem.po_id == PurchaseOrder.id)
            .where(
                PurchaseOrder.hotel_id == hotel_id,
                PurchaseOrder.vendor_id == vendor_id,
                PurchaseOrder.status.in_(_REAL),
                func.date(PurchaseOrder.created_at) >= date_from,
                func.date(PurchaseOrder.created_at) <= date_to,
            )
            .group_by(Item.name, Item.unit)
            .order_by(func.coalesce(func.sum(POItem.line_total), 0).desc())
        )
        rows = []
        total = Decimal("0")
        for name, unit, qty, value, hi, lo in q.all():
            value = Decimal(value or 0)
            total += value
            rows.append(
                [
                    name,
                    f"{Decimal(qty or 0):,.3f} {unit}".replace(".000 ", " "),
                    value,
                    Decimal(lo) if lo is not None else None,
                    Decimal(hi) if hi is not None else None,
                ]
            )
        out.append(
            Section(
                key="items",
                title="What we buy from them",
                columns=["Item", "Quantity", "Value", "Cheapest", "Dearest"],
                rows=rows,
                note=(
                    "Cheapest and dearest are the unit prices actually paid in this "
                    "period. A wide gap on one item is the thing worth asking about."
                ),
                total=["TOTAL", "", total, None, None],
                money_cols=[2, 3, 4],
            )
        )

    if "orders" in chosen:
        rows = [
            [
                o.po_number,
                o.created_at.date().isoformat() if o.created_at else "—",
                o.status.title(),
                o.total_amount,
            ]
            for o in orders
        ]
        out.append(
            Section(
                key="orders",
                title="Every order",
                columns=["Order", "Date", "Status", "Total"],
                rows=rows,
                total=["TOTAL", "", "", ordered_total],
                money_cols=[3],
            )
        )

    if "months" in chosen:
        by_month: dict[str, list] = {}
        for o in orders:
            if not o.created_at:
                continue
            key = o.created_at.strftime("%Y-%m")
            slot = by_month.setdefault(key, [0, Decimal("0")])
            slot[0] += 1
            slot[1] += o.total_amount
        rows = [[m, n, v] for m, (n, v) in sorted(by_month.items())]
        out.append(
            Section(
                key="months",
                title="Month by month",
                columns=["Month", "Orders", "Value"],
                rows=rows,
                total=["TOTAL", len(orders), ordered_total],
                money_cols=[2],
            )
        )

    if "payments" in chosen:
        q = await db.execute(
            select(Expense.date, Expense.description, Expense.amount)
            .where(
                Expense.hotel_id == hotel_id,
                Expense.vendor_id == vendor_id,
                Expense.date >= date_from,
                Expense.date <= date_to,
            )
            .order_by(Expense.date.desc())
        )
        rows = [[d.isoformat(), desc or "—", Decimal(amt)] for d, desc, amt in q.all()]
        out.append(
            Section(
                key="payments",
                title="What we have paid them",
                columns=["Date", "What for", "Amount"],
                rows=rows,
                total=["TOTAL", "", paid],
                money_cols=[2],
            )
        )

    return {
        # `hotel_name` is the renderers' name for "who this is about" — here it
        # is the supplier. `kind` stops all four heading it "Business Report".
        "hotel_name": vendor_name,
        "kind": "Supplier Report",
        "date_from": date_from,
        "date_to": date_to,
        "currency": currency,
        "sections": out,
    }
