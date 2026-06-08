"""Inventory endpoints: items, stock movements, low-stock alerts. Hotel-scoped."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.inventory import service
from app.inventory.models import MovementType
from app.inventory.schemas import (
    ItemCreate,
    ItemOut,
    ItemUpdate,
    LowStockAlert,
    StockMovementCreate,
    StockMovementOut,
)

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
    return [ItemOut.model_validate(i) for i in items]


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
