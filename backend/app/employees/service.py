"""Employee & attendance service. Hotel-scoped, with UK visa-expiry alerts."""
import uuid
from datetime import UTC, datetime, timedelta
from datetime import date as date_type
from decimal import ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.models import (
    Attendance,
    AttendanceStatus,
    Employee,
    PunchType,
)
from app.hotels.models import Hotel

_Q2 = Decimal("0.01")


class PunchError(ValueError):
    """Invalid attendance punch sequence."""


def working_hours(clock_in: datetime, clock_out: datetime, break_minutes: int) -> Decimal:
    """(clock_out − clock_in) − break, in hours (never negative)."""
    seconds = (clock_out - clock_in).total_seconds() - break_minutes * 60
    hours = Decimal(max(seconds, 0)) / Decimal(3600)
    return hours.quantize(_Q2, ROUND_HALF_UP)


def break_penalty(
    break_minutes: int, allowance_minutes: int, penalty_per_min: Decimal
) -> tuple[int, Decimal]:
    """Minutes over the allowance, and the money penalty for them. Pure."""
    over = max(0, break_minutes - allowance_minutes)
    penalty = (penalty_per_min * over).quantize(_Q2) if over else Decimal("0.00")
    return over, penalty


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


class AccountError(Exception):
    """Raised when a login cannot be created/attached to an employee."""


async def create_account_for_employee(
    db: AsyncSession, emp: Employee, *, email: str, password: str, role: str
) -> Employee:
    """Create a login (User) for this employee and link it. Hotel-scoped."""
    from app.auth import service as auth_service
    from app.auth.models import Role

    valid_roles = {r.value for r in Role}
    if role not in valid_roles:
        raise AccountError(f"role must be one of {sorted(valid_roles)}")
    if await auth_service.get_user_by_email(db, email) is not None:
        raise AccountError("That email already has an account")
    # Greet staff by their first name (from their employee record) on any device.
    first_name = (emp.full_name or "").strip().split(" ")[0] or None
    user = await auth_service.create_user(
        db, email=email, password=password, role=role, hotel_id=emp.hotel_id,
        preferred_name=first_name,
    )
    # STRICT EMAIL (2026-07-15): new staff logins must verify before they can
    # sign in — a mistyped address must never reach the app. Existing accounts
    # (created before this) stay grandfathered as verified.
    await _mark_unverified_and_email(db, user, hotel_name=None)
    emp.user_id = user.id
    await db.commit()
    await db.refresh(emp)
    return emp


async def _mark_unverified_and_email(db, user, hotel_name: str | None) -> None:
    """Flip a user to unverified, mint a token, and email the verify link."""
    import secrets as _secrets

    from app.core import notify
    from app.core.config import settings

    user.email_verified = False
    user.verify_token = _secrets.token_urlsafe(32)
    await db.flush()
    verify_url = f"{settings.app_base_url}/verify-email?token={user.verify_token}"
    await notify.send_email(
        user.email,
        "Confirm your email to access Mise \u2709\ufe0f",
        f"Your manager set up a Mise login for you. Confirm your email to sign in: {verify_url}",
        html=notify.render_email(
            badge="\u2709\ufe0f Verify your email",
            heading="One click to activate your Mise login",
            intro="Your manager created a Mise account for you. Confirm this is your "
            "email and you can sign in — this keeps payslips and alerts reaching the "
            "right inbox.",
            cta_label="Confirm email & activate",
            cta_url=verify_url,
            footnote="If you weren't expecting this, you can ignore it.",
        ),
    )


async def staff_login_status(db, emp: Employee) -> dict | None:
    """The linked login's email + verified + active state (for the admin UI)."""
    if not emp.user_id:
        return None
    from app.auth.models import User

    u = await db.get(User, emp.user_id)
    if u is None:
        return None
    return {
        "user_id": str(u.id),
        "email": u.email,
        "role": u.role,
        "email_verified": u.email_verified,
        "is_active": u.is_active,
        "last_login": u.last_login.isoformat() if u.last_login else None,
    }


async def change_staff_email(db, emp: Employee, new_email: str) -> None:
    """Admin changes a staff email → must re-verify; login blocked till they do."""
    from app.auth import service as auth_service
    from app.auth.models import User

    if not emp.user_id:
        raise AccountError("This employee has no login yet")
    existing = await auth_service.get_user_by_email(db, new_email)
    if existing and existing.id != emp.user_id:
        raise AccountError("That email already has an account")
    u = await db.get(User, emp.user_id)
    u.email = new_email.strip().lower()
    await _mark_unverified_and_email(db, u, hotel_name=None)
    await db.commit()


async def reset_staff_password(db, emp: Employee, new_password: str) -> None:
    """Admin sets a new password → notify the staff (never email the password)."""
    from app.auth.models import User
    from app.core import notify
    from app.core.config import settings
    from app.core.security import hash_password

    if not emp.user_id:
        raise AccountError("This employee has no login yet")
    u = await db.get(User, emp.user_id)
    u.password_hash = hash_password(new_password)
    await db.commit()
    await notify.send_email(
        u.email,
        "Your Mise password was changed \ud83d\udd11",
        "Your manager set a new password on your Mise account. Ask them for it, or "
        f"reset it yourself: {settings.app_base_url}/forgot-password",
        html=notify.render_email(
            badge="\ud83d\udd11 Password changed",
            heading="Your admin set a new password",
            intro="For your security we never email passwords \u2014 your manager will "
            "give you the new one directly. If this wasn't expected, secure your "
            "account with the button below.",
            cta_label="Reset my password",
            cta_url=f"{settings.app_base_url}/forgot-password",
            accent="#d97742",
        ),
    )


async def set_staff_active(db, emp: Employee, active: bool) -> None:
    from app.auth.models import User

    if not emp.user_id:
        raise AccountError("This employee has no login yet")
    u = await db.get(User, emp.user_id)
    u.is_active = active
    await db.commit()


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
        # Round to the nearest minute so a short (~1 min) break isn't floored to 0.
        rec.break_minutes += max(0, round((now - rec.break_start).total_seconds() / 60))
        rec.break_end = now
        rec.break_start = None
    elif ptype == PunchType.CLOCK_OUT.value:
        if not rec or not rec.clock_in:
            raise PunchError("Not clocked in")
        if rec.break_start:
            # Clocked out while still on break — close the break so it counts.
            rec.break_minutes += max(0, round((now - rec.break_start).total_seconds() / 60))
            rec.break_end = now
            rec.break_start = None
        rec.clock_out = now
        rec.working_hours = working_hours(rec.clock_in, now, rec.break_minutes)

    await db.commit()
    await db.refresh(rec)
    return rec


# Hotel region → IANA timezone (mirrors the frontend). Admin edits times in the
# hotel's local wall-clock; we store UTC.
_TZ_BY_COUNTRY = {
    "GB": "Europe/London", "IN": "Asia/Kolkata", "US": "America/New_York",
    "AE": "Asia/Dubai", "EU": "Europe/Paris",
}


def hotel_timezone(country: str | None) -> ZoneInfo:
    return ZoneInfo(_TZ_BY_COUNTRY.get((country or "").upper(), "Europe/London"))


def _local_hhmm_to_utc(day: date_type, hhmm: str, tz: ZoneInfo) -> datetime:
    hh, mm = hhmm.split(":")
    return datetime(day.year, day.month, day.day, int(hh), int(mm), tzinfo=tz).astimezone(UTC)


async def edit_attendance(
    db: AsyncSession,
    employee: Employee,
    day: date_type,
    country: str | None,
    *,
    clock_in: str | None,
    clock_out: str | None,
    break_minutes: int,
) -> Attendance:
    """Super-Admin manual edit/back-date: set clock in/out (entered as the
    hotel's local time, stored in UTC) for ANY date — fixes missed punches."""
    rec = await _today_attendance(db, employee, day)
    if rec is None:
        rec = Attendance(hotel_id=employee.hotel_id, employee_id=employee.id, date=day)
        db.add(rec)
    tz = hotel_timezone(country)
    ci = _local_hhmm_to_utc(day, clock_in, tz) if clock_in else None
    co = _local_hhmm_to_utc(day, clock_out, tz) if clock_out else None
    if ci and co and co <= ci:
        co += timedelta(days=1)  # closed past midnight — out belongs to the next day
    rec.clock_in = ci
    rec.clock_out = co
    rec.break_minutes = max(0, break_minutes)
    rec.break_start = None
    rec.break_end = None
    rec.working_hours = working_hours(ci, co, rec.break_minutes) if (ci and co) else None
    rec.status = AttendanceStatus.PRESENT.value if ci else AttendanceStatus.ABSENT.value
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


async def get_employee_for_user(
    db: AsyncSession, user_id: uuid.UUID, hotel_id: uuid.UUID
) -> Employee | None:
    """The Employee linked to a login (for self-service)."""
    res = await db.execute(
        select(Employee).where(Employee.user_id == user_id, Employee.hotel_id == hotel_id)
    )
    return res.scalar_one_or_none()


def _attendance_row(a: Attendance, e: Employee, allowance: int, ppm: Decimal) -> dict:
    over, penalty = break_penalty(a.break_minutes, allowance, ppm)
    return {
        "employee_id": e.id,
        "employee_name": e.full_name,
        "date": a.date,
        "clock_in": a.clock_in,
        "clock_out": a.clock_out,
        "break_end": a.break_end,
        "break_minutes": a.break_minutes,
        "working_hours": a.working_hours,
        "status": a.status,
        "on_break": a.break_start is not None,
        "over_break_minutes": over,
        "break_penalty": penalty,
    }


async def _break_policy(db: AsyncSession, hotel_id: uuid.UUID) -> tuple[int, Decimal]:
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        return 0, Decimal("0")
    return hotel.break_allowance_minutes, hotel.break_penalty_per_min


async def list_attendance_for_employee(
    db: AsyncSession, employee_id: uuid.UUID, *, limit: int = 90
) -> list[dict]:
    """Recent attendance rows for one employee, newest first (self-service)."""
    rows = await db.execute(
        select(Attendance, Employee)
        .join(Employee, Attendance.employee_id == Employee.id)
        .where(Attendance.employee_id == employee_id)
        .order_by(Attendance.date.desc())
        .limit(limit)
    )
    pairs = rows.all()
    allowance, ppm = (await _break_policy(db, pairs[0][1].hotel_id)) if pairs else (0, Decimal("0"))
    return [_attendance_row(a, e, allowance, ppm) for a, e in pairs]


async def attendance_history(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    employee_id: uuid.UUID,
    date_from: date_type,
    date_to: date_type,
) -> dict:
    """One person's attendance over ANY range + totals + an indicative pay figure
    (their rate × the recorded time — labelled indicative; real pay runs live in
    Payroll with its overlap guard)."""
    emp = await get_employee(db, employee_id, hotel_id)
    if emp is None:
        return {}
    allowance, ppm = await _break_policy(db, hotel_id)
    rows = await db.execute(
        select(Attendance, Employee)
        .join(Employee, Attendance.employee_id == Employee.id)
        .where(
            Attendance.employee_id == employee_id,
            Attendance.date >= date_from,
            Attendance.date <= date_to,
        )
        .order_by(Attendance.date.desc())
    )
    days = [_attendance_row(a, e, allowance, ppm) for a, e in rows.all()]
    present = sum(1 for d in days if d["status"] == "PRESENT")
    half = sum(1 for d in days if d["status"] == "HALF_DAY")
    absent = sum(1 for d in days if d["status"] == "ABSENT")
    total_hours = sum((Decimal(str(d["working_hours"] or 0)) for d in days), Decimal("0"))
    if emp.salary_type == "HOURLY" and emp.hourly_rate:
        indicative = (total_hours * emp.hourly_rate).quantize(Decimal("0.01"))
        basis = f"{total_hours}h × £{emp.hourly_rate}/h"
    elif emp.monthly_salary:
        daily = emp.monthly_salary / Decimal("26")
        indicative = (daily * (present + Decimal("0.5") * half)).quantize(Decimal("0.01"))
        basis = f"{present}d + {half}×half at £{daily.quantize(Decimal('0.01'))}/day (salary ÷ 26)"
    else:
        indicative, basis = Decimal("0"), "no rate set on the employee"
    return {
        "employee": {
            "id": str(emp.id), "name": emp.full_name, "salary_type": emp.salary_type,
            "pay_day": emp.pay_day, "pay_weekday": emp.pay_weekday,
        },
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "totals": {
            "present": present, "half_days": half, "absent": absent,
            "recorded_days": len(days), "total_hours": str(total_hours),
            "indicative_pay": str(indicative), "basis": basis,
        },
        "days": days,
    }


async def list_attendance_range(
    db: AsyncSession, hotel_id: uuid.UUID, date_from: date_type, date_to: date_type
) -> list[dict]:
    """Everyone's attendance across a range (for the range export)."""
    allowance, ppm = await _break_policy(db, hotel_id)
    rows = await db.execute(
        select(Attendance, Employee)
        .join(Employee, Attendance.employee_id == Employee.id)
        .where(
            Attendance.hotel_id == hotel_id,
            Attendance.date >= date_from,
            Attendance.date <= date_to,
        )
        .order_by(Attendance.date, Employee.full_name)
    )
    return [_attendance_row(a, e, allowance, ppm) for a, e in rows.all()]


async def list_attendance(db: AsyncSession, hotel_id: uuid.UUID, day: date_type) -> list[dict]:
    allowance, ppm = await _break_policy(db, hotel_id)
    rows = await db.execute(
        select(Attendance, Employee)
        .join(Employee, Attendance.employee_id == Employee.id)
        .where(Attendance.hotel_id == hotel_id, Attendance.date == day)
        .order_by(Employee.full_name)
    )
    return [_attendance_row(a, e, allowance, ppm) for a, e in rows.all()]
