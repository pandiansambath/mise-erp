"""Purchasing service: indents, vendor-wise POs (the admin's chosen supplier), receiving."""
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
        select(IndentItem, Item)
        .join(Item, IndentItem.item_id == Item.id)
        .where(IndentItem.indent_id == indent_id)
        .order_by(Item.name)
    )
    return [
        {
            "item_id": ii.item_id,
            "item_name": it.name,
            "required_qty": ii.required_qty,
            "unit": it.unit,
        }
        for ii, it in rows.all()
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


# ── Chosen vendor lookup (the admin's pick — no cheapest fallback) ────────────
async def _chosen_vendor(
    db: AsyncSession, item_id: uuid.UUID, hotel_id: uuid.UUID
) -> tuple[uuid.UUID, Decimal] | None:
    """The vendor the admin CHOSE for this item (is_preferred). No cheapest
    fallback — the admin must pick a supplier on purpose."""
    row = await db.execute(
        select(VendorItem.vendor_id, VendorItem.price_per_unit)
        .join(Vendor, VendorItem.vendor_id == Vendor.id)
        .where(
            VendorItem.item_id == item_id,
            Vendor.hotel_id == hotel_id,
            Vendor.is_active.is_(True),
            VendorItem.is_preferred.is_(True),
        )
        .limit(1)
    )
    r = row.first()
    return (r[0], r[1]) if r else None


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
    """Group indent items by their CHOSEN supplier and create one PO each.
    Items with no chosen supplier are skipped and reported (admin must pick one)."""
    items = await indent_items(db, indent.id)

    by_vendor: dict[uuid.UUID, list[dict]] = {}
    skipped: list[str] = []
    for it in items:
        chosen = await _chosen_vendor(db, it["item_id"], indent.hotel_id)
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
            created_by=created_by,
        )
        pi.received_qty = pi.ordered_qty
    po.status = POStatus.RECEIVED.value
    await db.commit()
    await db.refresh(po)
    return po
