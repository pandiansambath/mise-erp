"""Employee & Attendance models. Hotel-scoped, with UK compliance fields."""
import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SalaryType(str, enum.Enum):
    MONTHLY = "MONTHLY"
    HOURLY = "HOURLY"


class AttendanceStatus(str, enum.Enum):
    PRESENT = "PRESENT"
    ABSENT = "ABSENT"
    HALF_DAY = "HALF_DAY"
    LEAVE = "LEAVE"


class PunchType(str, enum.Enum):
    CLOCK_IN = "CLOCK_IN"
    BREAK_START = "BREAK_START"
    BREAK_END = "BREAK_END"
    CLOCK_OUT = "CLOCK_OUT"


class Employee(Base):
    __tablename__ = "employees"
    __table_args__ = (UniqueConstraint("hotel_id", "employee_code", name="uq_emp_hotel_code"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))  # login link
    employee_code: Mapped[str] = mapped_column(String(20), nullable=False)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    mobile: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(Text)
    emergency_contact: Mapped[str | None] = mapped_column(String(120))
    emergency_phone: Mapped[str | None] = mapped_column(String(30))
    job_title: Mapped[str | None] = mapped_column(String(60))  # Chef, Cashier, Waiter…
    salary_type: Mapped[str] = mapped_column(
        String(10), nullable=False, default=SalaryType.MONTHLY.value
    )
    monthly_salary: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    hourly_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    # UK compliance
    ni_number: Mapped[str | None] = mapped_column(String(20))  # National Insurance
    visa_expiry_date: Mapped[date | None] = mapped_column(Date)  # NULL if UK/EU citizen
    bank_account_no: Mapped[str | None] = mapped_column(String(20))
    bank_sort_code: Mapped[str | None] = mapped_column(String(10))  # XX-XX-XX
    joining_date: Mapped[date | None] = mapped_column(Date)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Attendance(Base):
    __tablename__ = "attendance"
    __table_args__ = (UniqueConstraint("employee_id", "date", name="uq_att_emp_date"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    clock_in: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    clock_out: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    break_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    break_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    break_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    working_hours: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default=AttendanceStatus.PRESENT.value
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
