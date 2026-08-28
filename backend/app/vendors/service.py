"""Vendor service: CRUD, per-vendor item pricing, and the price-comparison engine."""
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory import pack_service, packs
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


async def vendor_price_rows(
    db: AsyncSession, vendor_id: uuid.UUID, hotel_id: uuid.UUID
) -> list[dict]:
    """What this supplier sells us, with prices — for the download.

    Scoped by hotel on the ITEM as well as the vendor: a vendor id from another
    tenant must not be able to read an item list through this.
    """
    from app.inventory.models import Item

    rows = (
        await db.execute(
            select(VendorItem, Item)
            .join(Item, Item.id == VendorItem.item_id)
            .where(VendorItem.vendor_id == vendor_id, Item.hotel_id == hotel_id)
            .order_by(Item.category.nulls_last(), Item.name)
        )
    ).all()
    return [
        {
            "item": it.name,
            "category": (it.category or "").strip() or "Other",
            "unit": it.unit,
            "price": vi.price_per_unit,
            "preferred": bool(vi.is_preferred),
            "updated": str(vi.last_updated),
            "notes": vi.notes,
        }
        for vi, it in rows
    ]


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
class _Keep:
    """'The caller did not mention this field' — distinct from an explicit None."""

    __slots__ = ()


KEEP = _Keep()


async def upsert_vendor_item(
    db: AsyncSession,
    vendor_id: uuid.UUID,
    item_id: uuid.UUID,
    price_per_unit: Decimal,
    *,
    is_preferred: bool | None = None,
    notes: str | None = None,
    pack_level_id: uuid.UUID | None | _Keep = KEEP,
    pack_size_override: Decimal | None | _Keep = KEEP,
    source: str = "manual",
) -> VendorItem:
    """Set (or update) a vendor's price for an item.

    `is_preferred`/`notes` are left UNCHANGED when not supplied (None) — so a plain
    price edit never silently un-chooses the ★ preferred supplier or wipes its notes.
    (New rows default to not-preferred.) Every genuine price change also appends a
    PriceHistory row (source: manual | po | invoice) so no old price is ever lost."""
    # WHICH ROW this is. A supplier may quote a box and a loose kilo at rates
    # that are not multiples of each other, so the form is part of the identity:
    # saving a loose price must not overwrite their box price. When the caller
    # says nothing about the form (KEEP — a plain price edit) we fall back to
    # matching on vendor+item, so editing a supplier who sells exactly one way
    # still finds their row rather than creating a second one.
    q = select(VendorItem).where(
        VendorItem.vendor_id == vendor_id, VendorItem.item_id == item_id
    )
    if pack_level_id is not KEEP:
        q = q.where(
            VendorItem.pack_level_id.is_(None)
            if pack_level_id is None
            else VendorItem.pack_level_id == pack_level_id
        )
    rows = (await db.execute(q)).scalars().all()
    # More than one only when the form was not stated and they sell several
    # ways. Their loose row is the sensible default for a bare price edit.
    vi = None
    if rows:
        vi = next((r for r in rows if r.pack_level_id is None), rows[0])
    old_price = vi.price_per_unit if vi is not None else None
    if vi is None:
        vi = VendorItem(
            vendor_id=vendor_id,
            item_id=item_id,
            is_preferred=bool(is_preferred),
            # A brand-new row must be created IN the form asked for, or the
            # partial unique index would see two loose prices.
            pack_level_id=None if pack_level_id is KEEP else pack_level_id,
        )
        db.add(vi)
    elif is_preferred is not None:
        vi.is_preferred = is_preferred
    vi.price_per_unit = price_per_unit
    # Which size this price buys. KEEP leaves it alone, so a plain price edit
    # does not silently reset a supplier back to selling base units — but an
    # explicit None DOES set it back, which is how "actually they sell it
    # loose" gets corrected.
    if pack_level_id is not KEEP:
        vi.pack_level_id = pack_level_id
    # Three states, not two. KEEP (the default) means the caller never
    # mentioned it — a plain price edit must not wipe a supplier's bottle size.
    # An explicit None still clears it back to the item's own size, because
    # undoing a mistake has to be expressible.
    if pack_size_override is not KEEP:
        vi.pack_size_override = pack_size_override
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

    # Price went UP on an existing line → email the owners who opted in.
    if old_price is not None and price_per_unit > old_price and hotel_id is not None:
        from app.core import notify
        from app.inventory.models import Item

        names = (
            await db.execute(
                select(Item.name, Vendor.name)
                .select_from(Item)
                .join(Vendor, Vendor.id == vendor_id)
                .where(Item.id == item_id)
            )
        ).first()
        item_name, vendor_name = names if names else ("an item", "a supplier")
        pct = (price_per_unit - old_price) / old_price * 100
        await notify.email_hotel_admins(
            db,
            hotel_id,
            f"Price rise: {item_name} up {pct:.1f}% at {vendor_name}",
            f"{vendor_name} moved {item_name} from {old_price} to {price_per_unit} "
            f"(+{pct:.1f}%). Your dish margins that use it just changed.",
            html=notify.render_email(
                badge="📈 Price rise",
                heading="A supplier just raised a price",
                intro=f"<b>{vendor_name}</b> moved <b>{item_name}</b> up — every dish "
                "using it is now costlier to plate. You caught it the moment it "
                "happened; most kitchens find out at month-end.",
                rows=[
                    ("Item", str(item_name)),
                    ("Supplier", str(vendor_name)),
                    ("Old price", f"{old_price}"),
                    ("New price", f"{price_per_unit}  (+{pct:.1f}%)"),
                ],
                cta_label="Review supplier prices",
                cta_url=f"{notify.settings.app_base_url}/vendors",
                accent="#d97742",
            ),
            pref_key="price_rise",
            background=True,
        )
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
    )
    rows = result.all()

    # Compare on price per BASE unit, not on the number in the price box.
    #
    # This was the bug, and it was live: suppliers do not all sell the same
    # shape. Farm2Land sells a box of pepper for £120 and SK sells a packet for
    # 45p, and sorting on price_per_unit put the box last and called it the
    # dear one. Per gram it is £0.0080 against £0.0090 — the box is CHEAPER,
    # and the page was recommending the opposite.
    chain_rows = (await pack_service.levels_for(db, [item.id])).get(item.id) or []
    chain = pack_service.as_levels(chain_rows)
    by_id = {r.id: r.position for r in chain_rows}

    comparisons = [
        {
            "vendor_id": vendor.id,
            "vendor_name": vendor.name,
            "price_per_unit": vi.price_per_unit,
            #: What that price buys — None means one base unit.
            "pack_level_name": next(
                (r.name for r in chain_rows if r.id == vi.pack_level_id), None
            ),
            #: The number every comparison on this page is actually made on —
            #: and it has to respect THIS supplier's pack size. Two suppliers
            #: both selling "a bottle" may not be selling the same amount, and
            #: comparing them as if they were is the exact mistake this page
            #: exists to prevent.
            "price_per_base": (
                (vi.price_per_unit / vi.pack_size_override)
                if vi.pack_size_override and vi.pack_size_override > 0
                else packs.price_per_base(
                    vi.price_per_unit, chain, by_id.get(vi.pack_level_id, 0)
                )
            ),
            #: So the row can say "1 bottle (20 piece)" rather than implying
            #: everyone's bottle is the same.
            "pack_size": (
                vi.pack_size_override
                if vi.pack_size_override
                else (
                    packs.base_size(chain, by_id.get(vi.pack_level_id, 0))
                    if vi.pack_level_id
                    else None
                )
            ),
            "is_preferred": vi.is_preferred,
            "last_updated": vi.last_updated,
        }
        for vi, vendor in rows
    ]
    comparisons.sort(key=lambda c: c["price_per_base"])

    cheapest = comparisons[0] if comparisons else None
    most_expensive = comparisons[-1] if comparisons else None
    saving = (
        most_expensive["price_per_base"] - cheapest["price_per_base"]
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
        #: Per BASE unit (per g, per ml, per piece) — comparable across
        #: suppliers who sell different shapes.
        "potential_saving_per_unit": saving,
    }

async def spend_by_vendor(db: AsyncSession, hotel_id: uuid.UUID, days: int) -> list[dict]:
    """Per-vendor scorecard for the last `days`: received-PO spend + order count
    + how many times they moved a price UP (from the price_history trail)."""
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import func as safunc

    from app.purchasing.models import POStatus, PurchaseOrder
    from app.vendors.models import PriceHistory, Vendor

    cutoff = datetime.now(UTC) - timedelta(days=days)
    rows = await db.execute(
        select(
            Vendor.id,
            Vendor.name,
            safunc.sum(PurchaseOrder.total_amount),
            safunc.count(PurchaseOrder.id),
        )
        .join(PurchaseOrder, PurchaseOrder.vendor_id == Vendor.id)
        .where(
            PurchaseOrder.hotel_id == hotel_id,
            PurchaseOrder.status == POStatus.RECEIVED.value,
            PurchaseOrder.received_at >= cutoff,
        )
        .group_by(Vendor.id, Vendor.name)
        .order_by(safunc.sum(PurchaseOrder.total_amount).desc())
    )
    rises = await db.execute(
        select(PriceHistory.vendor_id, safunc.count(PriceHistory.id))
        .where(
            PriceHistory.hotel_id == hotel_id,
            PriceHistory.created_at >= cutoff,
            PriceHistory.old_price.is_not(None),
            PriceHistory.new_price > PriceHistory.old_price,
        )
        .group_by(PriceHistory.vendor_id)
    )
    rise_by_vendor = {vid: n for vid, n in rises.all()}
    return [
        {
            "vendor_id": str(vid),
            "vendor_name": name,
            "total": str(total),
            "orders": int(orders),
            "price_rises": int(rise_by_vendor.get(vid, 0)),
        }
        for vid, name, total, orders in rows.all()
    ]
