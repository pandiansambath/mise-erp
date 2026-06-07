"""Schemas for payroll."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ProcessRequest(BaseModel):
    pay_period: str = Field(pattern=r"^\d{4}-\d{2}$")  # YYYY-MM
    employee_id: uuid.UUID | None = None  # None = all active employees
    working_days: int = Field(default=26, gt=0, le=31)
    other_deductions: Decimal = Field(default=Decimal("0"), ge=0)


class PayrollRow(BaseModel):
    id: uuid.UUID
    employee_id: uuid.UUID
    employee_name: str
    pay_period: str
    gross_pay: Decimal
    overtime_pay: Decimal
    advance_deduction: Decimal
    other_deductions: Decimal
    net_pay: Decimal
    status: str


class AdvanceCreate(BaseModel):
    employee_id: uuid.UUID
    amount: Decimal = Field(gt=0)
    reason: str | None = None
    given_date: date_type | None = None
    deduct_period: str = Field(pattern=r"^\d{4}-\d{2}$")


class AdvanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    amount: Decimal
    reason: str | None
    given_date: date_type
    deduct_period: str
    is_deducted: bool
