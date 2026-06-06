"""Vendor endpoints: CRUD, item pricing, and price comparison."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
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

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.post("", response_model=VendorOut, status_code=status.HTTP_201_CREATED)
async def create_vendor(
    payload: VendorCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require("vendors:write")),
) -> VendorOut:
    vendor = await service.create_vendor(db, **payload.model_dump(exclude_none=True))
    return VendorOut.model_validate(vendor)


@router.get("", response_model=list[VendorOut])
async def list_vendors(
    category: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require("vendors:read")),
) -> list[VendorOut]:
    vendors = await service.list_vendors(db, category=category)
    return [VendorOut.model_validate(v) for v in vendors]


@router.get("/items/{item_id}/price-comparison", response_model=PriceComparison)
async def price_comparison(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require("vendors:read")),
) -> PriceComparison:
    """For one item: every vendor's price, cheapest first, and how much you'd save."""
    result = await service.compare_vendor_prices(db, item_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return PriceComparison.model_validate(result)


@router.get("/{vendor_id}", response_model=VendorOut)
async def get_vendor(
    vendor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require("vendors:read")),
) -> VendorOut:
    vendor = await service.get_vendor(db, vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return VendorOut.model_validate(vendor)


@router.patch("/{vendor_id}", response_model=VendorOut)
async def update_vendor(
    vendor_id: uuid.UUID,
    payload: VendorUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require("vendors:write")),
) -> VendorOut:
    vendor = await service.get_vendor(db, vendor_id)
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
    _: User = Depends(require("vendors:write")),
) -> VendorItemOut:
    vendor = await service.get_vendor(db, vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    if await get_item(db, payload.item_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    vi = await service.upsert_vendor_item(
        db,
        vendor_id,
        payload.item_id,
        payload.price_per_unit,
        is_preferred=payload.is_preferred,
        notes=payload.notes,
    )
    return VendorItemOut.model_validate(vi)


@router.get("/{vendor_id}/items", response_model=list[VendorItemOut])
async def list_vendor_items(
    vendor_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require("vendors:read")),
) -> list[VendorItemOut]:
    vendor = await service.get_vendor(db, vendor_id)
    if vendor is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    items = await service.list_vendor_items(db, vendor_id)
    return [VendorItemOut.model_validate(i) for i in items]
