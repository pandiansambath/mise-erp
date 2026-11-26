"""Payroll models: the run, the payslips in it, and what each one is made of.

A RUN (`payroll_runs`) is what somebody presses: these dates, these people. A
PAYSLIP (`payroll`) is one person in it, and it is the thing that is approved,
held and paid. A DAY (`payroll_days`) is one day paid on one payslip, and it is
what stops a day being paid twice: a day with a row here is already in a run.

Three states, and what each one means for the books:

    DRAFT     worked out, agreed by nobody. Nothing anywhere else.
    APPROVED  agreed. Still nothing anywhere else: no money has moved.
    PAID      the money went. One expense, dated the day it was paid.
"""
import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PayrollStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    PAID = "PAID"


class PayBasis(str, enum.Enum):
    """What counts as pay for these dates."""

    #: Each person their usual way: hourly staff by the hours they worked,
    #: salaried staff by the days they came in.
    AUTO = "AUTO"
    ATTENDANCE = "ATTENDANCE"
    ROTA = "ROTA"
    #: The monthly salary, shared out over the days of the month.
    SALARY = "SALARY"
    #: Typed: hours, or an amount.
    MANUAL = "MANUAL"


class AdjustmentKind(str, enum.Enum):
    BONUS = "BONUS"
    TIPS = "TIPS"
    REIMBURSEMENT = "REIMBURSEMENT"
    OTHER = "OTHER"
    DEDUCTION = "DEDUCTION"


class PayrollRun(Base):
    """Some dates, some people. What somebody pressed "New run" for.

    It has NO STATUS of its own, on purpose: a run with three of eight people
    paid is exactly that, and a stored word would drift from the payslips the
    first time one was undone. `runs.run_status` reads it off them.
    """

    __tablename__ = "payroll_runs"
    __table_args__ = (UniqueConstraint("hotel_id", "number", name="uq_payroll_run_number"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    #: "Run 12". Two runs can cover the same dates, so a date alone names neither.
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    #: What was asked for, so a draft can be opened again and changed, and the
    #: last one copied to the next dates. Inputs only: every figure is in the
    #: payslips, worked out by the server.
    setup: Mapped[dict] = mapped_column(
        JSONB, nullable=False, default=dict, server_default="{}"
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Payroll(Base):
    """One person's payslip in one run."""

    __tablename__ = "payroll"
    # It was (employee, pay_period), which is why one person could not be in two
    # runs of the same dates: the second half of a week, a correction, a bonus.
    # Paying a DAY twice is what matters, and `payroll_days` is what stops it.
    __table_args__ = (
        UniqueConstraint("run_id", "employee_id", name="uq_payroll_run_employee"),
        Index("ix_payroll_emp_period", "employee_id", "pay_period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    #: Empty only on a row made by hand (a test). Every real payslip is in a run.
    run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("payroll_runs.id", ondelete="CASCADE"), index=True
    )
    # "2026-06" (month) · "2026-W23" (ISO week) · "2026-07-05→2026-08-04" (custom)
    pay_period: Mapped[str] = mapped_column(String(30), nullable=False)
    # The dates of the run. Which of those days this person is paid for is in
    # `payroll_days`, unless `day_lines` is off.
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
    #: How this was worked out, frozen when it was: the rate on somebody's
    #: record next month must not rewrite what this payslip says.
    basis: Mapped[str] = mapped_column(
        String(12), nullable=False, default=PayBasis.ATTENDANCE.value,
        server_default=PayBasis.ATTENDANCE.value,
    )
    pay_type: Mapped[str | None] = mapped_column(String(10))  # HOURLY | MONTHLY
    rate: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))  # £/hour or £/month
    #: The hours, in minutes. `total_hours` is the same thing rounded to two
    #: places, for the screens and the payslip that have always shown it.
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    #: True when `payroll_days` says which days this payslip covers. False on
    #: every payslip from before there were day lines: those cover the whole of
    #: period_start to period_end, which is how their overlap was always judged.
    day_lines: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    #: Money added on top of pay (bonus, tips, money owed back). What is taken
    #: off is `other_deductions`; net = gross + additions − both deductions.
    additions: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
    #: Held back: not approved and not paid with the rest until it is let go.
    held: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    note: Mapped[str | None] = mapped_column(Text)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: The day the money went, how, and by whose word. Set by paying and cleared
    #: by undoing it. Nothing else may touch them.
    paid_on: Mapped[date | None] = mapped_column(Date)
    paid_method: Mapped[str | None] = mapped_column(String(20))
    paid_reference: Mapped[str | None] = mapped_column(String(120))
    paid_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: The last time it was emailed. A recall cannot call an email back, so the
    #: person about to recall is told.
    emailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PayrollDay(Base):
    """One day on one payslip. Its amount is whole pence.

    The payslip's pay is the SUM of these, so what is shown day by day and what
    is paid can never differ by a penny.
    """

    __tablename__ = "payroll_days"
    __table_args__ = (
        UniqueConstraint("payroll_id", "date", name="uq_payroll_day"),
        Index("ix_payroll_days_emp_date", "employee_id", "date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    payroll_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payroll.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    #: Salaried days are counted in halves: 2 is a day, 1 is half of one.
    half_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    #: The hours or the half-days were typed for this run, not read.
    typed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    #: Paid although it was already in another run, because somebody said so.
    again: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )


class PayrollAdjustment(Base):
    """One thing added to or taken off a payslip, with a name and a sign."""

    __tablename__ = "payroll_adjustments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    payroll_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payroll.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    #: SIGNED. +50.00 is fifty pounds more in somebody's hand.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class PayrollAdvanceRecovery(Base):
    """How much of which advance this payslip took back.

    Without it a payslip could be removed and the advance stay "taken back": the
    person had their pay recalled and the restaurant lost the advance with it.
    """

    __tablename__ = "payroll_advance_recoveries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    payroll_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payroll.id", ondelete="CASCADE"), nullable=False, index=True
    )
    advance_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("salary_advances.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)


class ParkedWage(Base):
    """A wage the old version put in Expenses on APPROVAL, taken back out.

    Approval used to book the wage. The migration that stopped it MOVED the
    expense of every payslip approved and never marked paid in here, whole, so
    that nothing was lost: whoever did pay those people says so once and the
    wage goes back into Expenses on the same day, by the same method.
    """

    __tablename__ = "payroll_parked_wages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    payroll_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payroll.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("expense_categories.id", ondelete="SET NULL")
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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
    #: How much of `amount` has actually come back out of a payslip.
    #:
    #: An advance is not all-or-nothing, and pretending it was produced a
    #: -£3,500 payslip marked PAID. If somebody owes £3,500 and earns £400 this
    #: period, £400 is recovered and £3,100 is still owed. Without this column
    #: the run had exactly two options, and both lose money: pay a negative net
    #: (the live bug), or floor the net at zero and mark the advance recovered,
    #: which forgives £3,100 of the restaurant's money with no record of it.
    amount_recovered: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
    #: True only when `amount_recovered >= amount`. Kept as a column rather than
    #: computed because it is what the "pending advances" query filters on, and
    #: that query runs for every employee in every run.
    is_deducted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
