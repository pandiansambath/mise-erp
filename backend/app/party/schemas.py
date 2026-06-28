"""Party-quote API schemas."""
import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class PartyQuoteLineIn(BaseModel):
    recipe_id: uuid.UUID | None = None
    name: str
    qty: int = 1
    unit_price: float | None = None
    unit_cost: float = 0.0


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
