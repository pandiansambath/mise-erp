"""Inventory endpoints: items, stock movements, low-stock alerts, waste. Hotel-scoped."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core import template_io
from app.core.config import settings
from app.core.database import get_db
from app.core.template_io import Column, TemplateSpec
from app.inventory import export, service
from app.inventory.models import MovementType
from app.inventory.schemas import (
    CategoryRename,
    ItemCreate,
    ItemOut,
    ItemUpdate,
    LowStockAlert,
    PurchaseByVendorRow,
    ReceiptLine,
    StockMovementCreate,
    StockMovementOut,
    WasteCreate,
    WasteList,
    WasteRow,
)
from app.vendors import service as vendor_service

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.post("/items", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
async def create_item(
    payload: ItemCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> ItemOut:
    try:
        item = await service.create_item(
            db, user.hotel_id, **payload.model_dump(exclude_none=True)
        )
    except service.DuplicateItemError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return ItemOut.model_validate(item)


@router.get("/items", response_model=list[ItemOut])
async def list_items(
    category: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[ItemOut]:
    items = await service.list_items(db, user.hotel_id, category=category)
    counts = await service.vendor_counts(db, user.hotel_id)
    pv_counts = await service.purchase_vendor_counts(db, user.hotel_id)
    best = await service.best_vendors(db, user.hotel_id)
    out = []
    for i in items:
        row = ItemOut.model_validate(i)
        row.vendor_count = counts.get(i.id, 0)
        row.purchase_vendor_count = pv_counts.get(i.id, 0)
        chosen = best.get(i.id)
        if chosen:
            row.best_vendor, row.best_vendor_chosen, row.best_vendor_price = chosen
        out.append(row)
    return out


@router.get("/alerts/low-stock", response_model=list[LowStockAlert])
async def low_stock(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[LowStockAlert]:
    items = await service.low_stock_items(db, user.hotel_id)
    return [
        LowStockAlert(
            item_id=i.id,
            name=i.name,
            current_stock=i.current_stock,
            min_stock_level=i.min_stock_level,
            shortfall=i.min_stock_level - i.current_stock,
        )
        for i in items
    ]


@router.get("/items/{item_id}", response_model=ItemOut)
async def get_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> ItemOut:
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return ItemOut.model_validate(item)


@router.patch("/items/{item_id}", response_model=ItemOut)
async def update_item(
    item_id: uuid.UUID,
    payload: ItemUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> ItemOut:
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    try:
        item = await service.update_item(db, item, **payload.model_dump(exclude_unset=True))
    except service.DuplicateItemError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return ItemOut.model_validate(item)


@router.post("/seed-starter")
async def seed_starter(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """One-click: add the curated starter catalogue (common restaurant items, name +
    unit + category only) so a new hotel isn't empty. Re-runnable — existing names
    are skipped. Prices/suppliers are left blank for the owner to set via Vendors."""
    result = await service.seed_starter_items(db, user.hotel_id)
    if result["added"]:
        await audit.record(
            db, hotel_id=user.hotel_id, user=user, action="inventory.seed_starter",
            summary=f"Imported {len(result['added'])} starter items",
            entity_type="item", entity_id=None,
        )
    return {
        "added": len(result["added"]),
        "skipped": len(result["skipped"]),
        "names": result["added"],
    }


@router.get("/items/{item_id}/usage")
async def get_item_usage(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> dict:
    """How tied-in an item is (recipes / orders / stock movements / vendor links) so
    the UI can warn precisely before removing — and say whether it'll delete or archive."""
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return await service.item_usage(db, item)


@router.delete("/items/{item_id}")
async def delete_item(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:delete")),  # only "*" (Super Admin) grants this
) -> dict:
    """Remove an item (Super Admin only). Unused items are permanently deleted; items
    with recipe/order/stock history are ARCHIVED so the books stay intact."""
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    name = item.name
    result = await service.remove_item(db, item)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action=f"inventory.{result['action']}",
        summary=f"{result['action'].capitalize()} item: {name}",
        entity_type="item", entity_id=item_id,
    )
    return result


@router.post("/categories/rename")
async def rename_category(
    payload: CategoryRename,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Rename a category across all its items; renaming into an existing name merges them."""
    moved = await service.rename_category(db, user.hotel_id, payload.from_name, payload.to_name)
    return {"updated": moved}


@router.post(
    "/items/{item_id}/movements",
    response_model=StockMovementOut,
    status_code=status.HTTP_201_CREATED,
)
async def record_movement(
    item_id: uuid.UUID,
    payload: StockMovementCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> StockMovementOut:
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    if payload.movement_type == MovementType.PURCHASE_IN.value and payload.unit_cost is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unit_cost is required for PURCHASE_IN")
    try:
        movement = await service.record_movement(
            db,
            item,
            payload.movement_type,
            payload.quantity,
            unit_cost=payload.unit_cost,
            notes=payload.notes,
            created_by=user.id,
        )
    except service.InsufficientStockError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return StockMovementOut.model_validate(movement)


@router.get("/items/{item_id}/purchases-by-vendor", response_model=list[PurchaseByVendorRow])
async def purchases_by_vendor(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[PurchaseByVendorRow]:
    """A record of recent purchases of this item, per supplier (what you bought
    + at what price). Current stock stays one pool at weighted-average cost."""
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    rows = await service.purchases_by_vendor(db, item)
    return [PurchaseByVendorRow(**r) for r in rows]


@router.get("/receipts/{reference_id}", response_model=list[ReceiptLine])
async def receipt_lines(
    reference_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[ReceiptLine]:
    """The CHAIN: every item received on the same delivery/PO as a purchase — open a
    purchase up into the full receipt it came on. Hotel-scoped."""
    rows = await service.receipt_lines(db, user.hotel_id, reference_id)
    return [ReceiptLine(**r) for r in rows]


@router.get("/items/{item_id}/movements", response_model=list[StockMovementOut])
async def list_movements(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> list[StockMovementOut]:
    item = await service.get_item(db, item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    movements = await service.list_movements(db, item_id)
    return [StockMovementOut.model_validate(m) for m in movements]


# ── Waste ────────────────────────────────────────────────────────────────────
@router.post("/waste", response_model=WasteRow, status_code=status.HTTP_201_CREATED)
async def log_waste(
    payload: WasteCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> WasteRow:
    """Log spoilage/spillage/over-prep — decrements stock and records the £ value
    at weighted-average cost (so the Money page can show the leak)."""
    item = await service.get_item(db, payload.item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    try:
        mv = await service.record_waste(
            db, item, payload.quantity, payload.reason, created_by=user.id
        )
    except service.InsufficientStockError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    qty = abs(mv.quantity)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="stock.waste",
        summary=f"Logged waste: {qty} {item.unit} {item.name} ({payload.reason})",
        entity_type="item", entity_id=item.id,
    )
    return WasteRow(
        id=mv.id,
        item_id=item.id,
        item_name=item.name,
        unit=item.unit,
        quantity=qty,
        unit_cost=mv.unit_cost,
        value=qty * (mv.unit_cost or 0),
        reason=mv.notes,
        created_at=mv.created_at,
    )


@router.get("/waste", response_model=WasteList)
async def list_waste(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> WasteList:
    rows = await service.list_waste(db, user.hotel_id, date_from, date_to)
    out = [WasteRow.model_validate(r) for r in rows]
    total = sum((r.value for r in out), start=Decimal("0"))
    return WasteList(total_value=total, entry_count=len(out), rows=out)


# ── Exports (stock valuation + waste log) ────────────────────────────────────
def _file(content: bytes, media_type: str, filename: str) -> Response:
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/items.csv")
async def items_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> Response:
    items = await service.list_items(db, user.hotel_id)
    suppliers = await service.best_vendors(db, user.hotel_id)
    return _file(export.items_to_csv(items, suppliers), "text/csv", "mise-stock-valuation.csv")


@router.get("/items.xlsx")
async def items_xlsx(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> Response:
    items = await service.list_items(db, user.hotel_id)
    suppliers = await service.best_vendors(db, user.hotel_id)
    return _file(export.items_to_xlsx(items, suppliers), XLSX_MIME, "mise-stock-valuation.xlsx")


@router.get("/waste.csv")
async def waste_csv(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> Response:
    rows = await service.list_waste(db, user.hotel_id, date_from, date_to)
    return _file(export.waste_to_csv(rows, date_from, date_to), "text/csv", "mise-waste-log.csv")


@router.get("/waste.xlsx")
async def waste_xlsx(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:read")),
) -> Response:
    rows = await service.list_waste(db, user.hotel_id, date_from, date_to)
    return _file(export.waste_to_xlsx(rows, date_from, date_to), XLSX_MIME, "mise-waste-log.xlsx")


# ── Strict import template (Excel/CSV) ────────────────────────────────────────
# NO price column — prices live with the supplier (single source of truth). The
# optional Supplier column only LINKS an existing vendor price: if that vendor
# already prices the item we set it as the ★ chosen one; otherwise we tell you why.
ITEMS_TEMPLATE = TemplateSpec(
    name="Inventory items",
    subtitle=(
        "One row per item. Name + Unit required (*). Supplier is optional — its price "
        "is read from Vendors (you never type a price here)."
    ),
    columns=[
        Column("name", "Name", required=True, aliases=("item", "product", "ingredient")),
        Column("unit", "Unit", required=True, aliases=("uom", "units")),
        Column("category", "Category", aliases=("type", "group")),
        Column("current_stock", "Opening stock", kind="number",
               aliases=("stock", "quantity", "qty", "opening")),
        Column("supplier", "Supplier", aliases=("vendor", "supplier name")),
    ],
    sample_rows=[
        ["Basmati Rice", "kg", "Dry Goods", 25, "Fresh Farms"],
        ["Paneer", "kg", "Dairy", 10, ""],
        ["Chicken", "kg", "Meat", 8, ""],
    ],
)


async def _find_vendor(db: AsyncSession, hotel_id: uuid.UUID, name: str):
    """Find a vendor by normalised (trim + case-fold) name. Does NOT create one —
    a missing supplier is reported so the user adds it on Vendors."""
    nl = name.strip().casefold()
    vendors = await vendor_service.list_vendors(db, hotel_id)
    return next((v for v in vendors if v.name and v.name.strip().casefold() == nl), None)


@router.get("/template.xlsx")
async def items_template_xlsx(user: User = Depends(require("inventory:read"))) -> Response:
    return _file(
        template_io.template_xlsx(ITEMS_TEMPLATE), XLSX_MIME, "mise-inventory-template.xlsx"
    )


@router.get("/template.csv")
async def items_template_csv(user: User = Depends(require("inventory:read"))) -> Response:
    return _file(
        template_io.template_csv(ITEMS_TEMPLATE), "text/csv", "mise-inventory-template.csv"
    )


@router.get("/template.pdf")
async def items_template_pdf(user: User = Depends(require("inventory:read"))) -> Response:
    """A printable reference of the template (fill the Excel/CSV to actually import)."""
    return _file(
        template_io.template_pdf(ITEMS_TEMPLATE), "application/pdf", "mise-inventory-template.pdf"
    )


@router.post("/import-template")
async def import_template(
    file: UploadFile = File(...),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Validate a filled Excel/CSV template (items only). On a mismatch (missing
    Name/Unit columns, a non-number where a number's expected) return the exact errors
    (422) so the user can fix + re-upload. Returns the parsed rows (writes nothing)."""
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB"
        )
    rows, errors = template_io.parse_upload(
        data, file.filename or "", file.content_type or "", ITEMS_TEMPLATE
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})
    return {"kind": "items", "rows": rows}


class _ImportCommit(BaseModel):
    rows: list[dict]


@router.post("/import-template/commit")
async def import_template_commit(
    payload: _ImportCommit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("inventory:write")),
) -> dict:
    """Create the validated items (no AI). A Supplier column, if filled, LINKS the
    item to that vendor's existing price (never types one): vendor missing or the
    vendor doesn't price the item → reported in `notes`. Existing items are skipped
    but still get the supplier link if possible."""
    created: list[str] = []
    skipped: list[str] = []
    linked: list[str] = []
    notes: list[str] = []
    for row in payload.rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        fields = {
            k: row[k] for k in ("name", "unit", "category", "current_stock")
            if row.get(k) not in (None, "")
        }
        try:
            item = await service.create_item(db, user.hotel_id, **fields)
            created.append(name)
        except service.DuplicateItemError:
            item = await service.get_item_by_name(db, user.hotel_id, name)
            skipped.append(name)
            if item is None:
                continue

        supplier = str(row.get("supplier") or "").strip()
        if not supplier:
            continue
        vendor = await _find_vendor(db, user.hotel_id, supplier)
        if vendor is None:
            notes.append(f"{name}: supplier “{supplier}” not found — add it on Vendors first.")
            continue
        # set_preferred only succeeds if that vendor already prices this item.
        if await vendor_service.set_preferred_vendor(db, user.hotel_id, item.id, vendor.id):
            linked.append(name)
            vis = await vendor_service.list_vendor_items(db, vendor.id)
            price = next((vi.price_per_unit for vi in vis if vi.item_id == item.id), None)
            if price is not None and not item.average_cost:
                await service.update_item(db, item, average_cost=price)  # value opening stock
        else:
            notes.append(
                f"{name}: {vendor.name} doesn’t list this item yet — set its price on Vendors."
            )
    if created or linked:
        await audit.record(
            db, hotel_id=user.hotel_id, user=user, action="inventory.import",
            summary=f"Imported {len(created)} items from a template", entity_type="items",
        )
    return {"created": created, "skipped": skipped, "linked": linked, "notes": notes}
