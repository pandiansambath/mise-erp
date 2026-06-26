"""Pydantic schemas for vendors + price comparison."""
import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.vendors.models import VendorCategory

_VALID_CATEGORIES = {c.value for c in VendorCategory}


class VendorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    category: str | None = None
    sub_category: str | None = None
    contact_person: str | None = None
    mobile: str | None = None
    email: EmailStr | None = None
    address: str | None = None
    vat_number: str | None = None
    payment_type: str | None = None
    payment_frequency: str | None = None
    credit_days: int = Field(default=0, ge=0)
    bank_account_no: str | None = None
    bank_sort_code: str | None = None

    @field_validator("category")
    @classmethod
    def valid_category(cls, v: str | None) -> str | None:
        # Superadmins can add their OWN vendor types, not just the built-ins —
        # accept any non-empty label (the built-ins in _VALID_CATEGORIES just
        # seed the UI chips + drive the emoji map).
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if len(v) > 40:
            raise ValueError("category must be 40 characters or fewer")
        return v


class VendorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    category: str | None = None
    sub_category: str | None = None
    contact_person: str | None = None
    mobile: str | None = None
    email: EmailStr | None = None
    address: str | None = None
    vat_number: str | None = None
    payment_type: str | None = None
    payment_frequency: str | None = None
    credit_days: int | None = Field(default=None, ge=0)
    bank_account_no: str | None = None
    bank_sort_code: str | None = None
    rating: Decimal | None = Field(default=None, ge=0, le=5)
    is_active: bool | None = None


class VendorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    category: str | None
    sub_category: str | None
    contact_person: str | None
    mobile: str | None
    email: str | None
    vat_number: str | None
    payment_type: str | None
    payment_frequency: str | None
    credit_days: int
    rating: Decimal
    is_active: bool


class VendorItemUpsert(BaseModel):
    item_id: uuid.UUID
    price_per_unit: Decimal = Field(gt=0)
    # None = leave as-is (a price edit must NOT un-choose the ★ preferred supplier).
    is_preferred: bool | None = None
    notes: str | None = None


class VendorItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vendor_id: uuid.UUID
    item_id: uuid.UUID
    price_per_unit: Decimal
    last_updated: date
    is_preferred: bool


# ── Price comparison (the money feature) ───────────────────────────────────
class VendorPriceRow(BaseModel):
    vendor_id: uuid.UUID
    vendor_name: str
    price_per_unit: Decimal
    is_preferred: bool
    last_updated: date


class PriceComparison(BaseModel):
    item_id: uuid.UUID
    item_name: str
    unit: str
    vendor_count: int
    comparisons: list[VendorPriceRow]  # sorted cheapest first
    cheapest_vendor: VendorPriceRow | None
    most_expensive_vendor: VendorPriceRow | None
    potential_saving_per_unit: Decimal  # max price - min price
