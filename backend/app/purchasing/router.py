"""Indent & purchase-order endpoints. Hotel-scoped."""
import uuid
from decimal import Decimal
from difflib import SequenceMatcher

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core import textract as textract_svc
from app.core.database import get_db
from app.core.events import publish
from app.hotels.models import Hotel
from app.inventory.service import get_item
from app.purchasing import pdf as pdf_gen
from app.purchasing import service
from app.purchasing.models import IndentStatus, POStatus
from app.purchasing.schemas import (
    GenerateResult,
    IndentCreate,
    IndentOut,
    ItemSuppliers,
    POOut,
    POReceiveRequest,
    POSummary,
    ReorderSuggestion,
)
from app.vendors import service as vendor_service
from app.vendors.models import Vendor

router = APIRouter(prefix="/purchasing", tags=["purchasing"])


async def _indent_out(db, indent) -> IndentOut:
    return IndentOut(
        id=indent.id, date=indent.date, status=indent.status, notes=indent.notes,
        items=await service.indent_items(db, indent.id),
    )


async def _po_out(db, po) -> POOut:
    return POOut(
        id=po.id, vendor_id=po.vendor_id,
        vendor_name=await service.vendor_name(db, po.vendor_id),
        po_number=po.po_number, status=po.status, total_amount=po.total_amount,
        receive_note=po.receive_note,
        items=await service.po_items(db, po.id),
    )


# ── Indents ─────────────────────────────────────────────────────────────────
@router.post("/indents", response_model=IndentOut, status_code=status.HTTP_201_CREATED)
async def create_indent(
    payload: IndentCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:write")),
) -> IndentOut:
    for it in payload.items:
        if await get_item(db, it.item_id, user.hotel_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    indent = await service.create_indent(
        db, user.hotel_id, [it.model_dump() for it in payload.items],
        notes=payload.notes, created_by=user.id,
    )
    await publish(user.hotel_id, {"type": "purchasing", "action": "indent_created"})
    return await _indent_out(db, indent)


@router.get("/indents", response_model=list[IndentOut])
async def list_indents(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> list[IndentOut]:
    indents = await service.list_indents(db, user.hotel_id)
    return [await _indent_out(db, i) for i in indents]


@router.post("/indents/{indent_id}/approve", response_model=IndentOut)
async def approve_indent(
    indent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:approve")),
) -> IndentOut:
    indent = await service.get_indent(db, indent_id, user.hotel_id)
    if indent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Indent not found")
    await service.set_indent_status(db, indent, IndentStatus.APPROVED.value)
    await publish(user.hotel_id, {"type": "purchasing", "action": "indent_approved"})
    return await _indent_out(db, indent)


@router.post("/indents/{indent_id}/generate-pos", response_model=GenerateResult)
async def generate_pos(
    indent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:approve")),
) -> GenerateResult:
    indent = await service.get_indent(db, indent_id, user.hotel_id)
    if indent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Indent not found")
    if indent.status not in (IndentStatus.APPROVED.value, IndentStatus.PENDING.value):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Indent already ordered")
    result = await service.generate_pos(db, indent)
    await publish(user.hotel_id, {"type": "purchasing", "action": "pos_generated"})
    return GenerateResult(
        purchase_orders=[await _po_out(db, po) for po in result["purchase_orders"]],
        skipped_items=result["skipped_items"],
    )


@router.delete("/indents/{indent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_indent(
    indent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:write")),
) -> Response:
    """Delete an indent (and any draft POs it produced). Blocked once a PO from
    it has been received — that stock is already in."""
    indent = await service.get_indent(db, indent_id, user.hotel_id)
    if indent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Indent not found")
    if await service.indent_has_received_po(db, indent.id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This indent has a received purchase order — its stock is already in, "
            "so it can't be deleted.",
        )
    await service.delete_indent(db, indent)
    await publish(user.hotel_id, {"type": "purchasing", "action": "indent_deleted"})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Supplier options (for the per-line picker in the UI) ─────────────────────
@router.get("/item-suppliers", response_model=list[ItemSuppliers])
async def list_item_suppliers(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> list[ItemSuppliers]:
    by_item = await service.item_suppliers(db, user.hotel_id)
    return [ItemSuppliers(item_id=k, vendors=v) for k, v in by_item.items()]


@router.get("/reorder-suggestions", response_model=list[ReorderSuggestion])
async def reorder_suggestions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:write")),
) -> list[ReorderSuggestion]:
    """Orderable items at/below minimum, with a suggested top-up-to-par quantity.
    Powers the Purchasing 'Order all low-stock' one-click."""
    rows = await service.reorder_suggestions(db, user.hotel_id)
    return [ReorderSuggestion.model_validate(r) for r in rows]


# ── Purchase orders ───────────────────────────────────────────────────────────
@router.get("/purchase-orders", response_model=list[POSummary])
async def list_pos(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> list[POSummary]:
    pos = await service.list_pos(db, user.hotel_id)
    names = {
        v.id: v.name
        for v in (await db.execute(
            select(Vendor).where(Vendor.hotel_id == user.hotel_id)
        )).scalars().all()
    }
    out = []
    for p in pos:
        row = POSummary.model_validate(p)
        row.vendor_name = names.get(p.vendor_id, "")
        out.append(row)
    return out


async def _consolidated_for_indent(
    db: AsyncSession, hotel_id: uuid.UUID, indent_id: uuid.UUID
) -> dict:
    """The POs generated from ONE indent (one per vendor), combined into a single
    view. Each vendor group carries its PO id/number so the UI can also grab that
    vendor's own PDF. Received qty is kept per line so short deliveries stay visible."""
    pos = [p for p in await service.list_pos(db, hotel_id) if p.indent_id == indent_id]
    vendor_rows = (
        await db.execute(select(Vendor).where(Vendor.hotel_id == hotel_id))
    ).scalars().all()
    vnames = {v.id: v.name for v in vendor_rows}
    vendors: list[dict] = []
    grand = Decimal("0")
    item_count = 0
    for p in pos:
        items = await service.po_items(db, p.id)
        vendors.append({
            "vendor_id": str(p.vendor_id),
            "vendor_name": vnames.get(p.vendor_id, ""),
            "po_id": str(p.id),
            "po_number": p.po_number,
            "po_numbers": [p.po_number],  # for the shared PDF renderer
            "status": p.status,
            "subtotal": str(p.total_amount),
            "items": [
                {
                    "item_name": it["item_name"],
                    "ordered_qty": str(it["ordered_qty"]),
                    "received_qty": str(it["received_qty"]),
                    "unit_price": str(it["unit_price"]),
                    "line_total": str(it["line_total"]),
                    "po_number": p.po_number,
                }
                for it in items
            ],
        })
        grand += p.total_amount
        item_count += len(items)
    return {
        "vendors": vendors,
        "grand_total": str(grand),
        "po_count": len(pos),
        "vendor_count": len(pos),  # one PO per vendor per indent
        "item_count": item_count,
    }


@router.get("/indents/{indent_id}/consolidated")
async def indent_consolidated(
    indent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> dict:
    """This indent's POs (per vendor) + a combined total, for the consolidated view."""
    data = await _consolidated_for_indent(db, user.hotel_id, indent_id)
    hotel = await db.get(Hotel, user.hotel_id)
    data["currency"] = hotel.base_currency if hotel else "GBP"
    return data


@router.get("/indents/{indent_id}/consolidated.pdf")
async def indent_consolidated_pdf(
    indent_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> Response:
    """One consolidated PDF for this indent, grouped by vendor."""
    data = await _consolidated_for_indent(db, user.hotel_id, indent_id)
    hotel = await db.get(Hotel, user.hotel_id)
    pdf = pdf_gen.generate_consolidated_po_pdf(data["vendors"], data["grand_total"], hotel)
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=consolidated-po.pdf"},
    )


@router.get("/purchase-orders/{po_id}", response_model=POOut)
async def get_po(
    po_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> POOut:
    po = await service.get_po(db, po_id, user.hotel_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    return await _po_out(db, po)


@router.post("/purchase-orders/{po_id}/receive", response_model=POOut)
async def receive_po(
    po_id: uuid.UUID,
    payload: POReceiveRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:approve")),
) -> POOut:
    """Receive a PO into stock. Optional body carries the ACTUAL received qty per line
    (for a short/over delivery) + a reason; omit it to receive everything as ordered."""
    po = await service.get_po(db, po_id, user.hotel_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    lines = None
    note = None
    if payload:
        note = payload.note
        if payload.lines:
            lines = {str(ln.po_item_id): ln.received_qty for ln in payload.lines}
    await service.receive_po(db, po, lines=lines, note=note, created_by=user.id)

    # From a scanned bill: adopt the invoice's unit prices as this vendor's new price
    # for each item (records a price-history row with source=invoice).
    price_updates = 0
    if payload and payload.update_prices and payload.lines:
        item_by_poitem = {
            str(it["po_item_id"]): it["item_id"] for it in await service.po_items(db, po.id)
        }
        for ln in payload.lines:
            if ln.unit_price is not None:
                item_id = item_by_poitem.get(str(ln.po_item_id))
                if item_id is not None:
                    await vendor_service.upsert_vendor_item(
                        db, po.vendor_id, item_id, ln.unit_price, source="invoice"
                    )
                    price_updates += 1

    await publish(user.hotel_id, {"type": "purchasing", "action": "po_received"})
    summary = f"Received PO {po.po_number} into stock"
    if note:
        summary += f" — short/over: {note[:80]}"
    if price_updates:
        summary += f" — updated {price_updates} price(s) from the bill"
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="po.received",
        summary=summary, entity_type="purchase_order", entity_id=po.id,
    )
    return await _po_out(db, po)


@router.post("/purchase-orders/{po_id}/scan-bill")
async def scan_bill(
    po_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:approve")),
) -> dict:
    """Read a vendor bill (Textract AnalyzeExpense) and match its lines to THIS PO's
    items — returning a reconcile preview (received qty + new unit price per line) the
    operator confirms before receiving. We already know the vendor + expected items, so
    matching is against a handful of lines, not the whole catalogue."""
    po = await service.get_po(db, po_id, user.hotel_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    try:
        parsed = textract_svc.analyze_expense(data)
    except textract_svc.TextractError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    po_lines = await service.po_items(db, po.id)
    bill_lines = parsed["line_items"]
    used: set[int] = set()
    out_lines: list[dict] = []
    for pl in po_lines:
        best_i, best_score = -1, 0.0
        for i, bl in enumerate(bill_lines):
            if i in used or not bl.get("description"):
                continue
            score = SequenceMatcher(
                None, pl["item_name"].lower(), bl["description"].lower()
            ).ratio()
            if score > best_score:
                best_i, best_score = i, score
        matched = best_score >= 0.4
        bl = bill_lines[best_i] if matched else None
        if matched:
            used.add(best_i)
        out_lines.append({
            "po_item_id": str(pl["po_item_id"]),
            "item_name": pl["item_name"],
            "ordered_qty": str(pl["ordered_qty"]),
            "old_price": str(pl["unit_price"]),
            "matched_text": bl["description"] if bl else None,
            "received_qty": (bl.get("qty") if bl and bl.get("qty") else str(pl["ordered_qty"])),
            "unit_price": (bl.get("unit_price") if bl else None) or str(pl["unit_price"]),
            "confidence": round(best_score, 2),
        })
    unmatched = [bl["description"] for i, bl in enumerate(bill_lines) if i not in used]
    return {
        "vendor": parsed["vendor"],
        "total": parsed["total"],
        "lines": out_lines,
        "unmatched": unmatched,
    }


@router.post("/purchase-orders/{po_id}/revert", response_model=IndentOut)
async def revert_po(
    po_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:approve")),
) -> IndentOut:
    """Send a purchase order back to its indent: discards the PO batch and
    re-opens the indent (APPROVED) so it can be edited/regenerated. Blocked once
    received."""
    po = await service.get_po(db, po_id, user.hotel_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    if po.status == POStatus.RECEIVED.value or (
        po.indent_id and await service.indent_has_received_po(db, po.indent_id)
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This order has been received — stock has moved, so it can't be reverted to an indent.",
        )
    if po.indent_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This purchase order has no indent to revert to."
        )
    indent = await service.revert_po(db, po)
    await publish(user.hotel_id, {"type": "purchasing", "action": "po_reverted"})
    if indent is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Indent not found")
    return await _indent_out(db, indent)


@router.get("/purchase-orders/{po_id}/pdf")
async def po_pdf(
    po_id: uuid.UUID,
    received: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> Response:
    """The PO PDF. ?received=1 returns the Goods Received Note (ordered vs received
    + the delivery note) so you can keep both the expected and the actual on file."""
    po = await service.get_po(db, po_id, user.hotel_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    hotel = await db.get(Hotel, user.hotel_id)
    items = await service.po_items(db, po.id)
    vname = await service.vendor_name(db, po.vendor_id)
    pdf = pdf_gen.generate_po_pdf(po, vname, items, hotel, received=received)
    suffix = "-received" if received else ""
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{po.po_number}{suffix}.pdf"'},
    )
