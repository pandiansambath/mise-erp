"""Pydantic schemas for daily sales & cash."""
import uuid
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.sales.models import PaymentMethod

_METHODS = {m.value for m in PaymentMethod}


class ChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    commission_pct: Decimal = Field(default=Decimal("0"), ge=0, le=100)


class ChannelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    commission_pct: Decimal | None = Field(default=None, ge=0, le=100)
    is_active: bool | None = None


class ChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    commission_pct: Decimal
    is_active: bool
    usage_count: int = 0  # how many sales lines use it (for the safe-archive warning)


class DayUpsert(BaseModel):
    # date comes from the URL path; not required in the body
    opening_cash: Decimal | None = Field(default=None, ge=0)
    cash_counted: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None


class LineCreate(BaseModel):
    channel_id: uuid.UUID
    gross_amount: Decimal = Field(ge=0)
    payment_method: str = "CARD"
    notes: str | None = None

    @field_validator("payment_method")
    @classmethod
    def valid_method(cls, v: str) -> str:
        if v not in _METHODS:
            raise ValueError(f"payment_method must be one of {sorted(_METHODS)}")
        return v


class LineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    channel_id: uuid.UUID
    channel_name: str
    gross_amount: Decimal
    commission: Decimal
    net_amount: Decimal
    payment_method: str


class DayTotals(BaseModel):
    gross: Decimal
    commission: Decimal
    net: Decimal
    cash_sales: Decimal
    card_sales: Decimal


class DaySummary(BaseModel):
    id: uuid.UUID | None
    date: date_type
    opening_cash: Decimal
    cash_counted: Decimal | None
    expected_cash: Decimal  # opening + cash sales
    cash_variance: Decimal | None  # counted - expected (None until counted)
    notes: str | None
    lines: list[LineOut]
    totals: DayTotals


class RangeSummary(BaseModel):
    date_from: date_type
    date_to: date_type
    gross: Decimal
    commission: Decimal
    net: Decimal
    days: int


class DayCreatedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    date: date_type
    opening_cash: Decimal
    cash_counted: Decimal | None
    notes: str | None
    created_at: datetime


# ── Dish sales (menu-engineering bridge) ──────────────────────────────────────
class DishCount(BaseModel):
    recipe_id: uuid.UUID
    qty: int = Field(ge=0)


class DishSalesIn(BaseModel):
    counts: list[DishCount]


class DishSalesOut(BaseModel):
    date: date_type
    counts: list[DishCount]
