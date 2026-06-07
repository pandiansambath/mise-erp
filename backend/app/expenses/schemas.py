"""Pydantic schemas for expenses."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.expenses.models import ExpenseKind

_KINDS = {k.value for k in ExpenseKind}


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: str = ExpenseKind.VARIABLE.value

    @field_validator("kind")
    @classmethod
    def valid_kind(cls, v: str) -> str:
        if v not in _KINDS:
            raise ValueError(f"kind must be one of {sorted(_KINDS)}")
        return v


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    kind: str | None = None
    is_active: bool | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    kind: str
    is_active: bool


class ExpenseCreate(BaseModel):
    category_id: uuid.UUID
    date: date_type
    amount: Decimal = Field(ge=0)
    vat_amount: Decimal = Field(default=Decimal("0"), ge=0)
    description: str | None = None
    vendor_id: uuid.UUID | None = None
    payment_method: str = "BANK"
    is_recurring: bool = False
    recurrence: str | None = None


class ExpenseUpdate(BaseModel):
    category_id: uuid.UUID | None = None
    date: date_type | None = None
    amount: Decimal | None = Field(default=None, ge=0)
    vat_amount: Decimal | None = Field(default=None, ge=0)
    description: str | None = None
    vendor_id: uuid.UUID | None = None
    payment_method: str | None = None
    is_recurring: bool | None = None
    recurrence: str | None = None


class ExpenseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    category_id: uuid.UUID
    category_name: str
    kind: str
    date: date_type
    amount: Decimal
    vat_amount: Decimal
    description: str | None
    payment_method: str
    is_recurring: bool


class CategoryTotal(BaseModel):
    category_id: uuid.UUID
    category_name: str
    kind: str
    total: Decimal


class ExpenseSummary(BaseModel):
    date_from: date_type
    date_to: date_type
    fixed_total: Decimal
    variable_total: Decimal
    vat_total: Decimal
    grand_total: Decimal
    by_category: list[CategoryTotal]
