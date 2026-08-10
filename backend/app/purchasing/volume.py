"""How much of each item this kitchen actually buys.

The number Price Comparison needs and never had. It used to add up the per-unit
savings across items and print the sum as money — £1.00 per kg plus £0.61 per
piece — which is not a quantity at all, and he said so: "whats that big 2 pounds
means? is it that important? i dont understand".

Real money is (what you pay − the cheapest) × HOW MUCH YOU BUY, and the
quantities have been sitting in po_items the whole time. This reads them.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.purchasing.models import POItem, POStatus, PurchaseOrder


async def purchased_per_item(
    db: AsyncSession, hotel_id: uuid.UUID, *, days: int = 90
) -> dict[uuid.UUID, Decimal]:
    """item_id -> base units RECEIVED in the last `days`.

    Received, not ordered: an order that never arrived is not money you spend,
    and a short delivery should not inflate what you appear to get through.
    """
    since = datetime.now(UTC) - timedelta(days=days)
    rows = await db.execute(
        select(POItem.item_id, func.sum(POItem.received_qty))
        .join(PurchaseOrder, POItem.po_id == PurchaseOrder.id)
        .where(
            PurchaseOrder.hotel_id == hotel_id,
            PurchaseOrder.status == POStatus.RECEIVED.value,
            PurchaseOrder.received_at >= since,
        )
        .group_by(POItem.item_id)
    )
    return {item_id: (total or Decimal("0")) for item_id, total in rows.all()}


async def monthly_rate(
    db: AsyncSession, hotel_id: uuid.UUID, *, days: int = 90
) -> dict[uuid.UUID, Decimal]:
    """The same thing as a per-MONTH rate, which is how a restaurant thinks.

    Ninety days smooths a quiet week or a party order; dividing back to a month
    gives a figure someone can hold against a monthly P&L.
    """
    per_item = await purchased_per_item(db, hotel_id, days=days)
    months = Decimal(days) / Decimal("30.44")  # average month
    if months <= 0:
        return {}
    return {k: (v / months).quantize(Decimal("0.001")) for k, v in per_item.items()}
