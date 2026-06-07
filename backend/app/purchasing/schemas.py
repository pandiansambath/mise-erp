"""Schemas for indents & purchase orders."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class IndentItemIn(BaseModel):
    item_id: uuid.UUID
    required_qty: Decimal = Field(gt=0)
    notes: str | None = None


class IndentCreate(BaseModel):
    notes: str | None = None
    items: list[IndentItemIn] = Field(min_length=1)


class IndentItemOut(BaseModel):
    item_id: uuid.UUID
    item_name: str
    required_qty: Decimal
    unit: str


class IndentOut(BaseModel):
    id: uuid.UUID
    date: date_type
    status: str
    notes: str | None
    items: list[IndentItemOut]


class POItemOut(BaseModel):
    item_id: uuid.UUID
    item_name: str
    ordered_qty: Decimal
    received_qty: Decimal
    unit_price: Decimal
    line_total: Decimal


class POOut(BaseModel):
    id: uuid.UUID
    vendor_id: uuid.UUID
    vendor_name: str
    po_number: str
    status: str
    total_amount: Decimal
    items: list[POItemOut]


class POSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vendor_id: uuid.UUID
    po_number: str
    status: str
    total_amount: Decimal


class GenerateResult(BaseModel):
    purchase_orders: list[POOut]
    skipped_items: list[str]  # item names with no vendor price (can't be ordered)
