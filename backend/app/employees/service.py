"""Employee & attendance service. Hotel-scoped, with UK visa-expiry alerts."""
import uuid
from datetime import UTC, datetime
from datetime import date as date_type
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.models import (
    Attendance,
    AttendanceStatus,
    Employee,
    PunchType,
)

_Q2 = Decimal("0.01")


class PunchError(ValueError):
    """Invalid attendance punch sequence."""


def working_hours(clock_in: datetime, clock_out: datetime, break_minutes: int) -> Decimal:
    """(clock_out − clock_in) − break, in hours (never negative)."""
    seconds = (clock_out - clock_in).total_seconds() - break_minutes * 60
    hours = Decimal(max(seconds, 0)) / Decimal(3600)
    return hours.quantize(_Q2, ROUND_HALF_UP)


# ── Employees ─────────────────────────────────────────────────────────────
async def next_employee_code(db: AsyncSession, hotel_id: uuid.UUID) -> str:
    count = await db.scalar(
        select(func.count()).select_from(Employee).where(Employee.hotel_id == hotel_id)
    )
    return f"EMP{(count or 0) + 1:03d}"


async def create_employee(db: AsyncSession, hotel_id: uuid.UUID, **fields) -> Employee:
    code = await next_employee_code(db, hotel_id)
    emp = Employee(hotel_id=hotel_id, employee_code=code, **fields)
    db.add(emp)
    await db.commit()
    await db.refresh(emp)
    return emp


async def get_employee(
    db: AsyncSession, employee_id: uuid.UUID, hotel_id: uuid.UUID
) -> Employee | None:
    emp = await db.get(Employee, employee_id)
    if emp is None or emp.hotel_id != hotel_id:
        return None
    return emp


async def list_employees(
    db: AsyncSession, hotel_id: uuid.UUID, *, active_only: bool = True
) -> list[Employee]:
    stmt = select(Employee).where(Employee.hotel_id == hotel_id)
    if active_only:
        stmt = stmt.where(Employee.is_active.is_(True))
    result = await db.execute(stmt.order_by(Employee.full_name))
    return list(result.scalars().all())


async def update_employee(db: AsyncSession, emp: Employee, **fields) -> Employee:
    for k, v in fields.items():
        if v is not None:
            setattr(emp, k, v)
    await db.commit()
    await db.refresh(emp)
    return emp


async def visa_alerts(
    db: AsyncSession, hotel_id: uuid.UUID, within_days: int = 60
) -> list[dict]:
    """Active employees whose visa expires within `within_days` (or already expired)."""
    today = date_type.today()
    result = await db.execute(
        select(Employee).where(
            Employee.hotel_id == hotel_id,
            Employee.is_active.is_(True),
            Employee.visa_expiry_date.is_not(None),
        )
    )
    out = []
    for e in result.scalars().all():
        days_left = (e.visa_expiry_date - today).days
        if days_left <= within_days:
            out.append(
                {
                    "employee_id": e.id,
                    "full_name": e.full_name,
                    "visa_expiry_date": e.visa_expiry_date,
                    "days_left": days_left,
                }
            )
    return sorted(out, key=lambda r: r["days_left"])


# ── Attendance ────────────────────────────────────────────────────────────
async def _today_attendance(
    db: AsyncSession, employee: Employee, day: date_type
) -> Attendance | None:
    result = await db.execute(
        select(Attendance).where(
            Attendance.employee_id == employee.id, Attendance.date == day
        )
    )
    return result.scalar_one_or_none()


async def punch(db: AsyncSession, employee: Employee, ptype: str) -> Attendance:
    now = datetime.now(UTC)
    day = now.date()
    rec = await _today_attendance(db, employee, day)

    if ptype == PunchType.CLOCK_IN.value:
        if rec and rec.clock_in:
            raise PunchError("Already clocked in today")
        if rec is None:
            rec = Attendance(hotel_id=employee.hotel_id, employee_id=employee.id, date=day)
            db.add(rec)
        rec.clock_in = now
        rec.status = AttendanceStatus.PRESENT.value
    elif ptype == PunchType.BREAK_START.value:
        if not rec or not rec.clock_in:
            raise PunchError("Must clock in first")
        rec.break_start = now
    elif ptype == PunchType.BREAK_END.value:
        if not rec or not rec.break_start:
            raise PunchError("Break not started")
        rec.break_minutes += int((now - rec.break_start).total_seconds() // 60)
        rec.break_start = None
    elif ptype == PunchType.CLOCK_OUT.value:
        if not rec or not rec.clock_in:
            raise PunchError("Not clocked in")
        rec.clock_out = now
        rec.working_hours = working_hours(rec.clock_in, now, rec.break_minutes)

    await db.commit()
    await db.refresh(rec)
    return rec


async def set_attendance(
    db: AsyncSession,
    employee: Employee,
    day: date_type,
    *,
    status: str,
    working_hours_value: Decimal | None = None,
    notes: str | None = None,
) -> Attendance:
    rec = await _today_attendance(db, employee, day)
    if rec is None:
        rec = Attendance(hotel_id=employee.hotel_id, employee_id=employee.id, date=day)
        db.add(rec)
    rec.status = status
    if working_hours_value is not None:
        rec.working_hours = working_hours_value
    if notes is not None:
        rec.notes = notes
    await db.commit()
    await db.refresh(rec)
    return rec


async def list_attendance(db: AsyncSession, hotel_id: uuid.UUID, day: date_type) -> list[dict]:
    rows = await db.execute(
        select(Attendance, Employee)
        .join(Employee, Attendance.employee_id == Employee.id)
        .where(Attendance.hotel_id == hotel_id, Attendance.date == day)
        .order_by(Employee.full_name)
    )
    return [
        {
            "employee_id": e.id,
            "employee_name": e.full_name,
            "date": a.date,
            "clock_in": a.clock_in,
            "clock_out": a.clock_out,
            "working_hours": a.working_hours,
            "status": a.status,
            "on_break": a.break_start is not None,
        }
        for a, e in rows.all()
    ]
