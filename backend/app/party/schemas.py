"""Party-quote API schemas."""
import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class PartyQuoteLineIn(BaseModel):
    recipe_id: uuid.UUID | None = None
    name: str
    qty: int = 1
    # The price CHARGED per plate. allow_inf_nan=False: JSON's Infinity would
    # otherwise pass ge=0 and then crash the 2dp rounding as a 500.
    unit_price: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    # The recipe's price beside it. Leaving the key out (an older page) means the
    # line was recipe-priced; an explicit null means the recipe has no price.
    recipe_price: float | None = Field(default=None, ge=0, allow_inf_nan=False)
    unit_cost: float = Field(default=0.0, ge=0, allow_inf_nan=False)


class PartyQuoteCreate(BaseModel):
    customer: str = ""
    event_date: date | None = None
    currency: str = "GBP "
    lines: list[PartyQuoteLineIn]


class PartyQuoteLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    recipe_id: uuid.UUID | None
    name: str
    qty: int
    unit_price: float | None
    recipe_price: float | None   # MUST be declared — response_model drops undeclared fields
    own_price: bool
    unit_cost: float


class PartyQuoteOut(BaseModel):
    id: uuid.UUID
    customer: str | None
    event_date: date | None
    valid_until: date | None
    currency: str
    total_price: float
    total_cost: float
    profit: float
    margin: float
    is_expired: bool
    created_at: datetime
    lines: list[PartyQuoteLineOut]
