"""Schemas for employees & attendance."""
import uuid
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.employees.models import AttendanceStatus, PunchType, SalaryType

_SAL = {s.value for s in SalaryType}
_PUNCH = {p.value for p in PunchType}
_STATUS = {s.value for s in AttendanceStatus}


class EmployeeCreate(BaseModel):
    full_name: str = Field(min_length=1, max_length=120)
    job_title: str | None = None
    salary_type: str = SalaryType.MONTHLY.value
    monthly_salary: Decimal | None = Field(default=None, ge=0)
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    mobile: str | None = None
    address: str | None = None
    emergency_contact: str | None = None
    emergency_phone: str | None = None
    ni_number: str | None = None
    visa_expiry_date: date_type | None = None
    bank_account_no: str | None = None
    bank_sort_code: str | None = None
    joining_date: date_type | None = None

    @field_validator("salary_type")
    @classmethod
    def valid_salary(cls, v: str) -> str:
        if v not in _SAL:
            raise ValueError(f"salary_type must be one of {sorted(_SAL)}")
        return v


class EmployeeUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    job_title: str | None = None
    salary_type: str | None = None
    monthly_salary: Decimal | None = Field(default=None, ge=0)
    hourly_rate: Decimal | None = Field(default=None, ge=0)
    mobile: str | None = None
    address: str | None = None
    emergency_contact: str | None = None
    emergency_phone: str | None = None
    ni_number: str | None = None
    visa_expiry_date: date_type | None = None
    bank_account_no: str | None = None
    bank_sort_code: str | None = None
    joining_date: date_type | None = None
    is_active: bool | None = None


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_code: str
    full_name: str
    job_title: str | None
    salary_type: str
    monthly_salary: Decimal | None
    hourly_rate: Decimal | None
    mobile: str | None
    ni_number: str | None
    visa_expiry_date: date_type | None
    bank_sort_code: str | None
    bank_account_no: str | None
    joining_date: date_type | None
    is_active: bool
    user_id: uuid.UUID | None  # linked login account, if any


class EmployeeAccountIn(BaseModel):
    """Create/attach a login for an employee (super-admin/manager only)."""
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role: str = "STAFF"


class VisaAlert(BaseModel):
    employee_id: uuid.UUID
    full_name: str
    visa_expiry_date: date_type
    days_left: int


class PunchRequest(BaseModel):
    employee_id: uuid.UUID
    type: str

    @field_validator("type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in _PUNCH:
            raise ValueError(f"type must be one of {sorted(_PUNCH)}")
        return v


class AttendanceSet(BaseModel):
    employee_id: uuid.UUID
    date: date_type
    status: str = AttendanceStatus.PRESENT.value
    working_hours: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        if v not in _STATUS:
            raise ValueError(f"status must be one of {sorted(_STATUS)}")
        return v


class AttendanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    date: date_type
    clock_in: datetime | None
    clock_out: datetime | None
    break_minutes: int
    working_hours: Decimal | None
    status: str


class AttendanceRow(BaseModel):
    employee_id: uuid.UUID
    employee_name: str
    date: date_type
    clock_in: datetime | None
    clock_out: datetime | None
    working_hours: Decimal | None
    status: str
    on_break: bool = False
