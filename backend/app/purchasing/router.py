"""Indent & purchase-order endpoints. Hotel-scoped."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.hotels.models import Hotel
from app.inventory.service import get_item
from app.purchasing import pdf as pdf_gen
from app.purchasing import service
from app.purchasing.models import IndentStatus
from app.purchasing.schemas import (
    GenerateResult,
    IndentCreate,
    IndentOut,
    POOut,
    POSummary,
)

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
    return GenerateResult(
        purchase_orders=[await _po_out(db, po) for po in result["purchase_orders"]],
        skipped_items=result["skipped_items"],
    )


# ── Purchase orders ───────────────────────────────────────────────────────────
@router.get("/purchase-orders", response_model=list[POSummary])
async def list_pos(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> list[POSummary]:
    pos = await service.list_pos(db, user.hotel_id)
    return [POSummary.model_validate(p) for p in pos]


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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:approve")),
) -> POOut:
    po = await service.get_po(db, po_id, user.hotel_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    await service.receive_po(db, po, created_by=user.id)
    return await _po_out(db, po)


@router.get("/purchase-orders/{po_id}/pdf")
async def po_pdf(
    po_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> Response:
    po = await service.get_po(db, po_id, user.hotel_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    hotel = await db.get(Hotel, user.hotel_id)
    items = await service.po_items(db, po.id)
    vname = await service.vendor_name(db, po.vendor_id)
    pdf = pdf_gen.generate_po_pdf(po, vname, items, hotel)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{po.po_number}.pdf"'},
    )
