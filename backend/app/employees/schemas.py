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
    # Personal pay schedule: monthly staff get paid on this day-of-month (1-28);
    # weekly staff on this weekday (0=Mon .. 6=Sun). Informational + due-list.
    pay_day: int | None = Field(default=None, ge=1, le=28)
    pay_weekday: int | None = Field(default=None, ge=0, le=6)
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
    pay_day: int | None = Field(default=None, ge=1, le=28)
    pay_weekday: int | None = Field(default=None, ge=0, le=6)
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
    pay_day: int | None = None
    pay_weekday: int | None = None
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


class AttendanceEdit(BaseModel):
    """Super-Admin manual edit. Times are 'HH:MM' in the hotel's local time."""
    employee_id: uuid.UUID
    date: date_type
    clock_in: str | None = None
    clock_out: str | None = None
    break_minutes: int = Field(default=0, ge=0)

    @field_validator("clock_in", "clock_out")
    @classmethod
    def valid_hhmm(cls, v: str | None) -> str | None:
        if v in (None, ""):
            return None
        parts = v.split(":")
        if len(parts) != 2 or not (parts[0].isdigit() and parts[1].isdigit()):
            raise ValueError("time must be HH:MM")
        h, m = int(parts[0]), int(parts[1])
        if not (0 <= h < 24 and 0 <= m < 60):
            raise ValueError("invalid time")
        return f"{h:02d}:{m:02d}"


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
    break_end: datetime | None = None
    break_minutes: int = 0
    working_hours: Decimal | None
    status: str
    on_break: bool = False
    over_break_minutes: int = 0
    break_penalty: Decimal = Decimal("0")
