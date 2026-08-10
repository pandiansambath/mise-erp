"""Pydantic schemas for inventory."""
import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.inventory.models import MovementType

_VALID_MOVEMENTS = {m.value for m in MovementType}


class PackLevelIn(BaseModel):
    """One rung a person typed: "1 small box = 30 packets".

    `position` is 1-based and 1 sits directly on the base unit. `contains`
    counts the rung BELOW, never the base unit — that is what lets someone say
    "a box holds ten small boxes" without working out that it is 15 000 g.
    """

    name: str = Field(min_length=1, max_length=40)
    contains: Decimal = Field(gt=0)


class PackLevelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    position: int
    name: str
    contains: Decimal
    #: How many BASE units one of these is — the product down the chain. Sent
    #: so no screen has to re-derive it and get it subtly different.
    base_size: Decimal


class ItemCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    unit: str = Field(min_length=1, max_length=20)
    category: str | None = None
    min_stock_level: Decimal | None = Field(default=None, ge=0)
    max_stock_level: Decimal | None = Field(default=None, ge=0)
    cost_price: Decimal | None = Field(default=None, ge=0)
    # Optional purchase pack: 1 pack_unit = pack_size units (e.g. 1 box = 5 kg).
    pack_unit: str | None = Field(default=None, max_length=20)
    pack_size: Decimal | None = Field(default=None, gt=0)
    #: The whole chain at once, smallest first. Sent as a list because the
    #: rungs only mean anything in order — patching one in isolation could
    #: leave "1 box = 10 small boxes" pointing at a rung that no longer exists.
    pack_levels: list[PackLevelIn] | None = None


class ItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    unit: str | None = Field(default=None, min_length=1, max_length=20)
    category: str | None = None
    min_stock_level: Decimal | None = Field(default=None, ge=0)
    max_stock_level: Decimal | None = Field(default=None, ge=0)
    cost_price: Decimal | None = Field(default=None, ge=0)
    is_active: bool | None = None
    allergens: str | None = Field(default=None, max_length=200)  # CSV of codes; "" = reviewed none
    pack_unit: str | None = Field(default=None, max_length=20)
    pack_size: Decimal | None = Field(default=None, ge=0)
    #: The whole chain at once, smallest first. Sent as a list because the
    #: rungs only mean anything in order — patching one in isolation could
    #: leave "1 box = 10 small boxes" pointing at a rung that no longer exists.
    pack_levels: list[PackLevelIn] | None = None


class ItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    category: str | None
    unit: str
    pack_unit: str | None = None
    pack_size: Decimal | None = None
    #: The buying chain, smallest first. Empty for an item bought loose.
    #: An item created before the chain existed reports its old
    #: pack_unit/pack_size here as a single rung, so every screen can read one
    #: shape and nothing has to be re-entered.
    pack_levels: list[PackLevelOut] = []
    current_stock: Decimal
    min_stock_level: Decimal | None
    max_stock_level: Decimal | None
    cost_price: Decimal | None
    average_cost: Decimal
    is_active: bool
    allergens: str | None = None  # CSV of allergen codes; None = not reviewed, "" = none
    vendor_count: int = 0  # active vendors pricing this item (0 = not orderable yet)
    purchase_vendor_count: int = 0  # DISTINCT vendors actually bought from (>1 ⇒ show breakdown)
    # chosen (★) vendor name, else cheapest provisional (None = no vendor sells it)
    best_vendor: str | None = None
    # True only when a supplier was actually picked (★ preferred), not a cheapest fallback
    best_vendor_chosen: bool = False
    best_vendor_price: Decimal | None = None  # that vendor's price for this item


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


class PurchaseByVendorRow(BaseModel):
    """One past purchase of an item: what was bought from a vendor, and when."""

    vendor_id: uuid.UUID | None = None
    vendor: str | None = None  # None = no supplier recorded on that purchase
    quantity: Decimal
    unit_cost: Decimal | None = None
    received_at: datetime
    reference_id: uuid.UUID | None = None  # the delivery/PO this came on (the "chain")
    reference_type: str | None = None


class ReceiptLine(BaseModel):
    """One item on a delivery/PO receipt — the 'chain' opened from a purchase."""

    item_name: str
    unit: str
    quantity: Decimal
    unit_cost: Decimal | None = None
    line_total: Decimal | None = None
    vendor: str | None = None
    received_at: datetime


class LowStockAlert(BaseModel):
    item_id: uuid.UUID
    name: str
    current_stock: Decimal
    min_stock_level: Decimal
    shortfall: Decimal


class WasteCreate(BaseModel):
    item_id: uuid.UUID
    quantity: Decimal = Field(gt=0)  # positive magnitude wasted (sign handled server-side)
    reason: str = Field(min_length=1, max_length=200)


class WasteRow(BaseModel):
    id: uuid.UUID
    item_id: uuid.UUID
    item_name: str
    unit: str
    quantity: Decimal  # positive magnitude wasted
    unit_cost: Decimal | None
    value: Decimal  # quantity × unit_cost (what the waste cost you)
    reason: str | None
    created_at: datetime


class WasteList(BaseModel):
    total_value: Decimal
    entry_count: int
    rows: list[WasteRow]


class CategoryRename(BaseModel):
    from_name: str = Field(min_length=1, max_length=60)
    to_name: str = Field(min_length=1, max_length=60)
