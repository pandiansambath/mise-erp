"""Employee & attendance endpoints. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.employees import leave as leave_service
from app.employees import service, timesheet
from app.employees.models import Employee, Leave, LeaveStatus
from app.employees.schemas import (
    AttendanceEdit,
    AttendanceOut,
    AttendanceRow,
    AttendanceSet,
    EmployeeAccountIn,
    EmployeeCreate,
    EmployeeOut,
    EmployeeUpdate,
    LeaveCreate,
    PunchRequest,
    VisaAlert,
)
from app.hotels.models import Hotel

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

router = APIRouter(prefix="/employees", tags=["employees"])
attendance_router = APIRouter(prefix="/attendance", tags=["attendance"])


# ── Employees ─────────────────────────────────────────────────────────────
@router.get("", response_model=list[EmployeeOut])
async def list_employees(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[EmployeeOut]:
    emps = await service.list_employees(db, user.hotel_id)
    return [EmployeeOut.model_validate(e) for e in emps]


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> EmployeeOut:
    emp = await service.create_employee(db, user.hotel_id, **payload.model_dump(exclude_none=True))
    return EmployeeOut.model_validate(emp)


@router.get("/visa-alerts", response_model=list[VisaAlert])
async def visa_alerts(
    within_days: int = Query(default=60, ge=0, le=365),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[VisaAlert]:
    alerts = await service.visa_alerts(db, user.hotel_id, within_days)
    return [VisaAlert.model_validate(a) for a in alerts]


@router.get("/{employee_id}", response_model=EmployeeOut)
async def get_employee(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> EmployeeOut:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return EmployeeOut.model_validate(emp)


@router.patch("/{employee_id}", response_model=EmployeeOut)
async def update_employee(
    employee_id: uuid.UUID,
    payload: EmployeeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> EmployeeOut:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    emp = await service.update_employee(db, emp, **payload.model_dump(exclude_unset=True))
    return EmployeeOut.model_validate(emp)


@router.post("/{employee_id}/account", response_model=EmployeeOut)
async def create_employee_account(
    employee_id: uuid.UUID,
    payload: EmployeeAccountIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> EmployeeOut:
    """Create a login for this employee so they can sign in (self-service)."""
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        emp = await service.create_account_for_employee(
            db, emp, email=payload.email, password=payload.password, role=payload.role
        )
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="staff.account_created",
        summary=f"Login created for {emp.full_name} ({payload.email}) — verification sent",
        entity_type="employee", entity_id=emp.id,
    )
    return EmployeeOut.model_validate(emp)


# ── Staff-login management (superadmin/manager) + strict email verification ──
class StaffEmailIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class StaffPasswordIn(BaseModel):
    password: str = Field(min_length=8, max_length=128)


class StaffActiveIn(BaseModel):
    is_active: bool


@router.get("/{employee_id}/login")
async def staff_login(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> dict:
    """The linked login's email + verified/active state (drives the admin chips)."""
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return {"login": await service.staff_login_status(db, emp)}


@router.post("/{employee_id}/login/email")
async def change_email(
    employee_id: uuid.UUID,
    payload: StaffEmailIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        await service.change_staff_email(db, emp, payload.email)
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="staff.email_changed",
        summary=f"Email for {emp.full_name} changed to {payload.email} — re-verification sent",
        entity_type="employee", entity_id=emp.id,
    )
    return {"login": await service.staff_login_status(db, emp)}


@router.post("/{employee_id}/login/password")
async def reset_password(
    employee_id: uuid.UUID,
    payload: StaffPasswordIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        await service.reset_staff_password(db, emp, payload.password)
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="staff.password_reset",
        summary=f"Password reset for {emp.full_name} by admin — staff notified by email",
        entity_type="employee", entity_id=emp.id,
    )
    return {"ok": True}


@router.post("/{employee_id}/login/active")
async def set_active(
    employee_id: uuid.UUID,
    payload: StaffActiveIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        await service.set_staff_active(db, emp, payload.is_active)
    except service.AccountError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    verb = "reactivated" if payload.is_active else "deactivated"
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action=f"staff.{verb}",
        summary=f"Login for {emp.full_name} {verb}",
        entity_type="employee", entity_id=emp.id,
    )
    return {"login": await service.staff_login_status(db, emp)}


@router.post("/{employee_id}/login/resend-verification")
async def resend_verification(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None or not emp.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No login for this employee")
    from app.auth.models import User as UserModel

    u = await db.get(UserModel, emp.user_id)
    if u.email_verified:
        return {"already_verified": True}
    await service._mark_unverified_and_email(db, u, hotel_name=None)
    await db.commit()
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="staff.verification_resent",
        summary=f"Verification email resent to {emp.full_name}",
        entity_type="employee", entity_id=emp.id,
    )
    return {"sent": True}


@router.get("/{employee_id}/history")
async def employee_history(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> dict:
    """The admin action timeline for this employee (added, email set, verified,
    password reset, (de)activated…) — a clean audit story on the Employees page."""
    emp = await service.get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    events = await audit.list_for_entity(db, user.hotel_id, "employee", employee_id)
    return {
        "events": [
            {
                "action": e.action,
                "summary": e.summary,
                "by": e.user_email,
                "at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in events
        ]
    }


# ── Attendance ────────────────────────────────────────────────────────────
@attendance_router.get("", response_model=list[AttendanceRow])
async def list_attendance(
    on: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> list[AttendanceRow]:
    day = on or date_type.today()
    rows = await service.list_attendance(db, user.hotel_id, day)

    # Someone on booked leave is not "absent" in the sense that needs chasing.
    # Without this the attendance sheet reads the same for a person on holiday
    # and a person who simply did not turn up, which is the distinction the
    # manager actually cares about at 09:00.
    off = await leave_service.employee_ids_off(db, user.hotel_id, day)
    out = []
    for r in rows:
        if r["employee_id"] in off:
            r = {**r, "status": "LEAVE", "no_punch": False, "on_leave": True}
        out.append(AttendanceRow.model_validate(r))
    return out


@attendance_router.get("/timesheet.pdf")
async def timesheet_pdf(
    on: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> Response:
    day = on or date_type.today()
    rows = await service.list_attendance(db, user.hotel_id, day)
    hotel = await db.get(Hotel, user.hotel_id)
    pdf = timesheet.generate_timesheet_pdf(rows, hotel, day)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="timesheet-{day}.pdf"'},
    )


@attendance_router.get("/timesheet.xlsx")
async def timesheet_xlsx(
    on: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> Response:
    day = on or date_type.today()
    rows = await service.list_attendance(db, user.hotel_id, day)
    hotel = await db.get(Hotel, user.hotel_id)
    xlsx = timesheet.generate_timesheet_xlsx(rows, hotel, day)
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="timesheet-{day}.xlsx"'},
    )


@attendance_router.get("/history/{employee_id}")
async def attendance_history(
    employee_id: uuid.UUID,
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> dict:
    """One person, ANY range — full timeline + totals + indicative pay."""
    out = await service.attendance_history(db, user.hotel_id, employee_id, date_from, date_to)
    if not out:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    return out


@attendance_router.get("/range.xlsx")
async def attendance_range_xlsx(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> Response:
    """The download: everyone (or one person) across any date range."""
    rows = await service.list_attendance_range(db, user.hotel_id, date_from, date_to)
    if employee_id:
        rows = [r for r in rows if str(r.get("employee_id")) == str(employee_id)]
    hotel = await db.get(Hotel, user.hotel_id)
    xlsx = timesheet.generate_range_xlsx(rows, hotel, date_from, date_to)
    return Response(
        content=xlsx,
        media_type=XLSX_MIME,
        headers={"Content-Disposition":
                 f'attachment; filename="attendance-{date_from}-to-{date_to}.xlsx"'},
    )


@attendance_router.post("/punch", response_model=AttendanceOut)
async def punch(
    payload: PunchRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:write")),
) -> AttendanceOut:
    emp = await service.get_employee(db, payload.employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    try:
        rec = await service.punch(db, emp, payload.type)
    except service.PunchError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return AttendanceOut.model_validate(rec)


@attendance_router.post("", response_model=AttendanceOut, status_code=status.HTTP_201_CREATED)
async def set_attendance(
    payload: AttendanceSet,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:write")),
) -> AttendanceOut:
    emp = await service.get_employee(db, payload.employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    rec = await service.set_attendance(
        db, emp, payload.date, status=payload.status,
        working_hours_value=payload.working_hours, notes=payload.notes,
    )
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="attendance.set",
        summary=f"Attendance: {emp.full_name} {payload.date} = {payload.status}",
        entity_type="attendance", entity_id=rec.id,
    )
    return AttendanceOut.model_validate(rec)


@attendance_router.post("/edit", response_model=AttendanceOut)
async def edit_attendance(
    payload: AttendanceEdit,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:write")),
) -> AttendanceOut:
    """Manually set/fix clock in/out for any date (incl. back-dated) — for
    missed punches. Times are in the hotel's local time; stored as UTC."""
    emp = await service.get_employee(db, payload.employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    hotel = await db.get(Hotel, user.hotel_id)
    rec = await service.edit_attendance(
        db, emp, payload.date, hotel.country if hotel else None,
        clock_in=payload.clock_in, clock_out=payload.clock_out,
        break_minutes=payload.break_minutes,
    )
    return AttendanceOut.model_validate(rec)


# ── Leave ───────────────────────────────────────────────────────────────────
# Time off as a RANGE, so "is anybody off next Tuesday?" is one question rather
# than seven. The rota consults this before scheduling; attendance consults it
# before calling somebody absent.


@router.get("/leave/list")
async def list_leave(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[dict]:
    """Leave overlapping a window, soonest first."""
    q = select(Leave, Employee).join(Employee, Leave.employee_id == Employee.id).where(
        Leave.hotel_id == user.hotel_id
    )
    # Overlap, not containment: leave that STARTED before the window but runs
    # into it is exactly the leave you need to see.
    if date_from:
        q = q.where(Leave.end_date >= date_from)
    if date_to:
        q = q.where(Leave.start_date <= date_to)
    rows = await db.execute(q.order_by(Leave.start_date))
    return [
        {
            "id": str(lv.id),
            "employee_id": str(lv.employee_id),
            "employee_name": emp.full_name,
            "start_date": lv.start_date.isoformat(),
            "end_date": lv.end_date.isoformat(),
            "days": (lv.end_date - lv.start_date).days + 1,
            "kind": lv.kind,
            "status": lv.status,
            "reason": lv.reason,
        }
        for lv, emp in rows.all()
    ]


@router.post("/leave", status_code=status.HTTP_201_CREATED)
async def create_leave(
    payload: LeaveCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Book time off, and say if it collides with shifts already rota'd.

    A collision does NOT block the booking — plans change, and the leave is the
    newer decision. But it must be SAID, or the rota keeps showing somebody who
    is on holiday and nobody finds out until the day.
    """
    if payload.end_date < payload.start_date:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The end date is before the start date.")

    employee = await db.get(Employee, payload.employee_id)
    if employee is None or employee.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    clashes = await leave_service.shifts_clashing(
        db, user.hotel_id, payload.employee_id, payload.start_date, payload.end_date
    )

    row = Leave(
        hotel_id=user.hotel_id,
        employee_id=payload.employee_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        kind=payload.kind,
        status=payload.status,
        reason=payload.reason,
        approved_by=user.id if payload.status == LeaveStatus.APPROVED.value else None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return {
        "id": str(row.id),
        "clashing_shifts": [
            {"id": str(sh.id), "date": sh.date.isoformat()} for sh in clashes
        ],
        "warning": (
            f"{employee.full_name} is already rota'd on "
            f"{', '.join(sh.date.isoformat() for sh in clashes)}. "
            "Remove those shifts, or the rota will still show them working."
            if clashes
            else None
        ),
    }


@router.delete("/leave/{leave_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_leave(
    leave_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> Response:
    row = await db.get(Leave, leave_id)
    if row is None or row.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such leave")
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
