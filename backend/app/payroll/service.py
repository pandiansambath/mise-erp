"""Payroll service: gather attendance, process a pay run, advances, payslip PDF."""
import re
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.models import Attendance, AttendanceStatus, Employee, SalaryType
from app.payroll import calculator
from app.payroll.models import Payroll, PayrollStatus, SalaryAdvance

_WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")


def is_weekly(period: str) -> bool:
    """'2026-W28' → True; '2026-06' → False."""
    return bool(_WEEK_RE.match(period))


def period_range(period: str) -> tuple[date, date]:
    """'2026-06' → calendar month; '2026-W28' → ISO week (Mon–Sun)."""
    m = _WEEK_RE.match(period)
    if m:
        start = date.fromisocalendar(int(m[1]), int(m[2]), 1)
        return start, start + timedelta(days=6)
    year, month = (int(p) for p in period.split("-"))
    start = date(year, month, 1)
    nxt = date(year + (month == 12), (month % 12) + 1, 1)
    return start, nxt - timedelta(days=1)


# kept for existing imports/tests
month_range = period_range

_CUSTOM_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})→(\d{4}-\d{2}-\d{2})$")


class AlreadyPaidError(ValueError):
    """This employee already has pay covering (part of) the requested dates."""


def custom_label(start: date, end: date) -> str:
    return f"{start.isoformat()}→{end.isoformat()}"


def record_range(rec: Payroll) -> tuple[date, date]:
    """The exact dates a payroll row covers (stored, or derived from its label)."""
    if rec.period_start and rec.period_end:
        return rec.period_start, rec.period_end
    m = _CUSTOM_RE.match(rec.pay_period)
    if m:
        return date.fromisoformat(m[1]), date.fromisoformat(m[2])
    return period_range(rec.pay_period)


async def find_overlaps(
    db: AsyncSession,
    employee_id: uuid.UUID,
    start: date,
    end: date,
    *,
    exclude_period: str | None = None,
) -> list[Payroll]:
    """Existing pay runs for this employee that intersect [start, end]. Re-running
    the SAME period is fine (it upserts) — that one is excluded."""
    rows = await db.execute(select(Payroll).where(Payroll.employee_id == employee_id))
    hits = []
    for rec in rows.scalars().all():
        if exclude_period and rec.pay_period == exclude_period:
            continue
        r_start, r_end = record_range(rec)
        if r_start <= end and start <= r_end:
            hits.append(rec)
    return hits


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
async def _resolve_run(
    employee: Employee, pay_period: str | None, date_from: date | None, date_to: date | None
) -> tuple[str, date, date]:
    """Validate the requested run and return (label, start, end).

    THE RULE (kills double-pay): hourly staff are paid by weekly or custom runs;
    monthly-salaried staff by monthly or custom runs. Nobody can land in both."""
    if date_from and date_to:
        if date_to < date_from:
            raise ValueError("The pay range ends before it starts")
        if (date_to - date_from).days > 62:
            raise ValueError("A custom pay range can cover at most 2 months")
        return custom_label(date_from, date_to), date_from, date_to
    if not pay_period:
        raise ValueError("Pick a month, a week, or a custom date range")
    weekly = is_weekly(pay_period)
    if weekly and employee.salary_type != SalaryType.HOURLY.value:
        raise ValueError(
            f"{employee.full_name} is on a monthly salary — weekly runs are for "
            "hourly-paid staff. Run their month (or a custom range) instead."
        )
    if not weekly and employee.salary_type == SalaryType.HOURLY.value:
        raise ValueError(
            f"{employee.full_name} is weekly-paid (hourly rate) — run their week "
            "or a custom date range instead, so they can't be paid twice."
        )
    start, end = period_range(pay_period)
    return pay_period, start, end


async def process_payroll(
    db: AsyncSession,
    employee: Employee,
    pay_period: str | None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    working_days: int = 26,
    other_deductions: Decimal = Decimal("0"),
    processed_by: uuid.UUID | None = None,
    min_wage: Decimal = calculator.MIN_WAGE_UK,
) -> Payroll:
    label, start, end = await _resolve_run(employee, pay_period, date_from, date_to)
    weekly = is_weekly(label)
    overlaps = await find_overlaps(db, employee.id, start, end, exclude_period=label)
    if overlaps:
        clash = ", ".join(
            f"{o.pay_period} ({o.status.lower()}, £{o.net_pay})" for o in overlaps[:3]
        )
        raise AlreadyPaidError(
            f"{employee.full_name} already has pay covering these dates: {clash}. "
            "Running again would pay them twice."
        )
    pay_period = label
    stats = await _attendance_stats(db, employee.id, start, end)

    # Pending advances for this period. A weekly run also picks up advances
    # scheduled for the month the week ends in — "deduct from their next pay".
    periods = {pay_period}
    if weekly:
        periods.add(f"{end.year:04d}-{end.month:02d}")
    adv_rows = await db.execute(
        select(SalaryAdvance).where(
            SalaryAdvance.employee_id == employee.id,
            SalaryAdvance.deduct_period.in_(periods),
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
            min_wage=min_wage,
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

    rec.pay_period_type = "WEEKLY" if weekly else "MONTHLY"
    rec.period_start = start
    rec.period_end = end
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


async def payroll_records(
    db: AsyncSession, hotel_id: uuid.UUID, pay_period: str
) -> list[tuple[Payroll, Employee]]:
    """(Payroll, Employee) ORM pairs for a period — used to build the consolidated PDF
    (needs the full record: days present, hours, etc., not the list dict)."""
    rows = await db.execute(
        select(Payroll, Employee)
        .join(Employee, Payroll.employee_id == Employee.id)
        .where(Payroll.hotel_id == hotel_id, Payroll.pay_period == pay_period)
        .order_by(Employee.full_name)
    )
    return [(p, e) for p, e in rows.all()]


async def approve_all(db: AsyncSession, hotel_id: uuid.UUID, pay_period: str) -> int:
    """Approve every DRAFT payslip in a period at once. Returns how many were approved."""
    res = await db.execute(
        update(Payroll)
        .where(
            Payroll.hotel_id == hotel_id,
            Payroll.pay_period == pay_period,
            Payroll.status == PayrollStatus.DRAFT.value,
        )
        .values(status=PayrollStatus.APPROVED.value)
    )
    await db.commit()
    # ONE-STOP: approved wages ARE an expense — book each into the money engine.
    for rec, emp in await payroll_records(db, hotel_id, pay_period):
        if rec.status == PayrollStatus.APPROVED.value:
            await post_salary_expense(db, rec, emp.full_name)
    return res.rowcount or 0


async def preview_payroll(
    db: AsyncSession,
    employee: Employee,
    pay_period: str | None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    working_days: int = 26,
    other_deductions: Decimal = Decimal("0"),
    min_wage: Decimal = calculator.MIN_WAGE_UK,
) -> dict:
    """The DRY RUN: everything a run would produce — days, hours, pay, and any
    already-paid clashes — without writing a thing. The UI shows this before
    the human commits."""
    label, start, end = await _resolve_run(employee, pay_period, date_from, date_to)
    stats = await _attendance_stats(db, employee.id, start, end)
    adv_rows = await db.execute(
        select(SalaryAdvance).where(
            SalaryAdvance.employee_id == employee.id,
            SalaryAdvance.is_deducted.is_(False),
        )
    )
    advance_total = sum((a.amount for a in adv_rows.scalars().all()), Decimal("0"))
    if employee.salary_type == SalaryType.HOURLY.value:
        calc = calculator.calc_hourly(
            hourly_rate=employee.hourly_rate or Decimal("0"),
            total_hours=stats["total_hours"],
            advance=advance_total,
            other_deductions=other_deductions,
            min_wage=min_wage,
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
    overlaps = await find_overlaps(db, employee.id, start, end, exclude_period=label)
    return {
        "employee_id": str(employee.id),
        "employee_name": employee.full_name,
        "salary_type": employee.salary_type,
        "pay_period": label,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "days_present": stats["days_present"],
        "half_days": stats["half_days"],
        "total_hours": str(stats["total_hours"]),
        "overtime_hours": str(stats["overtime_hours"]),
        "gross_pay": str(calc["gross_pay"]),
        "advance_deduction": str(calc["advance_deduction"]),
        "other_deductions": str(calc["other_deductions"]),
        "net_pay": str(calc["net_pay"]),
        "already_paid": [
            {
                "pay_period": o.pay_period,
                "status": o.status,
                "net_pay": str(o.net_pay),
                "period_start": record_range(o)[0].isoformat(),
                "period_end": record_range(o)[1].isoformat(),
            }
            for o in overlaps
        ],
    }


async def history(db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID) -> list[dict]:
    """Every pay run this person ever had, newest first — the persistent record."""
    rows = await db.execute(
        select(Payroll)
        .where(Payroll.hotel_id == hotel_id, Payroll.employee_id == employee_id)
        .order_by(Payroll.created_at.desc())
    )
    out = []
    for p in rows.scalars().all():
        r_start, r_end = record_range(p)
        out.append({
            "id": p.id,
            "pay_period": p.pay_period,
            "pay_period_type": p.pay_period_type,
            "period_start": r_start.isoformat(),
            "period_end": r_end.isoformat(),
            "days_present": p.days_present,
            "total_hours": p.total_hours,
            "gross_pay": p.gross_pay,
            "advance_deduction": p.advance_deduction,
            "other_deductions": p.other_deductions,
            "net_pay": p.net_pay,
            "status": p.status,
            "processed_at": p.processed_at.isoformat() if p.processed_at else None,
        })
    return out


async def history_records(
    db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID
) -> list[tuple[Payroll, Employee]]:
    """(Payroll, Employee) pairs of a person's whole history — feeds the
    consolidated statement PDF."""
    rows = await db.execute(
        select(Payroll, Employee)
        .join(Employee, Payroll.employee_id == Employee.id)
        .where(Payroll.hotel_id == hotel_id, Payroll.employee_id == employee_id)
        .order_by(Payroll.created_at)
    )
    return [(p, e) for p, e in rows.all()]


async def post_salary_expense(db: AsyncSession, rec: Payroll, employee_name: str) -> None:
    """Approved wages appear in Expenses automatically (category 'Staff Salaries').
    Idempotent: the payroll id rides in the description, so re-approving or
    approving twice can never double-book. Best-effort — never blocks approval."""
    from app.expenses.models import Expense, ExpenseCategory

    try:
        marker = f"[payroll:{rec.id}]"
        dup = await db.execute(
            select(Expense).where(
                Expense.hotel_id == rec.hotel_id, Expense.description.contains(marker)
            )
        )
        if dup.scalars().first():
            return
        cat = (
            await db.execute(
                select(ExpenseCategory).where(
                    ExpenseCategory.hotel_id == rec.hotel_id,
                    ExpenseCategory.name == "Staff Salaries",
                )
            )
        ).scalars().first()
        if cat is None:
            cat = ExpenseCategory(hotel_id=rec.hotel_id, name="Staff Salaries", kind="FIXED")
            db.add(cat)
            await db.flush()
        db.add(
            Expense(
                hotel_id=rec.hotel_id,
                category_id=cat.id,
                date=date.today(),
                amount=rec.net_pay,
                payment_method="BANK",
                description=f"Payroll {rec.pay_period} · {employee_name} {marker}",
            )
        )
        await db.commit()
    except Exception:  # noqa: BLE001 — the wage booking must never block approval
        await db.rollback()


async def remove_payroll(db: AsyncSession, rec: Payroll) -> None:
    """Safely delete a payroll record AND reverse its auto-posted salary expense
    (matched by the [payroll:{id}] marker) so the P&L never keeps a phantom cost.
    Works at any status — the escape hatch for a mistaken run."""
    from app.expenses.models import Expense

    marker = f"[payroll:{rec.id}]"
    for exp in (
        await db.execute(
            select(Expense).where(
                Expense.hotel_id == rec.hotel_id, Expense.description.contains(marker)
            )
        )
    ).scalars().all():
        await db.delete(exp)
    await db.delete(rec)
    await db.commit()


async def list_payroll_for_employee(
    db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID
) -> list[dict]:
    """All payslips for one employee, newest period first (for self-service)."""
    rows = await db.execute(
        select(Payroll, Employee)
        .join(Employee, Payroll.employee_id == Employee.id)
        .where(Payroll.hotel_id == hotel_id, Payroll.employee_id == employee_id)
        .order_by(Payroll.pay_period.desc())
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
