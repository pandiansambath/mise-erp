"""Vendor service: CRUD, per-vendor item pricing, and the price-comparison engine."""
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import Item
from app.vendors.models import Vendor, VendorItem


class DuplicateVendorError(ValueError):
    """Raised when a vendor with the same name already exists in the hotel."""


# ── Vendor CRUD (hotel-scoped) ──────────────────────────────────────────────
async def create_vendor(db: AsyncSession, hotel_id: uuid.UUID, **fields) -> Vendor:
    name = fields.get("name", "")
    if name:
        exists = await db.execute(
            select(Vendor.id).where(
                Vendor.hotel_id == hotel_id,
                Vendor.is_active.is_(True),
                func.lower(Vendor.name) == name.strip().lower(),
            ).limit(1)
        )
        if exists.first() is not None:
            raise DuplicateVendorError(f'A vendor called "{name.strip()}" already exists')
    vendor = Vendor(hotel_id=hotel_id, **fields)
    db.add(vendor)
    await db.commit()
    await db.refresh(vendor)
    return vendor


async def get_vendor(db: AsyncSession, vendor_id: uuid.UUID, hotel_id: uuid.UUID) -> Vendor | None:
    vendor = await db.get(Vendor, vendor_id)
    if vendor is None or vendor.hotel_id != hotel_id:
        return None
    return vendor


async def list_vendors(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    category: str | None = None,
    active_only: bool = True,
) -> list[Vendor]:
    stmt = select(Vendor).where(Vendor.hotel_id == hotel_id)
    if active_only:
        stmt = stmt.where(Vendor.is_active.is_(True))
    if category:
        stmt = stmt.where(Vendor.category == category)
    result = await db.execute(stmt.order_by(Vendor.name))
    return list(result.scalars().all())


async def update_vendor(db: AsyncSession, vendor: Vendor, **fields) -> Vendor:
    for key, value in fields.items():
        if value is not None:
            setattr(vendor, key, value)
    await db.commit()
    await db.refresh(vendor)
    return vendor


# ── Vendor item pricing ──────────────────────────────────────────────────────
async def upsert_vendor_item(
    db: AsyncSession,
    vendor_id: uuid.UUID,
    item_id: uuid.UUID,
    price_per_unit: Decimal,
    *,
    is_preferred: bool = False,
    notes: str | None = None,
) -> VendorItem:
    """Set (or update) a vendor's price for an item."""
    result = await db.execute(
        select(VendorItem).where(
            VendorItem.vendor_id == vendor_id, VendorItem.item_id == item_id
        )
    )
    vi = result.scalar_one_or_none()
    if vi is None:
        vi = VendorItem(vendor_id=vendor_id, item_id=item_id)
        db.add(vi)
    vi.price_per_unit = price_per_unit
    vi.is_preferred = is_preferred
    vi.notes = notes
    vi.last_updated = date.today()
    await db.commit()
    await db.refresh(vi)
    return vi


async def list_vendor_items(db: AsyncSession, vendor_id: uuid.UUID) -> list[VendorItem]:
    result = await db.execute(select(VendorItem).where(VendorItem.vendor_id == vendor_id))
    return list(result.scalars().all())


async def set_preferred_vendor(
    db: AsyncSession, hotel_id: uuid.UUID, item_id: uuid.UUID, vendor_id: uuid.UUID | None
) -> bool:
    """Mark one vendor as preferred for an item (clears others). vendor_id=None clears all.
    Returns True if applied, False if the target vendor doesn't supply the item."""
    result = await db.execute(
        select(VendorItem)
        .join(Vendor, VendorItem.vendor_id == Vendor.id)
        .where(VendorItem.item_id == item_id, Vendor.hotel_id == hotel_id)
    )
    rows = list(result.scalars().all())
    found = vendor_id is None
    for vi in rows:
        vi.is_preferred = vi.vendor_id == vendor_id
        if vi.vendor_id == vendor_id:
            found = True
    await db.commit()
    return found


# ── Price comparison engine ──────────────────────────────────────────────────
async def compare_vendor_prices(
    db: AsyncSession, item_id: uuid.UUID, hotel_id: uuid.UUID
) -> dict | None:
    """Return every active vendor's price for an item, cheapest first, with savings.

    Returns None if the item doesn't exist in this hotel.
    """
    item = await db.get(Item, item_id)
    if item is None or item.hotel_id != hotel_id:
        return None

    result = await db.execute(
        select(VendorItem, Vendor)
        .join(Vendor, VendorItem.vendor_id == Vendor.id)
        .where(
            VendorItem.item_id == item_id,
            Vendor.hotel_id == hotel_id,
            Vendor.is_active.is_(True),
        )
        .order_by(VendorItem.price_per_unit.asc())
    )
    rows = result.all()

    comparisons = [
        {
            "vendor_id": vendor.id,
            "vendor_name": vendor.name,
            "price_per_unit": vi.price_per_unit,
            "is_preferred": vi.is_preferred,
            "last_updated": vi.last_updated,
        }
        for vi, vendor in rows
    ]

    cheapest = comparisons[0] if comparisons else None
    most_expensive = comparisons[-1] if comparisons else None
    saving = (
        most_expensive["price_per_unit"] - cheapest["price_per_unit"]
        if comparisons
        else Decimal("0")
    )

    return {
        "item_id": item.id,
        "item_name": item.name,
        "unit": item.unit,
        "vendor_count": len(comparisons),
        "comparisons": comparisons,
        "cheapest_vendor": cheapest,
        "most_expensive_vendor": most_expensive,
        "potential_saving_per_unit": saving,
    }
