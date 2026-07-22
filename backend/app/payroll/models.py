"""Payroll models: Payroll run + SalaryAdvance. Hotel-scoped."""
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


class PayrollStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    PAID = "PAID"


class Payroll(Base):
    __tablename__ = "payroll"
    __table_args__ = (UniqueConstraint("employee_id", "pay_period", name="uq_payroll_emp_period"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # "2026-06" (month) · "2026-W23" (ISO week) · "2026-07-05→2026-08-04" (custom)
    pay_period: Mapped[str] = mapped_column(String(30), nullable=False)
    # Exact dates this run covers — the overlap guard's source of truth.
    period_start: Mapped[date | None] = mapped_column(Date)
    period_end: Mapped[date | None] = mapped_column(Date)
    pay_period_type: Mapped[str] = mapped_column(String(10), nullable=False, default="MONTHLY")
    working_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    days_present: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    half_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_hours: Mapped[Decimal] = mapped_column(
        Numeric(7, 2), nullable=False, default=Decimal("0")
    )
    gross_pay: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    overtime_pay: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    advance_deduction: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    other_deductions: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    net_pay: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default=PayrollStatus.DRAFT.value
    )
    processed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SalaryAdvance(Base):
    __tablename__ = "salary_advances"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    given_date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    deduct_period: Mapped[str] = mapped_column(String(10), nullable=False)  # 2026-06
    is_deducted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
