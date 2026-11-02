"""Indent & purchase-order endpoints. Hotel-scoped."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.assistant import bedrock
from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.core.events import publish
from app.core.timezones import to_local
from app.hotels.models import Hotel
from app.inventory.service import get_item
from app.purchasing import pdf as pdf_gen
from app.purchasing import service, settle
from app.purchasing.expense_link import received_value, received_values
from app.purchasing.models import Basket, Indent, IndentStatus, POPaymentStatus, POStatus
from app.purchasing.schemas import (
    GenerateResult,
    IndentCreate,
    IndentOut,
    ItemSuppliers,
    MarkPaidRequest,
    POOut,
    POReceiveRequest,
    POSummary,
    POUpdateRequest,
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
    # What is owed, and the restaurant's day it arrived — for a RECEIVED order
    # only. An order on a lorry owes nothing yet.
    amount_due = None
    received_on = None
    if po.status == POStatus.RECEIVED.value:
        amount_due = await received_value(db, po)
        local = to_local(po.received_at, await db.get(Hotel, po.hotel_id))
        received_on = local.date() if local else None
    return POOut(
        id=po.id, vendor_id=po.vendor_id,
        vendor_name=await service.vendor_name(db, po.vendor_id),
        po_number=po.po_number, status=po.status, total_amount=po.total_amount,
        expected_delivery=po.expected_delivery,
        receive_note=po.receive_note,
        payment_status=po.payment_status,
        paid_on=po.paid_on,
        paid_method=po.paid_method,
        amount_due=amount_due,
        received_on=received_on,
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


class IndentPage(BaseModel):
    rows: list[IndentOut]
    #: how many matched the filter
    total: int
    #: how many exist at all, so the page can say "4 of 36"
    grand_total: int
    #: status -> how many, over everything the search matched
    counts: dict[str, int]


@router.get("/indents", response_model=IndentPage)
async def list_indents(
    q: str | None = None,
    status_filter: str | None = None,
    sort: str = "newest",
    limit: int = 10,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:read")),
) -> IndentPage:
    """One page of indents. `limit=0` means everything, for exports.

    Each row costs a second query for its items, so this endpoint used to make
    one round trip per indent in the hotel before returning anything. Paging
    turns that from "all of them" into "ten".
    """
    page = await service.list_indents_page(
        db,
        user.hotel_id,
        q=q,
        status=status_filter,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return IndentPage(
        rows=[await _indent_out(db, i) for i in page["rows"]],
        total=page["total"],
        grand_total=page["grand_total"],
        counts=page["counts"],
    )


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
    # The date of every indent these came from, in one query rather than one
    # per row — and so the UI never has to hope the indent is on the page it
    # happens to be showing.
    indent_ids = {p.indent_id for p in pos if p.indent_id}
    dates: dict[uuid.UUID, date_type] = {}
    if indent_ids:
        rows = await db.execute(
            select(Indent.id, Indent.date).where(Indent.id.in_(indent_ids))
        )
        dates = {i: d for i, d in rows.all()}

    # What each received order is due, in one query — the list shows "£42.00 to
    # pay" on every waiting row, and one query per row would be one per order
    # the hotel has ever placed.
    due = await received_values(
        db, [p.id for p in pos if p.status == POStatus.RECEIVED.value]
    )

    out = []
    for p in pos:
        row = POSummary.model_validate(p)
        row.vendor_name = names.get(p.vendor_id, "")
        row.indent_date = dates.get(p.indent_id) if p.indent_id else None
        if p.status == POStatus.RECEIVED.value:
            row.amount_due = due.get(p.id, Decimal("0.00"))
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


@router.patch("/purchase-orders/{po_id}", response_model=POOut)
async def update_po(
    po_id: uuid.UUID,
    payload: POUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:write")),
) -> POOut:
    """Set the order's expected-delivery date (the dashboard chases it for you)."""
    po = await service.get_po(db, po_id, user.hotel_id)
    if not po:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PO not found")
    po.expected_delivery = payload.expected_delivery
    await db.commit()
    await db.refresh(po)
    return await _po_out(db, po)


@router.post("/purchase-orders/{po_id}/receive", response_model=POOut)
async def receive_po(
    po_id: uuid.UUID,
    payload: POReceiveRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:approve")),
) -> POOut:
    """Receive a PO into stock. Optional body carries the ACTUAL received qty per line
    (for a short/over delivery) + a reason; omit it to receive everything as ordered.

    `pay` says whether it was paid for (§70): "later" puts it in stock and
    nothing in Expenses until it is marked paid; "now" with `paid_method` pays
    for what arrived today. Omitted keeps the old meaning — booked on receipt.
    """
    # Locked: two taps on "Received & paid" queue here, and the second finds
    # the order already paid (409) instead of paying the supplier twice.
    po = await service.get_po(db, po_id, user.hotel_id, for_update=True)
    if po is None:
        await db.rollback()  # let go of the lock on somebody else's row
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    lines = None
    prices = None
    note = None
    pay = payload.pay if payload else None
    paid_method = payload.paid_method if payload and pay == "now" else None
    if pay == "now":
        # PAYING needs the paying permission — the same check Mark paid and the
        # supplier page make. Receiving stock alone does not include it: "a
        # kitchen manager who can receive stock cannot pay for it" (review).
        try:
            await require("vendors:write")(user=user, db=db)
        except HTTPException:
            await db.rollback()
            raise
    if payload:
        note = payload.note
        if payload.lines:
            lines = {str(ln.po_item_id): ln.received_qty for ln in payload.lines}
            # The prices a scanned bill CHARGED — written onto the order before
            # it is valued, so a "paid now" payment is the bill's amount.
            prices = {
                str(ln.po_item_id): ln.unit_price
                for ln in payload.lines
                if ln.unit_price is not None
            } or None
    try:
        await service.receive_po(
            db, po, lines=lines, note=note, created_by=user.id,
            pay=pay, paid_method=paid_method, prices=prices,
        )
    except settle.PaidLocked as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except settle.BadPayment as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

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
    if po.payment_status == POPaymentStatus.PENDING.value:
        summary += " — payment pending"
    elif pay == "now":
        summary += f" — paid now ({paid_method})"
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="po.received",
        summary=summary, entity_type="purchase_order", entity_id=po.id,
    )
    return await _po_out(db, po)


@router.post("/purchase-orders/{po_id}/mark-paid", response_model=POOut)
async def mark_po_paid(
    po_id: uuid.UUID,
    payload: MarkPaidRequest,
    db: AsyncSession = Depends(get_db),
    # The same act as recording a payment on the supplier page, so the same
    # permission — a kitchen manager who can receive stock cannot pay for it.
    user: User = Depends(require("vendors:write")),
) -> POOut:
    """A pay-later order has been paid: its expense is posted NOW, dated the
    day it was paid.

        "once payment done then we can added in expense"
    """
    po = await service.get_po(db, po_id, user.hotel_id, for_update=True)
    if po is None:
        await db.rollback()  # let go of the lock on somebody else's row
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    try:
        await service.mark_paid(
            db, po,
            paid_on=payload.paid_on, method=payload.method,
            paying_now=payload.paying_now, reference=payload.reference,
            created_by=user.id,
        )
    except (settle.NotReceived, settle.AlreadyPaid) as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except settle.BadPayment as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    await publish(user.hotel_id, {"type": "purchasing", "action": "po_paid"})
    due = await received_value(db, po)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="po.paid",
        summary=(
            f"Marked {po.po_number} paid — £{settle.money(due)} by {payload.method} "
            f"on {settle.say_day(payload.paid_on)}"
        ),
        entity_type="purchase_order", entity_id=po.id,
    )
    return await _po_out(db, po)


def _same_unit(ours: str | None, theirs: str | None) -> bool:
    """Does the bill count this line in the unit the order does?

    The money law: a purchase order holds quantities and prices per BASE unit,
    and a supplier's bill is often per box. "2" off a bill that means two boxes,
    written into a field that means grams, is two grams of stock; £120 a box,
    written through `update_prices` as the price per gram, is a price ruined for
    every future order. So a bill number only fills a field when both sides
    name the same unit — "kg" and "kgs" agree, "box" and "g" do not, and a bill
    that names no unit at all is not trusted to agree with anything.
    """

    def norm(u: str | None) -> str:
        return (u or "").lower().strip().rstrip("s")

    return bool(norm(ours)) and norm(ours) == norm(theirs)


@router.post("/purchase-orders/{po_id}/scan-bill")
async def scan_bill(
    po_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:approve")),
) -> dict:
    """Read a supplier's bill against THIS order, and return a preview to confirm.

    The reading is done by the assistant model — the same one the rest of the app
    uses — rather than a second paid document service. It is handed the order's
    own lines, so it matches them itself instead of us fuzzy-matching whatever
    generic rows came back; that guess was a real source of wrong lines.

    Nothing here writes anything. The operator confirms every quantity and price
    before it becomes stock, which matters more with a model than it did before:
    a model can invent a number where a parser could only fail to find one.
    """
    po = await service.get_po(db, po_id, user.hotel_id)
    if po is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Purchase order not found")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")

    po_lines = await service.po_items(db, po.id)
    media = file.content_type or "image/jpeg"
    # A SUPPLIER INVOICE ARRIVES AS A PDF. Turning that away and asking for a
    # photograph of a document they already had digitally was the single most
    # absurd thing this endpoint did; `docbytes` sends it as a document block.

    try:
        read = await run_in_threadpool(
            bedrock.understand_document,
            data,
            media,
            kind="bill",
            filename=file.filename or "",
            # Only THIS order's lines, so the match is against a handful of
            # things it should contain rather than the whole catalogue.
            known_items=[
                {"id": str(pl["item_id"]), "name": pl["item_name"], "unit": pl.get("unit") or ""}
                for pl in po_lines
            ],
            known_vendors=[await service.vendor_name(db, po.vendor_id)],
        )
    except Exception as exc:  # noqa: BLE001 — surfaced to the operator as-is
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Could not read the bill: {exc}",
        ) from exc

    seen: set[str] = set()
    out_lines: list[dict] = []
    for pl in po_lines:
        hit = None
        for ln in read.get("lines") or []:
            mid = str(ln.get("matched_item_id") or "")
            if mid and mid == str(pl["item_id"]) and mid not in seen:
                hit = ln
                seen.add(mid)
                break
        bill_unit = (hit.get("unit") or None) if hit else None
        out_lines.append(
            {
                "po_item_id": str(pl["po_item_id"]),
                "item_name": pl["item_name"],
                "ordered_qty": str(pl["ordered_qty"]),
                "unit_price": str(pl["unit_price"]),
                # The order counts in BASE units; a bill very often counts in
                # boxes. These three let the screen tell "2 kg" from "2 box"
                # before it puts a number anywhere — see `_same_unit`.
                "unit": pl.get("unit") or "",
                "bill_unit": bill_unit,
                "same_unit": _same_unit(pl.get("unit"), bill_unit),
                "bill_qty": str(hit.get("qty")) if hit and hit.get("qty") is not None else None,
                "bill_unit_price": (
                    str(hit.get("unit_price"))
                    if hit and hit.get("unit_price") is not None
                    else None
                ),
                "matched": bool(hit),
            }
        )

    unmatched = [
        ln.get("name")
        for ln in (read.get("lines") or [])
        if not ln.get("matched_item_id") and ln.get("name")
    ]
    return {
        "vendor": read.get("vendor_name"),
        "total": read.get("total"),
        "lines": out_lines,
        "unmatched": unmatched,
        "read_by": "DineAI assistant",
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


# ── The basket: a half-built order, kept where the person is ─────────────────
class BasketLine(BaseModel):
    item_id: uuid.UUID
    qty: Decimal = Field(ge=0)
    vendor_id: uuid.UUID | None = None


class BasketOut(BaseModel):
    lines: list[BasketLine]


@router.get("/basket", response_model=BasketOut)
async def get_basket(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:write")),
) -> BasketOut:
    """Whatever this person had picked, from any browser on any device."""
    row = (
        await db.execute(select(Basket).where(Basket.user_id == user.id))
    ).scalar_one_or_none()
    return BasketOut(lines=[BasketLine(**ln) for ln in (row.lines if row else [])])


@router.put("/basket", response_model=BasketOut)
async def put_basket(
    payload: BasketOut,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("indent:write")),
) -> BasketOut:
    """Replace the basket wholesale.

    Wholesale rather than per line because that is what a basket IS — the
    current contents. Patching lines individually would need conflict handling
    for a draft nobody else can see.
    """
    lines = [
        {
            "item_id": str(ln.item_id),
            "qty": str(ln.qty),
            "vendor_id": str(ln.vendor_id) if ln.vendor_id else None,
        }
        for ln in payload.lines
        if ln.qty > 0
    ]
    row = (
        await db.execute(select(Basket).where(Basket.user_id == user.id))
    ).scalar_one_or_none()
    if row is None:
        row = Basket(hotel_id=user.hotel_id, user_id=user.id, lines=lines)
        db.add(row)
    else:
        row.lines = lines
    await db.commit()
    return BasketOut(lines=[BasketLine(**ln) for ln in lines])
