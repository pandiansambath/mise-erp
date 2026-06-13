"""Vendor endpoints: CRUD, item pricing, and price comparison. Hotel-scoped."""
import io
import re
import uuid
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core.config import settings
from app.core.database import get_db
from app.inventory.service import get_item
from app.vendors import service
from app.vendors.schemas import (
    PriceComparison,
    VendorCreate,
    VendorItemOut,
    VendorItemUpsert,
    VendorOut,
    VendorUpdate,
)


class PreferredIn(BaseModel):
    vendor_id: uuid.UUID | None = None

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.post("", response_model=VendorOut, status_code=status.HTTP_201_CREATED)
async def create_vendor(
    payload: VendorCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> VendorOut:
    try:
        vendor = await service.create_vendor(
            db, user.hotel_id, **payload.model_dump(exclude_none=True)
        )
    except service.DuplicateVendorError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return VendorOut.model_validate(vendor)


@router.get("", response_model=list[VendorOut])
async def list_vendors(
    category: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> list[VendorOut]:
    vendors = await service.list_vendors(db, user.hotel_id, category=category)
    return [VendorOut.model_validate(v) for v in vendors]


@router.get("/price-list-template.xlsx")
async def price_list_template(
    user: User = Depends(require("vendors:read")),
) -> Response:
    """A sample Excel super admins can send to vendors so everyone uses one format."""
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Price list"
    ws.append(["Item", "Price", "Unit"])
    ws.append(["Basmati Rice", 5.00, "kg"])
    ws.append(["Ghee", 6.80, "kg"])
    ws.append(["Carry Bags (Large)", 3.55, "pack"])
    buf = io.BytesIO()
    wb.save(buf)
    fname = "mise-vendor-price-list-template.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/items/{item_id}/price-comparison", response_model=PriceComparison)
async def price_comparison(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> PriceComparison:
    """For one item: every vendor's price, cheapest first, and how much you'd save."""
    result = await service.compare_vendor_prices(db, item_id, user.hotel_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return PriceComparison.model_validate(result)


@router.post("/items/{item_id}/preferred", response_model=PriceComparison)
async def set_preferred(
    item_id: uuid.UUID,
    payload: PreferredIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> PriceComparison:
    """Mark a vendor as preferred for this item (recipe costing uses preferred, else cheapest)."""
    ok = await service.set_preferred_vendor(db, user.hotel_id, item_id, payload.vendor_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor does not supply this item")
    result = await service.compare_vendor_prices(db, item_id, user.hotel_id)
    vendor = await service.get_vendor(db, payload.vendor_id, user.hotel_id)
    item = await get_item(db, item_id, user.hotel_id)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="vendor.chosen",
        summary=f"Chose {vendor.name if vendor else 'a supplier'} as supplier for "
        f"{item.name if item else 'an item'}",
        entity_type="item", entity_id=item_id,
    )
    return PriceComparison.model_validate(result)


@router.get("/{vendor_id}", response_model=VendorOut)
async def get_vendor(
    vendor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> VendorOut:
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return VendorOut.model_validate(vendor)


@router.patch("/{vendor_id}", response_model=VendorOut)
async def update_vendor(
    vendor_id: uuid.UUID,
    payload: VendorUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> VendorOut:
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    vendor = await service.update_vendor(db, vendor, **payload.model_dump(exclude_unset=True))
    return VendorOut.model_validate(vendor)


@router.post(
    "/{vendor_id}/items", response_model=VendorItemOut, status_code=status.HTTP_201_CREATED
)
async def upsert_vendor_item(
    vendor_id: uuid.UUID,
    payload: VendorItemUpsert,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> VendorItemOut:
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    item = await get_item(db, payload.item_id, user.hotel_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    vi = await service.upsert_vendor_item(
        db,
        vendor_id,
        payload.item_id,
        payload.price_per_unit,
        is_preferred=payload.is_preferred,
        notes=payload.notes,
    )
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="vendor.price",
        summary=f"Set {vendor.name} price for {item.name} → {payload.price_per_unit}",
        entity_type="item", entity_id=item.id,
    )
    return VendorItemOut.model_validate(vi)


def _parse_price_list(data: bytes) -> list[tuple[str, Decimal | None, str | None]]:
    """Read an .xlsx with columns Item / Price (+ optional Unit). Lenient on
    header names and on price formatting (strips £, commas, etc.)."""
    from openpyxl import load_workbook

    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - any parse failure -> friendly 400
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Could not read the file — upload a .xlsx Excel file."
        ) from exc
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    header = next(rows_iter, None)
    if header is None:
        return []
    cols = {str(h).strip().lower(): i for i, h in enumerate(header) if h is not None}

    def find(*names: str) -> int | None:
        return next((cols[n] for n in names if n in cols), None)

    ci = find("item", "item name", "name", "product")
    pi = find("price", "price per unit", "price_per_unit", "unit price", "rate")
    ui = find("unit", "uom")
    if ci is None or pi is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Excel needs an 'Item' column and a 'Price' column (a 'Unit' column is optional).",
        )

    out: list[tuple[str, Decimal | None, str | None]] = []
    for row in rows_iter:
        name = row[ci] if ci < len(row) else None
        raw_price = row[pi] if pi < len(row) else None
        unit = row[ui] if (ui is not None and ui < len(row)) else None
        if name is None and raw_price is None:
            continue
        price: Decimal | None = None
        if raw_price is not None:
            cleaned = re.sub(r"[^0-9.]", "", str(raw_price))
            try:
                price = Decimal(cleaned) if cleaned else None
            except InvalidOperation:
                price = None
        out.append((
            str(name).strip() if name is not None else "",
            price,
            str(unit).strip() if unit is not None else None,
        ))
    return out


@router.post("/{vendor_id}/items/import")
async def import_price_list(
    vendor_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> dict:
    """Upload a vendor's price-list Excel. Matches items by name (creates new
    ones), upserts each price — re-uploading the same file is a no-op."""
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB"
        )
    rows = _parse_price_list(data)
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No rows found in the file.")
    return await service.import_price_list(db, user.hotel_id, vendor_id, rows)


@router.get("/{vendor_id}/items", response_model=list[VendorItemOut])
async def list_vendor_items(
    vendor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> list[VendorItemOut]:
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    items = await service.list_vendor_items(db, vendor_id)
    return [VendorItemOut.model_validate(i) for i in items]
