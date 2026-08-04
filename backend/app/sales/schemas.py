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
    # Why a figure was changed. Optional, but the UI asks for it when editing a
    # day that was already closed — that is the edit somebody will question later.
    reason: str | None = None


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


class DrawerBreakdown(BaseModel):
    """The workings behind `expected_cash`. Shown in full because "expected 480,
    counted 455" is an accusation, while the parts that made up 480 are
    something a manager can actually check."""

    opening: Decimal
    cash_sales: Decimal
    cash_expenses: Decimal      # paid out of the till
    petty_out: Decimal          # taken and not yet returned
    petty_returned: Decimal     # change put back
    expected: Decimal
    counted: Decimal | None
    variance: Decimal | None
    unreconciled: list[dict] = []


class PettyCashOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    date: date_type
    taken_amount: Decimal
    spent_amount: Decimal | None
    returned_amount: Decimal | None
    purpose: str | None
    taken_by: str | None
    status: str
    expense_id: uuid.UUID | None


class PettyCashTake(BaseModel):
    taken_amount: Decimal = Field(gt=0)
    purpose: str | None = None
    taken_by: str | None = None


class PettyCashSettle(BaseModel):
    """What actually happened to the float. `spent + returned` must equal what
    was taken, or the difference is money nobody can account for."""

    spent_amount: Decimal = Field(ge=0)
    returned_amount: Decimal = Field(ge=0)
    # Book the spend as a real expense so it reaches the P&L, not just the till.
    category_id: uuid.UUID | None = None
    note: str | None = None


class CashEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    date: date_type
    field: str
    old_value: Decimal | None
    new_value: Decimal | None
    reason: str | None
    source: str
    created_at: datetime


class DaySummary(BaseModel):
    id: uuid.UUID | None
    date: date_type
    opening_cash: Decimal
    cash_counted: Decimal | None
    expected_cash: Decimal  # opening + cash sales - cash out +/- petty
    cash_variance: Decimal | None  # counted - expected (None until counted)
    # Yesterday's closing count, offered when today has not been opened yet.
    suggested_opening: Decimal | None = None
    closed_at: datetime | None = None
    auto_closed: bool = False
    drawer: DrawerBreakdown | None = None
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
