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
    StockMovementCreate,
    StockMovementOut,
    WasteCreate,
    WasteList,
    WasteRow,
)

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
ITEMS_TEMPLATE = TemplateSpec(
    name="Inventory items",
    subtitle="One row per item. Keep the headers. Name + Unit are required (*).",
    columns=[
        Column("name", "Name", required=True, aliases=("item", "product", "ingredient")),
        Column("unit", "Unit", required=True, aliases=("uom", "units")),
        Column("category", "Category", aliases=("type", "group")),
        Column("current_stock", "Opening stock", kind="number",
               aliases=("stock", "quantity", "qty", "opening")),
        Column("cost_price", "Cost price", kind="number",
               aliases=("price", "cost", "unit cost", "cost per unit")),
    ],
    sample_rows=[
        ["Basmati Rice", "kg", "Dry Goods", 25, 1.20],
        ["Paneer", "kg", "Dairy", 10, 4.50],
        ["Chicken", "kg", "Meat", 8, 3.80],
    ],
)


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
    """Validate a filled Excel/CSV template STRICTLY. On a mismatch, return the exact
    problems (422) so the user can fix + re-upload. On success, return the parsed rows
    (writes nothing) — the client previews, then commits via /import-template/commit."""
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
    """Create the validated rows (no AI). Existing items (same name) are skipped, so a
    re-upload is safe. Returns what was added vs skipped."""
    created: list[str] = []
    skipped: list[str] = []
    for row in payload.rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        fields = {
            k: row[k] for k in ("name", "unit", "category", "current_stock", "cost_price")
            if row.get(k) not in (None, "")
        }
        if fields.get("cost_price"):
            fields["average_cost"] = fields["cost_price"]
        try:
            await service.create_item(db, user.hotel_id, **fields)
            created.append(name)
        except service.DuplicateItemError:
            skipped.append(name)
    if created:
        await audit.record(
            db, hotel_id=user.hotel_id, user=user, action="inventory.import",
            summary=f"Imported {len(created)} items from a template", entity_type="items",
        )
    return {"created": created, "skipped": skipped}
