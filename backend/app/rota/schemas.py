"""Schemas for the shift rota."""
import uuid
from datetime import date as date_type
from datetime import time
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ShiftCreate(BaseModel):
    employee_id: uuid.UUID
    date: date_type
    start_time: time
    end_time: time
    notes: str | None = None


class ShiftOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str
    date: date_type
    start_time: time
    end_time: time
    hours: Decimal
    cost: Decimal
    notes: str | None


class LabourByEmployee(BaseModel):
    employee_id: uuid.UUID
    employee_name: str
    hours: Decimal
    cost: Decimal


class LabourSummary(BaseModel):
    date_from: date_type
    date_to: date_type
    total_hours: Decimal
    total_cost: Decimal
    net_sales: Decimal
    labour_pct: Decimal  # cost ÷ net sales (× 100); 0 if no sales
    by_employee: list[LabourByEmployee]
