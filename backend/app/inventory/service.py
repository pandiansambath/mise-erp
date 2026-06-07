"""Inventory service: item CRUD, weighted-average costing, stock movements.

All money/quantity math uses Decimal for exactness (this drives recipe costing
and the P&L later — float rounding here would corrupt the whole product).
"""
import uuid
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import _INFLOW, _OUTFLOW, Item, MovementType, StockMovement

_COST_QUANT = Decimal("0.0001")  # average_cost stored to 4dp


class InsufficientStockError(ValueError):
    """Raised when a movement would drive stock below zero."""


def weighted_average_cost(
    existing_stock: Decimal,
    existing_avg: Decimal,
    new_qty: Decimal,
    new_unit_cost: Decimal,
) -> Decimal:
    """new_avg = (existing_stock*existing_avg + new_qty*new_unit_cost) / total_qty."""
    total_qty = existing_stock + new_qty
    if total_qty <= 0:
        return new_unit_cost.quantize(_COST_QUANT, ROUND_HALF_UP)
    existing_value = existing_stock * existing_avg
    new_value = new_qty * new_unit_cost
    return ((existing_value + new_value) / total_qty).quantize(_COST_QUANT, ROUND_HALF_UP)


def signed_delta(movement_type: str, quantity: Decimal) -> Decimal:
    """Convert a movement into a signed stock delta."""
    if movement_type in _INFLOW:
        return abs(quantity)
    if movement_type in _OUTFLOW:
        return -abs(quantity)
    return quantity  # ADJUSTMENT — caller-supplied sign


# ── Item CRUD (all scoped to a hotel) ───────────────────────────────────────
async def create_item(db: AsyncSession, hotel_id: uuid.UUID, **fields) -> Item:
    item = Item(hotel_id=hotel_id, **fields)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def get_item(db: AsyncSession, item_id: uuid.UUID, hotel_id: uuid.UUID) -> Item | None:
    item = await db.get(Item, item_id)
    if item is None or item.hotel_id != hotel_id:
        return None
    return item


async def list_items(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    category: str | None = None,
    active_only: bool = True,
) -> list[Item]:
    stmt = select(Item).where(Item.hotel_id == hotel_id)
    if active_only:
        stmt = stmt.where(Item.is_active.is_(True))
    if category:
        stmt = stmt.where(Item.category == category)
    stmt = stmt.order_by(Item.name)
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_item(db: AsyncSession, item: Item, **fields) -> Item:
    for key, value in fields.items():
        if value is not None:
            setattr(item, key, value)
    await db.commit()
    await db.refresh(item)
    return item


# ── Stock movements ──────────────────────────────────────────────────────────
async def record_movement(
    db: AsyncSession,
    item: Item,
    movement_type: str,
    quantity: Decimal,
    *,
    unit_cost: Decimal | None = None,
    notes: str | None = None,
    reference_id: uuid.UUID | None = None,
    reference_type: str | None = None,
    created_by: uuid.UUID | None = None,
) -> StockMovement:
    delta = signed_delta(movement_type, quantity)
    new_stock = item.current_stock + delta
    if new_stock < 0:
        raise InsufficientStockError(
            f"Insufficient stock for '{item.name}': have {item.current_stock}, "
            f"movement {delta}"
        )

    # Recalculate weighted-average cost only when priced stock comes IN.
    if delta > 0 and unit_cost is not None and movement_type == MovementType.PURCHASE_IN.value:
        item.average_cost = weighted_average_cost(
            item.current_stock, item.average_cost, delta, unit_cost
        )

    item.current_stock = new_stock
    movement = StockMovement(
        item_id=item.id,
        movement_type=movement_type,
        quantity=delta,
        unit_cost=unit_cost,
        notes=notes,
        reference_id=reference_id,
        reference_type=reference_type,
        created_by=created_by,
    )
    db.add(movement)
    await db.commit()
    await db.refresh(movement)
    return movement


async def list_movements(db: AsyncSession, item_id: uuid.UUID) -> list[StockMovement]:
    result = await db.execute(
        select(StockMovement)
        .where(StockMovement.item_id == item_id)
        .order_by(StockMovement.created_at.desc())
    )
    return list(result.scalars().all())


async def low_stock_items(db: AsyncSession, hotel_id: uuid.UUID) -> list[Item]:
    """Active items whose current stock is at or below their minimum level."""
    result = await db.execute(
        select(Item).where(
            Item.hotel_id == hotel_id,
            Item.is_active.is_(True),
            Item.min_stock_level.is_not(None),
            Item.current_stock <= Item.min_stock_level,
        )
    )
    return list(result.scalars().all())
