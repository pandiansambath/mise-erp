"""Purchasing service: indents, vendor-wise POs, receiving.

Supplier resolution per line (user-confirmed 2026-06-12): the vendor PICKED on
the indent line wins; otherwise the item's preferred ("chosen") vendor;
otherwise the CHEAPEST active vendor. Only items no active vendor prices at
all are skipped.
"""
import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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


async def set_indent_status(db: AsyncSession, indent: Indent, status: str) -> Indent:
    indent.status = status
    await db.commit()
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
        select(VendorItem.vendor_id, VendorItem.price_per_unit)
        .join(Vendor, VendorItem.vendor_id == Vendor.id)
        .where(
            VendorItem.item_id == item_id,
            Vendor.hotel_id == hotel_id,
            Vendor.is_active.is_(True),
        )
    )
    if override_vendor_id is not None:
        row = (await db.execute(base.where(Vendor.id == override_vendor_id).limit(1))).first()
        if row:
            return (row[0], row[1])
    row = (await db.execute(base.where(VendorItem.is_preferred.is_(True)).limit(1))).first()
    if row:
        return (row[0], row[1])
    row = (await db.execute(base.order_by(VendorItem.price_per_unit.asc()).limit(1))).first()
    return (row[0], row[1]) if row else None


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
        )
        .join(Vendor, VendorItem.vendor_id == Vendor.id)
        .where(Vendor.hotel_id == hotel_id, Vendor.is_active.is_(True))
        .order_by(VendorItem.item_id, VendorItem.price_per_unit.asc())
    )
    out: dict[uuid.UUID, list[dict]] = {}
    for item_id, vendor_id, name, price, pref in rows.all():
        out.setdefault(item_id, []).append(
            {
                "vendor_id": vendor_id,
                "vendor_name": name,
                "price_per_unit": price,
                "is_preferred": pref,
            }
        )
    return out


async def _next_po_number(db: AsyncSession, hotel_id: uuid.UUID) -> tuple[int, int]:
    year = date.today().year
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
        .order_by(Item.name)
    )
    return [
        {
            "item_id": pi.item_id,
            "item_name": it.name,
            "ordered_qty": pi.ordered_qty,
            "received_qty": pi.received_qty,
            "unit_price": pi.unit_price,
            "line_total": pi.line_total,
        }
        for pi, it in rows.all()
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


async def receive_po(db: AsyncSession, po: PurchaseOrder, *, created_by: uuid.UUID | None = None):
    """Receive all lines into stock (PURCHASE_IN → updates qty + weighted-avg cost)."""
    rows = await db.execute(select(POItem).where(POItem.po_id == po.id))
    for pi in rows.scalars().all():
        outstanding = pi.ordered_qty - pi.received_qty
        if outstanding <= 0:
            continue
        item = await inventory_service.get_item(db, pi.item_id, po.hotel_id)
        if item is None:
            continue
        await inventory_service.record_movement(
            db, item, "PURCHASE_IN", outstanding,
            unit_cost=pi.unit_price, reference_id=po.id, reference_type="PURCHASE_ORDER",
            vendor_id=po.vendor_id, created_by=created_by,
        )
        pi.received_qty = pi.ordered_qty
    po.status = POStatus.RECEIVED.value
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
