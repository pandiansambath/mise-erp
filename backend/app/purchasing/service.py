"""Purchasing service: indents, vendor-wise POs, receiving.

Supplier resolution per line (user-confirmed 2026-06-12): the vendor PICKED on
the indent line wins; otherwise the item's preferred ("chosen") vendor;
otherwise the CHEAPEST active vendor. Only items no active vendor prices at
all are skipped.
"""
import uuid
from decimal import Decimal

from sqlalchemy import String, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory import pack_service as packs_svc
from app.inventory import packs
from app.inventory import service as inventory_service
from app.inventory.models import Item
from app.purchasing.models import (
    Indent,
    IndentItem,
    IndentStatus,
    POItem,
    POStatus,
    PurchaseOrder,
)
from app.vendors.models import Vendor, VendorItem

_Q2 = Decimal("0.01")


# ── Indents ─────────────────────────────────────────────────────────────────
async def create_indent(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    items: list[dict],
    *,
    notes: str | None = None,
    created_by: uuid.UUID | None = None,
) -> Indent:
    indent = Indent(hotel_id=hotel_id, notes=notes, created_by=created_by)
    db.add(indent)
    await db.flush()
    for it in items:
        db.add(
            IndentItem(
                indent_id=indent.id,
                item_id=it["item_id"],
                required_qty=it["required_qty"],
                vendor_id=it.get("vendor_id"),
                notes=it.get("notes"),
            )
        )
    await db.commit()
    await db.refresh(indent)
    return indent


async def get_indent(db: AsyncSession, indent_id: uuid.UUID, hotel_id: uuid.UUID) -> Indent | None:
    ind = await db.get(Indent, indent_id)
    if ind is None or ind.hotel_id != hotel_id:
        return None
    return ind


async def indent_items(db: AsyncSession, indent_id: uuid.UUID) -> list[dict]:
    rows = await db.execute(
        select(IndentItem, Item, Vendor.name)
        .join(Item, IndentItem.item_id == Item.id)
        .outerjoin(Vendor, IndentItem.vendor_id == Vendor.id)
        .where(IndentItem.indent_id == indent_id)
        .order_by(Item.name)
    )
    return [
        {
            "item_id": ii.item_id,
            "item_name": it.name,
            "required_qty": ii.required_qty,
            "unit": it.unit,
            "vendor_id": ii.vendor_id,
            "vendor_name": vname,  # the PICKED override, if any (display)
        }
        for ii, it, vname in rows.all()
    ]


async def list_indents(db: AsyncSession, hotel_id: uuid.UUID) -> list[Indent]:
    result = await db.execute(
        select(Indent).where(Indent.hotel_id == hotel_id).order_by(Indent.created_at.desc())
    )
    return list(result.scalars().all())


async def list_indents_page(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    q: str | None = None,
    status: str | None = None,
    sort: str = "newest",
    limit: int = 10,
    offset: int = 0,
) -> dict:
    """One page of indents, plus the counts the filter chips need.

    His idea, and a good one: "instead of showing all and making the user scroll
    so deep, shall we have a pagination... this will also reduce the reading all
    datas at once from db issue."

    The database saving here is bigger than it looks. The list endpoint builds
    each row by fetching that indent's ITEMS — one query per indent — so thirty
    six indents cost thirty seven round trips before a single pixel is drawn.
    Ten per page costs eleven.

    Search and paging had to move together. Filtering in the browser while
    paging on the server means you are only ever searching the page you happen
    to be on, which is worse than not paging at all — so the WHERE clause lives
    here now, and the counts are computed over everything so the chips do not
    start lying about how much there is.
    """
    base = select(Indent).where(Indent.hotel_id == hotel_id)

    if status:
        base = base.where(Indent.status == status)

    if q and q.strip():
        needle = f"%{q.strip().lower()}%"
        # Searchable by what is IN it, not only by its date — "the one with the
        # lemons" is how people remember an order.
        with_item = (
            select(IndentItem.indent_id)
            .join(Item, IndentItem.item_id == Item.id)
            .where(func.lower(Item.name).like(needle))
        )
        base = base.where(
            func.lower(func.cast(Indent.date, String)).like(needle)
            | func.lower(Indent.status).like(needle)
            | Indent.id.in_(with_item)
        )

    total = (
        await db.execute(select(func.count()).select_from(base.subquery()))
    ).scalar_one()

    order = {
        "oldest": Indent.created_at.asc(),
        "newest": Indent.created_at.desc(),
    }.get(sort, Indent.created_at.desc())

    rows = (
        await db.execute(base.order_by(order).limit(limit or 1000).offset(offset))
    ).scalars().all()

    # Counts over the WHOLE set (ignoring the status filter, so the chips can
    # still show you what switching to them would give).
    count_base = select(Indent.status, func.count()).where(Indent.hotel_id == hotel_id)
    if q and q.strip():
        needle = f"%{q.strip().lower()}%"
        with_item = (
            select(IndentItem.indent_id)
            .join(Item, IndentItem.item_id == Item.id)
            .where(func.lower(Item.name).like(needle))
        )
        count_base = count_base.where(
            func.lower(func.cast(Indent.date, String)).like(needle)
            | func.lower(Indent.status).like(needle)
            | Indent.id.in_(with_item)
        )
    counts = {
        st: n
        for st, n in (await db.execute(count_base.group_by(Indent.status))).all()
    }

    # How many there are ALTOGETHER, ignoring the filter — so the page can say
    # "showing 4 of 36" rather than "showing 4 of 4", which tells you nothing.
    grand = (
        await db.execute(
            select(func.count()).select_from(
                select(Indent.id).where(Indent.hotel_id == hotel_id).subquery()
            )
        )
    ).scalar_one()

    return {
        "rows": list(rows),
        "total": total,
        "grand_total": grand,
        "counts": counts,
    }


async def set_indent_status(db: AsyncSession, indent: Indent, status: str) -> Indent:
    indent.status = status
    await db.commit()
    await db.refresh(indent)
    return indent


async def indent_has_received_po(db: AsyncSession, indent_id: uuid.UUID) -> bool:
    """True if any PO generated from this indent has already been received (stock
    moved) — those can't be safely deleted or reverted."""
    n = (
        await db.execute(
            select(func.count(PurchaseOrder.id)).where(
                PurchaseOrder.indent_id == indent_id,
                PurchaseOrder.status == POStatus.RECEIVED.value,
            )
        )
    ).scalar_one()
    return (n or 0) > 0


async def delete_indent(db: AsyncSession, indent: Indent) -> None:
    """Delete an indent + its lines, and any (non-received) POs it produced."""
    pos = (
        await db.execute(select(PurchaseOrder).where(PurchaseOrder.indent_id == indent.id))
    ).scalars().all()
    for po in pos:
        await db.execute(POItem.__table__.delete().where(POItem.po_id == po.id))
        await db.delete(po)
    await db.execute(IndentItem.__table__.delete().where(IndentItem.indent_id == indent.id))
    await db.delete(indent)
    await db.commit()


async def revert_po(db: AsyncSession, po: PurchaseOrder) -> Indent | None:
    """Undo PO generation: delete ALL (non-received) POs of this PO's indent and
    set the indent back to APPROVED so it can be edited / re-generated. Returns
    the re-opened indent (or None if the PO had no parent indent)."""
    indent_id = po.indent_id
    pos = (
        [po]
        if indent_id is None
        else (
            await db.execute(select(PurchaseOrder).where(PurchaseOrder.indent_id == indent_id))
        ).scalars().all()
    )
    for p in pos:
        await db.execute(POItem.__table__.delete().where(POItem.po_id == p.id))
        await db.delete(p)
    indent = await db.get(Indent, indent_id) if indent_id is not None else None
    if indent is not None:
        indent.status = IndentStatus.APPROVED.value
    await db.commit()
    if indent is not None:
        await db.refresh(indent)
    return indent


# ── Supplier resolution: picked (per line) > preferred > cheapest ────────────
async def _resolve_supplier(
    db: AsyncSession,
    item_id: uuid.UUID,
    hotel_id: uuid.UUID,
    override_vendor_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, Decimal] | None:
    """Which vendor (and price) to order this item from.

    1. The vendor PICKED on the indent line — if they're active and price it.
    2. The item's preferred ("chosen") vendor.
    3. The cheapest active vendor.
    None only when no active vendor prices the item at all.
    """
    base = (
        select(VendorItem.vendor_id, VendorItem.price_per_unit, VendorItem.pack_level_id)
        .join(Vendor, VendorItem.vendor_id == Vendor.id)
        .where(
            VendorItem.item_id == item_id,
            Vendor.hotel_id == hotel_id,
            Vendor.is_active.is_(True),
        )
    )

    # A quote is for whatever size the supplier sells; an indent line is in
    # BASE units. See pack_service.per_base_prices for what went wrong when
    # those two were multiplied together.
    convert = await packs_svc.per_base_prices(db, [item_id])

    def per_base(price: Decimal, level_id: uuid.UUID | None) -> Decimal:
        return convert(item_id, price, level_id)

    if override_vendor_id is not None:
        row = (await db.execute(base.where(Vendor.id == override_vendor_id).limit(1))).first()
        if row:
            return (row[0], per_base(row[1], row[2]))
    row = (await db.execute(base.where(VendorItem.is_preferred.is_(True)).limit(1))).first()
    if row:
        return (row[0], per_base(row[1], row[2]))

    # "Cheapest" has to be compared per base unit too, or a £30 bottle of
    # thirty (£1 each) loses to a £3 single piece.
    rows = (await db.execute(base)).all()
    if not rows:
        return None
    best = min(rows, key=lambda r: per_base(r[1], r[2]))
    return (best[0], per_base(best[1], best[2]))


async def item_suppliers(db: AsyncSession, hotel_id: uuid.UUID) -> dict[uuid.UUID, list[dict]]:
    """Map item_id -> every active vendor pricing it (cheapest first), so the
    UI can offer a per-line supplier choice without N requests."""
    rows = await db.execute(
        select(
            VendorItem.item_id,
            VendorItem.vendor_id,
            Vendor.name,
            VendorItem.price_per_unit,
            VendorItem.is_preferred,
            VendorItem.pack_level_id,
        )
        .join(Vendor, VendorItem.vendor_id == Vendor.id)
        .where(Vendor.hotel_id == hotel_id, Vendor.is_active.is_(True))
        .order_by(VendorItem.item_id, VendorItem.price_per_unit.asc())
    )
    out: dict[uuid.UUID, list[dict]] = {}
    for item_id, vendor_id, name, price, pref, level_id in rows.all():
        out.setdefault(item_id, []).append(
            {
                "vendor_id": vendor_id,
                "vendor_name": name,
                "price_per_unit": price,
                # Which size THIS supplier sells in. None = they quote per base
                # unit. Sent so the order form can offer only the sizes you can
                # actually buy from them — "we cant say all the vendors will
                # have this BOX type, some vendor will have small packets too".
                "pack_level_id": level_id,
                "is_preferred": pref,
            }
        )
    return out


async def _next_po_number(db: AsyncSession, hotel_id: uuid.UUID) -> tuple[int, int]:
    # PO numbers embed the year. On 1 January a hotel east of UTC would
    # otherwise still be issuing last year's numbers.
    from app.core.timezones import hotel_today
    from app.hotels.models import Hotel as _Hotel

    year = hotel_today(await db.get(_Hotel, hotel_id)).year
    count = await db.scalar(
        select(func.count())
        .select_from(PurchaseOrder)
        .where(PurchaseOrder.hotel_id == hotel_id)
    )
    return (count or 0) + 1, year


# ── Generate POs from an approved indent ──────────────────────────────────────
async def generate_pos(db: AsyncSession, indent: Indent) -> dict:
    """Group indent items by their resolved supplier (picked > preferred >
    cheapest) and create one PO per vendor. Only items NO active vendor prices
    are skipped and reported."""
    items = await indent_items(db, indent.id)

    by_vendor: dict[uuid.UUID, list[dict]] = {}
    skipped: list[str] = []
    for it in items:
        chosen = await _resolve_supplier(db, it["item_id"], indent.hotel_id, it["vendor_id"])
        if chosen is None:
            skipped.append(it["item_name"])
            continue
        vendor_id, price = chosen
        by_vendor.setdefault(vendor_id, []).append({**it, "unit_price": price})

    seq, year = await _next_po_number(db, indent.hotel_id)
    created: list[PurchaseOrder] = []
    for vendor_id, lines in by_vendor.items():
        po = PurchaseOrder(
            hotel_id=indent.hotel_id,
            vendor_id=vendor_id,
            indent_id=indent.id,
            po_number=f"PO-{year}-{seq:03d}",
        )
        seq += 1
        db.add(po)
        await db.flush()
        total = Decimal("0")
        for ln in lines:
            line_total = (ln["required_qty"] * ln["unit_price"]).quantize(_Q2)
            total += line_total
            db.add(
                POItem(
                    po_id=po.id,
                    item_id=ln["item_id"],
                    ordered_qty=ln["required_qty"],
                    unit_price=ln["unit_price"],
                    line_total=line_total,
                )
            )
        po.total_amount = total.quantize(_Q2)
        created.append(po)

    indent.status = IndentStatus.ORDERED.value
    await db.commit()
    for po in created:
        await db.refresh(po)
    return {"purchase_orders": created, "skipped_items": skipped}


# ── Purchase orders ───────────────────────────────────────────────────────────
async def get_po(db: AsyncSession, po_id: uuid.UUID, hotel_id: uuid.UUID) -> PurchaseOrder | None:
    po = await db.get(PurchaseOrder, po_id)
    if po is None or po.hotel_id != hotel_id:
        return None
    return po


async def po_items(db: AsyncSession, po_id: uuid.UUID) -> list[dict]:
    rows = await db.execute(
        select(POItem, Item)
        .join(Item, POItem.item_id == Item.id)
        .where(POItem.po_id == po_id)
        # Grouped by category, then by name. A picker walking the cold room
        # wants every vegetable together, not an alphabetical list that sends
        # them back and forth across the store.
        .order_by(Item.category.nulls_last(), Item.name)
    )
    pairs = rows.all()

    # "a bottle holds 30 piece", per item, so a line can explain its own price
    # without the reader having to know the chain.
    chains = await packs_svc.levels_for(db, [it.id for _, it in pairs])

    def note(item: Item) -> str | None:
        levels = packs_svc.as_levels(chains.get(item.id, []))
        if not levels:
            return None
        top = levels[-1]
        size = packs.base_size(levels, top.position)
        return f"a {top.name} holds {packs.tidy(size)} {item.unit}"

    return [
        {
            "po_item_id": pi.id,
            "item_id": pi.item_id,
            "item_name": it.name,
            "category": (it.category or "").strip() or "Other",
            "unit": it.unit,
            "pack_note": note(it),
            "ordered_qty": pi.ordered_qty,
            "received_qty": pi.received_qty,
            "unit_price": pi.unit_price,
            "line_total": pi.line_total,
        }
        for pi, it in pairs
    ]


async def list_pos(db: AsyncSession, hotel_id: uuid.UUID) -> list[PurchaseOrder]:
    result = await db.execute(
        select(PurchaseOrder)
        .where(PurchaseOrder.hotel_id == hotel_id)
        .order_by(PurchaseOrder.created_at.desc())
    )
    return list(result.scalars().all())


async def vendor_name(db: AsyncSession, vendor_id: uuid.UUID) -> str:
    v = await db.get(Vendor, vendor_id)
    return v.name if v else "(vendor)"


async def receive_po(
    db: AsyncSession,
    po: PurchaseOrder,
    *,
    lines: dict[str, Decimal] | None = None,
    note: str | None = None,
    created_by: uuid.UUID | None = None,
):
    """Receive into stock (PURCHASE_IN → qty + weighted-avg cost).

    `lines` maps po_item_id -> the TOTAL qty actually received on that line (for a
    partial/short or over delivery, e.g. ordered 100, got 30). None = receive the
    full outstanding amount. Only the INCREMENT over what was already received is
    added to stock, so re-receiving is safe. `note` explains any difference and is
    stored on the PO for the received PDF."""
    from datetime import UTC, datetime

    rows = await db.execute(select(POItem).where(POItem.po_id == po.id))
    for pi in rows.scalars().all():
        want = lines.get(str(pi.id), pi.received_qty) if lines is not None else pi.ordered_qty
        if want < 0:
            want = Decimal("0")
        add = want - pi.received_qty  # only the newly-arrived amount hits stock
        if add > 0:
            item = await inventory_service.get_item(db, pi.item_id, po.hotel_id)
            if item is not None:
                await inventory_service.record_movement(
                    db, item, "PURCHASE_IN", add,
                    unit_cost=pi.unit_price, reference_id=po.id, reference_type="PURCHASE_ORDER",
                    vendor_id=po.vendor_id, created_by=created_by,
                )
        pi.received_qty = want
    po.status = POStatus.RECEIVED.value
    po.received_at = datetime.now(UTC)
    if note:
        po.receive_note = note

    # Book what arrived as an expense, so it reaches cost of sales.
    #
    # reports.pnl() reads cost_of_sales straight from the expenses table, so
    # until now receiving stock moved the stock and left the P&L believing the
    # food had been free. `post_for_po` is idempotent on purpose: a part
    # delivery receives the same PO again, and the expense is updated rather
    # than duplicated.
    from app.hotels.models import Hotel
    from app.purchasing.expense_link import post_for_po

    hotel = await db.get(Hotel, po.hotel_id)
    await post_for_po(db, po, hotel, created_by=created_by)

    await db.commit()
    await db.refresh(po)
    return po


_Q3 = Decimal("0.001")


async def reorder_suggestions(db: AsyncSession, hotel_id: uuid.UUID) -> list[dict]:
    """One-click reorder: orderable items at/below their minimum, with a suggested
    quantity that tops them back up to their PAR level (max_stock_level) — or to
    2× minimum if no par is set. Only items a vendor prices (orderable) are included."""
    low = await inventory_service.low_stock_items(db, hotel_id)
    counts = await inventory_service.vendor_counts(db, hotel_id)
    out: list[dict] = []
    for it in low:
        if counts.get(it.id, 0) == 0:
            continue  # no vendor prices it yet — can't generate a PO
        cur = it.current_stock
        if it.max_stock_level and it.max_stock_level > cur:
            target = it.max_stock_level
        else:
            target = (it.min_stock_level or Decimal("0")) * 2
        qty = target - cur
        if qty <= 0:
            qty = it.min_stock_level or Decimal("1")
        out.append(
            {
                "item_id": it.id,
                "item_name": it.name,
                "unit": it.unit,
                "current_stock": cur,
                "suggested_qty": qty.quantize(_Q3),
            }
        )
    return out
