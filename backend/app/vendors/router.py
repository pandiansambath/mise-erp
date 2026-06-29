"""Vendor endpoints: CRUD, item pricing, and price comparison. Hotel-scoped."""
import uuid
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
from app.core.template_io import XLSX_MIME, Column, TemplateSpec
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


# Strict price-list template (Item + Price required; Unit optional).
PRICE_LIST_TEMPLATE = TemplateSpec(
    name="Vendor price list",
    subtitle="One row per item this supplier sells. Item + Price are required (*).",
    columns=[
        Column("item", "Item", required=True, aliases=("item name", "name", "product")),
        Column("price", "Price", required=True, kind="number",
               aliases=("price per unit", "unit price", "rate", "cost")),
        Column("unit", "Unit", aliases=("uom",)),
    ],
    sample_rows=[
        ["Basmati Rice", 5.00, "kg"], ["Ghee", 6.80, "kg"], ["Carry Bags (Large)", 3.55, "pack"],
    ],
)


def _pl_file(content: bytes, media_type: str, ext: str) -> Response:
    return Response(
        content=content, media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="mise-vendor-price-list.{ext}"'},
    )


@router.get("/price-list-template.xlsx")
async def price_list_template(user: User = Depends(require("vendors:read"))) -> Response:
    return _pl_file(template_io.template_xlsx(PRICE_LIST_TEMPLATE), XLSX_MIME, "xlsx")


@router.get("/price-list-template.csv")
async def price_list_template_csv(user: User = Depends(require("vendors:read"))) -> Response:
    return _pl_file(template_io.template_csv(PRICE_LIST_TEMPLATE), "text/csv", "csv")


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


@router.post("/{vendor_id}/items/import")
async def import_price_list(
    vendor_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:write")),
) -> dict:
    """Upload a vendor's price list (Excel/CSV). Validated STRICTLY against the
    template — a mismatch returns the exact problems (422) so the user can fix it.
    Matches items by name (creates new ones), upserts each price."""
    vendor = await service.get_vendor(db, vendor_id, user.hotel_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"File exceeds {settings.max_upload_mb} MB"
        )
    rows, errors = template_io.parse_upload(
        data, file.filename or "", file.content_type or "", PRICE_LIST_TEMPLATE
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})
    tuples = [
        (r["item"], Decimal(str(r["price"])) if "price" in r else None, r.get("unit"))
        for r in rows
    ]
    return await service.import_price_list(db, user.hotel_id, vendor_id, tuples)


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
