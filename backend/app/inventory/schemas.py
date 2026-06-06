"""Pydantic schemas for inventory."""
import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.inventory.models import MovementType

_VALID_MOVEMENTS = {m.value for m in MovementType}


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    unit: str = Field(min_length=1, max_length=20)
    category: str | None = None
    min_stock_level: Decimal | None = Field(default=None, ge=0)
    max_stock_level: Decimal | None = Field(default=None, ge=0)
    cost_price: Decimal | None = Field(default=None, ge=0)


class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    unit: str | None = Field(default=None, min_length=1, max_length=20)
    category: str | None = None
    min_stock_level: Decimal | None = Field(default=None, ge=0)
    max_stock_level: Decimal | None = Field(default=None, ge=0)
    cost_price: Decimal | None = Field(default=None, ge=0)
    is_active: bool | None = None


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    category: str | None
    unit: str
    current_stock: Decimal
    min_stock_level: Decimal | None
    max_stock_level: Decimal | None
    cost_price: Decimal | None
    average_cost: Decimal
    is_active: bool


class StockMovementCreate(BaseModel):
    movement_type: str
    # For PURCHASE_IN/RETURN/CONSUMPTION/WASTE: a positive magnitude (sign derived from type).
    # For ADJUSTMENT: a signed delta (negative to correct stock down).
    quantity: Decimal
    unit_cost: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None

    @field_validator("movement_type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in _VALID_MOVEMENTS:
            raise ValueError(f"movement_type must be one of {sorted(_VALID_MOVEMENTS)}")
        return v

    @field_validator("quantity")
    @classmethod
    def quantity_non_zero(cls, v: Decimal) -> Decimal:
        if v == 0:
            raise ValueError("quantity must be non-zero")
        return v


class StockMovementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    item_id: uuid.UUID
    movement_type: str
    quantity: Decimal
    unit_cost: Decimal | None
    notes: str | None
    created_at: datetime


class LowStockAlert(BaseModel):
    item_id: uuid.UUID
    name: str
    current_stock: Decimal
    min_stock_level: Decimal
    shortfall: Decimal
