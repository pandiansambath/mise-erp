"""Employee & attendance endpoints. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.employees import service, timesheet
from app.employees.schemas import (
    AttendanceOut,
    AttendanceRow,
    AttendanceSet,
    EmployeeAccountIn,
    EmployeeCreate,
    EmployeeOut,
    EmployeeUpdate,
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
    return EmployeeOut.model_validate(emp)


# ── Attendance ────────────────────────────────────────────────────────────
@attendance_router.get("", response_model=list[AttendanceRow])
async def list_attendance(
    on: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("attendance:read")),
) -> list[AttendanceRow]:
    day = on or date_type.today()
    rows = await service.list_attendance(db, user.hotel_id, day)
    return [AttendanceRow.model_validate(r) for r in rows]


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
    return AttendanceOut.model_validate(rec)
