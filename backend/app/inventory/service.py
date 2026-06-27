"""Inventory service: item CRUD, weighted-average costing, stock movements.

All money/quantity math uses Decimal for exactness (this drives recipe costing
and the P&L later — float rounding here would corrupt the whole product).
"""
import uuid
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import _INFLOW, _OUTFLOW, Item, MovementType, StockMovement

_COST_QUANT = Decimal("0.0001")  # average_cost stored to 4dp


class InsufficientStockError(ValueError):
    """Raised when a movement would drive stock below zero."""


class DuplicateItemError(ValueError):
    """Raised when an item with the same name already exists in the hotel."""


def normalize_name(name: str) -> str:
    """Trim and collapse inner whitespace so "Rice " / "Rice" / "Ric  e" can't
    create sneaky duplicates. Names are STORED normalized too."""
    return " ".join(name.split())


async def _name_taken(
    db: AsyncSession, hotel_id: uuid.UUID, name: str, *, exclude_id: uuid.UUID | None = None
) -> bool:
    """Case-insensitive check for an existing active item of the same name."""
    stmt = select(Item.id).where(
        Item.hotel_id == hotel_id,
        Item.is_active.is_(True),
        func.lower(Item.name) == normalize_name(name).lower(),
    )
    if exclude_id is not None:
        stmt = stmt.where(Item.id != exclude_id)
    return (await db.execute(stmt.limit(1))).first() is not None


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
    name = fields.get("name", "")
    if name:
        fields["name"] = normalize_name(name)
        if await _name_taken(db, hotel_id, fields["name"]):
            raise DuplicateItemError(f'An item called "{fields["name"]}" already exists')
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


async def get_item_by_name(db: AsyncSession, hotel_id: uuid.UUID, name: str) -> Item | None:
    """Case-insensitive lookup by name (used by the vendor price-list import)."""
    stmt = (
        select(Item)
        .where(Item.hotel_id == hotel_id, func.lower(Item.name) == name.strip().lower())
        .order_by(Item.is_active.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


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


async def vendor_counts(db: AsyncSession, hotel_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """Map item_id -> number of ACTIVE vendors pricing it. 0 means not orderable yet."""
    from app.vendors.models import Vendor, VendorItem  # local import avoids cycle

    stmt = (
        select(VendorItem.item_id, func.count(VendorItem.id))
        .join(Vendor, Vendor.id == VendorItem.vendor_id)
        .where(Vendor.hotel_id == hotel_id, Vendor.is_active.is_(True))
        .group_by(VendorItem.item_id)
    )
    result = await db.execute(stmt)
    return {row[0]: row[1] for row in result.all()}


async def best_vendors(
    db: AsyncSession, hotel_id: uuid.UUID
) -> dict[uuid.UUID, tuple[str, bool, Decimal]]:
    """Map item_id -> (vendor_name, is_chosen, price) for the CHOSEN (★ preferred)
    supplier ONLY. We deliberately do NOT auto-pick the cheapest as a provisional
    anymore (the user must pick a supplier per item) — items with no chosen supplier
    are simply absent here, so the UI prompts the user to choose one."""
    from app.vendors.models import Vendor, VendorItem  # local import avoids cycle

    stmt = (
        select(VendorItem.item_id, Vendor.name, VendorItem.price_per_unit)
        .join(Vendor, Vendor.id == VendorItem.vendor_id)
        .where(
            Vendor.hotel_id == hotel_id,
            Vendor.is_active.is_(True),
            VendorItem.is_preferred.is_(True),
        )
    )
    best: dict[uuid.UUID, tuple[str, bool, Decimal]] = {}
    for item_id, name, price in (await db.execute(stmt)).all():
        if item_id not in best:
            best[item_id] = (name, True, price)
    return best


async def update_item(db: AsyncSession, item: Item, **fields) -> Item:
    new_name = fields.get("name")
    if new_name:
        fields["name"] = normalize_name(new_name)
        if await _name_taken(db, item.hotel_id, fields["name"], exclude_id=item.id):
            raise DuplicateItemError(f'An item called "{fields["name"]}" already exists')
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
    vendor_id: uuid.UUID | None = None,
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
        vendor_id=vendor_id,
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


async def purchase_vendor_counts(db: AsyncSession, hotel_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """item_id -> number of DISTINCT vendors this item has actually been bought
    from (priced PURCHASE_INs). The UI only offers a per-vendor breakdown when
    this is > 1 — a single-supplier item needs no breakdown."""
    rows = (
        await db.execute(
            select(StockMovement.item_id, func.count(func.distinct(StockMovement.vendor_id)))
            .join(Item, Item.id == StockMovement.item_id)
            .where(
                Item.hotel_id == hotel_id,
                StockMovement.movement_type == MovementType.PURCHASE_IN.value,
                StockMovement.vendor_id.isnot(None),
            )
            .group_by(StockMovement.item_id)
        )
    ).all()
    return {item_id: count for item_id, count in rows}


async def purchases_by_vendor(db: AsyncSession, item: Item) -> list[dict]:
    """Recent PURCHASES of this item, per supplier — a factual RECORD of what was
    bought and at what price (e.g. "3 kg Rudra @ £10.60 · 12 Jun + 3 kg Farm2Land
    @ £10.00 · 14 Jun"). It deliberately does NOT try to split the CURRENT stock
    by vendor: once loose goods are mixed in one bin you can't know whose stock is
    consumed, so current stock stays one pool valued at the weighted-average cost.
    """
    from app.vendors.models import Vendor  # local import avoids a cycle

    rows = (
        await db.execute(
            select(
                StockMovement.vendor_id,
                StockMovement.unit_cost,
                StockMovement.quantity,
                StockMovement.created_at,
            )
            .where(
                StockMovement.item_id == item.id,
                StockMovement.movement_type == MovementType.PURCHASE_IN.value,
            )
            .order_by(StockMovement.created_at.desc())
            .limit(12)
        )
    ).all()

    vendor_ids = {r[0] for r in rows if r[0] is not None}
    names: dict[uuid.UUID, str] = {}
    if vendor_ids:
        vrows = (
            await db.execute(select(Vendor.id, Vendor.name).where(Vendor.id.in_(vendor_ids)))
        ).all()
        names = {vid: name for vid, name in vrows}

    return [
        {
            "vendor_id": vendor_id,
            "vendor": names.get(vendor_id) if vendor_id else None,
            "quantity": (qty or Decimal("0")).quantize(Decimal("0.001")),
            "unit_cost": unit_cost,
            "received_at": created_at,
        }
        for vendor_id, unit_cost, qty, created_at in rows
    ]


# ── Waste ────────────────────────────────────────────────────────────────────
async def record_waste(
    db: AsyncSession,
    item: Item,
    quantity: Decimal,
    reason: str,
    created_by: uuid.UUID | None = None,
) -> StockMovement:
    """Log spoilage/spillage/over-prep. Decrements stock and stamps the item's
    weighted-average cost, so the £ value of the waste is captured for the Money
    page. `quantity` is a positive magnitude; the WASTE type makes it an outflow."""
    return await record_movement(
        db,
        item,
        MovementType.WASTE.value,
        quantity,
        unit_cost=item.average_cost,
        notes=reason,
        created_by=created_by,
    )


async def list_waste(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    date_from=None,
    date_to=None,
    limit: int = 200,
) -> list[dict]:
    """Waste movements (newest first) with item name/unit and £ value."""
    stmt = (
        select(StockMovement, Item.name, Item.unit)
        .join(Item, Item.id == StockMovement.item_id)
        .where(
            Item.hotel_id == hotel_id,
            StockMovement.movement_type == MovementType.WASTE.value,
        )
        .order_by(StockMovement.created_at.desc())
        .limit(limit)
    )
    if date_from is not None:
        stmt = stmt.where(StockMovement.created_at >= date_from)
    if date_to is not None:
        from datetime import timedelta

        stmt = stmt.where(StockMovement.created_at < date_to + timedelta(days=1))

    rows: list[dict] = []
    for mv, name, unit in (await db.execute(stmt)).all():
        qty = abs(mv.quantity)
        cost = mv.unit_cost or Decimal("0")
        rows.append(
            {
                "id": mv.id,
                "item_id": mv.item_id,
                "item_name": name,
                "unit": unit,
                "quantity": qty,
                "unit_cost": mv.unit_cost,
                "value": (qty * cost).quantize(Decimal("0.01"), ROUND_HALF_UP),
                "reason": mv.notes,
                "created_at": mv.created_at,
            }
        )
    return rows


async def rename_category(db: AsyncSession, hotel_id: uuid.UUID, old: str, new: str) -> int:
    """Re-tag every item in `old` to `new` (hotel-scoped). If `new` already exists,
    the two categories merge. Returns how many items moved."""
    new_val = (new or "").strip() or None
    result = await db.execute(
        update(Item)
        .where(Item.hotel_id == hotel_id, Item.category == old)
        .values(category=new_val)
    )
    await db.commit()
    return result.rowcount or 0


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
