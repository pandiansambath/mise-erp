"""Schemas for indents & purchase orders."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class IndentItemIn(BaseModel):
    item_id: uuid.UUID
    required_qty: Decimal = Field(gt=0)
    # Optional supplier picked for THIS line (falls back preferred > cheapest).
    vendor_id: uuid.UUID | None = None
    notes: str | None = None


class IndentCreate(BaseModel):
    notes: str | None = None
    items: list[IndentItemIn] = Field(min_length=1)


class IndentItemOut(BaseModel):
    item_id: uuid.UUID
    item_name: str
    required_qty: Decimal
    unit: str
    vendor_id: uuid.UUID | None = None  # per-line override, if picked
    vendor_name: str | None = None


class IndentOut(BaseModel):
    id: uuid.UUID
    date: date_type
    status: str
    notes: str | None
    items: list[IndentItemOut]


class POItemOut(BaseModel):
    po_item_id: uuid.UUID
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
    receive_note: str | None = None
    items: list[POItemOut]


class POReceiveLine(BaseModel):
    po_item_id: uuid.UUID
    received_qty: Decimal = Field(ge=0)


class POReceiveRequest(BaseModel):
    """Optional body for receiving a PO: the actual qty received per line + a reason
    for any short/over delivery. Omit to receive everything as ordered."""
    lines: list[POReceiveLine] = []
    note: str | None = None


class POSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vendor_id: uuid.UUID
    vendor_name: str = ""
    po_number: str
    status: str
    total_amount: Decimal


class GenerateResult(BaseModel):
    purchase_orders: list[POOut]
    skipped_items: list[str]  # item names with no vendor price (can't be ordered)


class SupplierOption(BaseModel):
    vendor_id: uuid.UUID
    vendor_name: str
    price_per_unit: Decimal
    is_preferred: bool


class ItemSuppliers(BaseModel):
    item_id: uuid.UUID
    vendors: list[SupplierOption]


class ReorderSuggestion(BaseModel):
    item_id: uuid.UUID
    item_name: str
    unit: str
    current_stock: Decimal
    suggested_qty: Decimal  # tops stock back up to par (max), else 2× minimum
