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
    #: WHICH of that supplier's forms — their case, or their loose price. They
    #: can quote both at rates that are not multiples, so "cheapest" is not
    #: always wanted: two kilos does not want the fifty-kilo case, however good
    #: the rate. None = let the server take their cheapest.
    pack_level_id: uuid.UUID | None = None
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
    #: Which of that supplier's forms to buy — their case or their loose price.
    #: None = the server takes their cheapest per base unit.
    pack_level_id: uuid.UUID | None = None
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
    # The unit was already being loaded and then dropped here, which is why a
    # purchase-order line could only ever say "1 x 30.00" — a number times a
    # number, of nothing. "we need explain clearly to layman what it is."
    unit: str = ""
    #: "a bottle holds 30 piece" — only when the item comes in packs.
    pack_note: str | None = None
    ordered_qty: Decimal
    #: The quantity said as the PACK he ordered — "2 boxes" rather than "20 kg".
    #
    # Declared here because a field this schema does not name is DROPPED from
    # the response without a word: the service was already returning these and
    # the screen could never see them, so the PDF said "2 boxes" while the page
    # behind it said "20 kg". Two numbers for one order is worse than either.
    ordered_as: str | None = None
    received_qty: Decimal
    received_as: str | None = None
    unit_price: Decimal
    line_total: Decimal


class POOut(BaseModel):
    id: uuid.UUID
    vendor_id: uuid.UUID
    vendor_name: str
    po_number: str
    status: str
    total_amount: Decimal
    expected_delivery: date_type | None = None
    receive_note: str | None = None
    items: list[POItemOut]


class POReceiveLine(BaseModel):
    po_item_id: uuid.UUID
    received_qty: Decimal = Field(ge=0)
    # Actual unit price from the vendor bill (optional). When update_prices is set,
    # this becomes the vendor's new price for the item + a price-history row.
    unit_price: Decimal | None = Field(default=None, ge=0)


class POUpdateRequest(BaseModel):
    """When is this order actually arriving? Feeds the dashboard's due-today chip."""

    expected_delivery: date_type | None = None


class POReceiveRequest(BaseModel):
    """Optional body for receiving a PO: the actual qty received per line + a reason
    for any short/over delivery. Omit to receive everything as ordered."""
    lines: list[POReceiveLine] = []
    note: str | None = None
    # When true, each line's unit_price updates that vendor's price going forward.
    update_prices: bool = False


class POSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vendor_id: uuid.UUID
    vendor_name: str = ""
    po_number: str
    status: str
    total_amount: Decimal
    expected_delivery: date_type | None = None
    indent_id: uuid.UUID | None = None  # groups POs by the purchase run they came from
    #: The date of the indent this came from. Carried HERE because the indent
    #: list is paged — the page holds ten, and a run whose indent was not on it
    #: had nothing to name itself with, so almost every purchase read "Other
    #: orders". A row must carry what it needs to identify itself.
    indent_date: date_type | None = None


class GenerateResult(BaseModel):
    purchase_orders: list[POOut]
    skipped_items: list[str]  # item names with no vendor price (can't be ordered)


class SupplierOption(BaseModel):
    vendor_id: uuid.UUID
    vendor_name: str
    price_per_unit: Decimal
    #: Which size this supplier's price buys. None = one base unit.
    pack_level_id: uuid.UUID | None = None
    #: How many base units THEIR pack holds, when it differs from the item's.
    #:
    #: This was missing, and a missing field here is invisible in a way a wrong
    #: one is not: the query selected it and the service put it in the dict, but
    #: `response_model` drops whatever the schema does not declare. So every
    #: screen fed by /purchasing/item-suppliers — inventory, the order form —
    #: saw None and quietly fell back to the item's own size. A supplier whose
    #: box holds 500 kg was drawn as 50, with nothing anywhere reading as broken.
    pack_size_override: Decimal | None = None
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
