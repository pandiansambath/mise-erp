"""Vendor service: CRUD, per-vendor item pricing, and the price-comparison engine."""
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import Item
from app.vendors.models import PriceHistory, Vendor, VendorItem


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
    is_preferred: bool | None = None,
    notes: str | None = None,
    source: str = "manual",
) -> VendorItem:
    """Set (or update) a vendor's price for an item.

    `is_preferred`/`notes` are left UNCHANGED when not supplied (None) — so a plain
    price edit never silently un-chooses the ★ preferred supplier or wipes its notes.
    (New rows default to not-preferred.) Every genuine price change also appends a
    PriceHistory row (source: manual | po | invoice) so no old price is ever lost."""
    result = await db.execute(
        select(VendorItem).where(
            VendorItem.vendor_id == vendor_id, VendorItem.item_id == item_id
        )
    )
    vi = result.scalar_one_or_none()
    old_price = vi.price_per_unit if vi is not None else None
    if vi is None:
        vi = VendorItem(vendor_id=vendor_id, item_id=item_id, is_preferred=bool(is_preferred))
        db.add(vi)
    elif is_preferred is not None:
        vi.is_preferred = is_preferred
    vi.price_per_unit = price_per_unit
    if notes is not None:
        vi.notes = notes
    vi.last_updated = date.today()

    # Append to the price history whenever the price actually changed (or is new).
    if old_price is None or old_price != price_per_unit:
        hotel_id = (
            await db.execute(select(Vendor.hotel_id).where(Vendor.id == vendor_id))
        ).scalar_one_or_none()
        if hotel_id is not None:
            db.add(PriceHistory(
                hotel_id=hotel_id, vendor_id=vendor_id, item_id=item_id,
                old_price=old_price, new_price=price_per_unit, source=source,
            ))

    await db.commit()
    await db.refresh(vi)
    return vi


async def delete_vendor_item(
    db: AsyncSession, vendor_id: uuid.UUID, item_id: uuid.UUID
) -> bool:
    """Remove ONE vendor's price for an item. Leaves the inventory item, its stock,
    recipes, past POs and price history untouched — only this supplier link goes."""
    vi = (await db.execute(
        select(VendorItem).where(
            VendorItem.vendor_id == vendor_id, VendorItem.item_id == item_id
        )
    )).scalar_one_or_none()
    if vi is None:
        return False
    await db.delete(vi)
    await db.commit()
    return True


async def item_price_history(
    db: AsyncSession, hotel_id: uuid.UUID, item_id: uuid.UUID, *, limit: int = 100
) -> list[dict]:
    """The price timeline for one item across all its vendors, newest first."""
    rows = await db.execute(
        select(PriceHistory, Vendor.name)
        .join(Vendor, Vendor.id == PriceHistory.vendor_id, isouter=True)
        .where(PriceHistory.hotel_id == hotel_id, PriceHistory.item_id == item_id)
        .order_by(PriceHistory.created_at.desc())
        .limit(limit)
    )
    out: list[dict] = []
    for ph, vendor_name in rows.all():
        out.append({
            "vendor_name": vendor_name or "—",
            "old_price": str(ph.old_price) if ph.old_price is not None else None,
            "new_price": str(ph.new_price),
            "source": ph.source,
            "at": ph.created_at.isoformat(),
        })
    return out


async def import_price_list(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    vendor_id: uuid.UUID,
    rows: list[tuple[str, Decimal, str | None]],
) -> dict:
    """Bulk upsert a vendor's price list. Idempotent: items matched by
    case-insensitive name (created if new), prices upserted per (vendor, item)
    so re-uploading the same file changes nothing. Preserves the preferred flag."""
    from app.inventory import service as inv

    created_items = 0
    priced = 0
    skipped: list[str] = []
    for name, price, unit in rows:
        name = (name or "").strip()
        if not name or price is None or price <= 0:
            if name:
                skipped.append(name)
            continue
        item = await inv.get_item_by_name(db, hotel_id, name)
        if item is None:
            item = await inv.create_item(
                db, hotel_id, name=name, unit=(unit or "unit").strip()[:20] or "unit"
            )
            created_items += 1
        result = await db.execute(
            select(VendorItem).where(
                VendorItem.vendor_id == vendor_id, VendorItem.item_id == item.id
            )
        )
        vi = result.scalar_one_or_none()
        if vi is None:
            vi = VendorItem(vendor_id=vendor_id, item_id=item.id, is_preferred=False)
            db.add(vi)
        vi.price_per_unit = price  # only the price changes on re-import
        vi.last_updated = date.today()
        priced += 1
    await db.commit()
    return {"created_items": created_items, "priced_items": priced, "skipped": skipped}


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
