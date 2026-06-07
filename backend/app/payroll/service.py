"""Payroll service: gather attendance, process a pay run, advances, payslip PDF."""
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.models import Attendance, AttendanceStatus, Employee, SalaryType
from app.payroll import calculator
from app.payroll.models import Payroll, PayrollStatus, SalaryAdvance


def month_range(period: str) -> tuple[date, date]:
    """'2026-06' -> (2026-06-01, 2026-06-30)."""
    year, month = (int(p) for p in period.split("-"))
    start = date(year, month, 1)
    nxt = date(year + (month == 12), (month % 12) + 1, 1)
    return start, nxt - timedelta(days=1)


async def _attendance_stats(db, employee_id: uuid.UUID, start: date, end: date) -> dict:
    rows = await db.execute(
        select(Attendance).where(
            Attendance.employee_id == employee_id,
            Attendance.date >= start,
            Attendance.date <= end,
        )
    )
    days_present = half_days = 0
    total_hours = overtime = Decimal("0")
    for a in rows.scalars().all():
        if a.status == AttendanceStatus.PRESENT.value:
            days_present += 1
        elif a.status == AttendanceStatus.HALF_DAY.value:
            half_days += 1
        if a.working_hours:
            total_hours += a.working_hours
            if a.working_hours > calculator.STANDARD_DAY_HOURS:
                overtime += a.working_hours - calculator.STANDARD_DAY_HOURS
    return {
        "days_present": days_present,
        "half_days": half_days,
        "total_hours": total_hours,
        "overtime_hours": overtime,
    }


# ── Advances ────────────────────────────────────────────────────────────────
async def create_advance(db: AsyncSession, hotel_id: uuid.UUID, **fields) -> SalaryAdvance:
    adv = SalaryAdvance(hotel_id=hotel_id, **fields)
    db.add(adv)
    await db.commit()
    await db.refresh(adv)
    return adv


async def list_advances(
    db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID | None = None
):
    stmt = select(SalaryAdvance).where(SalaryAdvance.hotel_id == hotel_id)
    if employee_id:
        stmt = stmt.where(SalaryAdvance.employee_id == employee_id)
    result = await db.execute(stmt.order_by(SalaryAdvance.given_date.desc()))
    return list(result.scalars().all())


# ── Process a pay run ─────────────────────────────────────────────────────────
async def process_payroll(
    db: AsyncSession,
    employee: Employee,
    pay_period: str,
    *,
    working_days: int = 26,
    other_deductions: Decimal = Decimal("0"),
    processed_by: uuid.UUID | None = None,
) -> Payroll:
    start, end = month_range(pay_period)
    stats = await _attendance_stats(db, employee.id, start, end)

    # Pending advances for this period
    adv_rows = await db.execute(
        select(SalaryAdvance).where(
            SalaryAdvance.employee_id == employee.id,
            SalaryAdvance.deduct_period == pay_period,
            SalaryAdvance.is_deducted.is_(False),
        )
    )
    advances = list(adv_rows.scalars().all())
    advance_total = sum((a.amount for a in advances), Decimal("0"))

    if employee.salary_type == SalaryType.HOURLY.value:
        calc = calculator.calc_hourly(
            hourly_rate=employee.hourly_rate or Decimal("0"),
            total_hours=stats["total_hours"],
            advance=advance_total,
            other_deductions=other_deductions,
        )
    else:
        calc = calculator.calc_monthly(
            monthly_salary=employee.monthly_salary or Decimal("0"),
            working_days=working_days,
            days_present=stats["days_present"],
            half_days=stats["half_days"],
            overtime_hours=stats["overtime_hours"],
            advance=advance_total,
            other_deductions=other_deductions,
        )

    # Upsert the payroll row for this employee+period
    existing = await db.execute(
        select(Payroll).where(
            Payroll.employee_id == employee.id, Payroll.pay_period == pay_period
        )
    )
    rec = existing.scalar_one_or_none()
    if rec is None:
        rec = Payroll(hotel_id=employee.hotel_id, employee_id=employee.id, pay_period=pay_period)
        db.add(rec)

    rec.pay_period_type = employee.salary_type
    rec.working_days = working_days
    rec.days_present = stats["days_present"]
    rec.half_days = stats["half_days"]
    rec.total_hours = stats["total_hours"]
    rec.gross_pay = calc["gross_pay"]
    rec.overtime_pay = calc["overtime_pay"]
    rec.advance_deduction = calc["advance_deduction"]
    rec.other_deductions = calc["other_deductions"]
    rec.net_pay = calc["net_pay"]
    rec.status = PayrollStatus.DRAFT.value
    rec.processed_by = processed_by
    rec.processed_at = datetime.now(UTC)

    for a in advances:
        a.is_deducted = True

    await db.commit()
    await db.refresh(rec)
    return rec


async def get_payroll(
    db: AsyncSession, payroll_id: uuid.UUID, hotel_id: uuid.UUID
) -> Payroll | None:
    rec = await db.get(Payroll, payroll_id)
    if rec is None or rec.hotel_id != hotel_id:
        return None
    return rec


async def list_payroll(db: AsyncSession, hotel_id: uuid.UUID, pay_period: str) -> list[dict]:
    rows = await db.execute(
        select(Payroll, Employee)
        .join(Employee, Payroll.employee_id == Employee.id)
        .where(Payroll.hotel_id == hotel_id, Payroll.pay_period == pay_period)
        .order_by(Employee.full_name)
    )
    return [
        {
            "id": p.id,
            "employee_id": p.employee_id,
            "employee_name": e.full_name,
            "pay_period": p.pay_period,
            "gross_pay": p.gross_pay,
            "overtime_pay": p.overtime_pay,
            "advance_deduction": p.advance_deduction,
            "other_deductions": p.other_deductions,
            "net_pay": p.net_pay,
            "status": p.status,
        }
        for p, e in rows.all()
    ]


async def set_status(db: AsyncSession, rec: Payroll, status: str) -> Payroll:
    rec.status = status
    await db.commit()
    await db.refresh(rec)
    return rec
