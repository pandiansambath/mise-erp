"""Schemas for food-safety logs."""
import uuid
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class SafetyLogCreate(BaseModel):
    kind: str = Field(pattern="^(TEMP|CHECK)$")
    label: str = Field(min_length=1, max_length=120)
    reading: Decimal | None = None  # °C for TEMP
    status: str = Field(pattern="^(OK|FAIL|DONE)$")
    notes: str | None = None
    date: date_type | None = None  # defaults to today server-side


class SafetyLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    date: date_type
    kind: str
    label: str
    reading: Decimal | None
    status: str
    notes: str | None
    created_at: datetime
