"""Rota endpoints: shifts + labour summary. Hotel-scoped."""
import uuid
from datetime import date as date_type
from datetime import time as time_type
from datetime import timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core import template_io
from app.core.database import get_db
from app.core.template_io import Column, TemplateSpec
from app.hotels.models import Hotel
from app.rota import export, service
from app.rota.schemas import LabourSummary, ShiftCreate, ShiftOut

router = APIRouter(prefix="/rota", tags=["rota"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

# Strict rota template — Employee/Date/Start/End required; Break + Notes optional.
ROTA_TEMPLATE = TemplateSpec(
    name="Rota",
    subtitle="One row per shift. Employee, Date, Start and End are required (*).",
    columns=[
        Column("employee", "Employee", required=True, aliases=("name", "staff")),
        Column("date", "Date", required=True, kind="date"),
        Column("start", "Start", required=True, kind="time", aliases=("start time", "from")),
        Column("end", "End", required=True, kind="time", aliases=("end time", "to")),
        Column("break_minutes", "Break (min)", kind="number", aliases=("break", "break minutes")),
        Column("notes", "Notes"),
    ],
    sample_rows=[["Staff full name", "2026-06-30", "09:00", "17:00", 30, "(optional)"]],
)


def _xlsx(content: bytes, filename: str) -> Response:
    return Response(
        content=content,
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _week(date_from: date_type | None, date_to: date_type | None) -> tuple[date_type, date_type]:
    """The week to template. Defaults to the current Mon–Sun if not supplied."""
    if date_from and date_to:
        return date_from, date_to
    today = date_type.today()
    monday = today - timedelta(days=today.weekday())
    return monday, monday + timedelta(days=6)


async def _emp_rows(db: AsyncSession, hotel_id: uuid.UUID) -> list[tuple[str, str, str]]:
    """(full name, code, job title) for every employee, sorted by name — the rows of
    the grid template so the owner just fills cells against real staff."""
    emps = await service._employees(db, hotel_id)
    return sorted(
        ((e.full_name, e.employee_code or "", e.job_title or "") for e in emps.values()),
        key=lambda r: r[0].lower(),
    )


@router.post("/shifts", response_model=ShiftOut, status_code=status.HTTP_201_CREATED)
async def create_shift(
    payload: ShiftCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> ShiftOut:
    await service.create_shift(db, user.hotel_id, **payload.model_dump())
    # re-read via list so the response carries employee_name + computed hours/cost
    rows = await service.list_shifts(db, user.hotel_id, payload.date, payload.date)
    row = rows[-1]
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="shift.add",
        summary=f"Shift: {row['employee_name']} {payload.date} "
                f"{payload.start_time}-{payload.end_time}",
        entity_type="shift", entity_id=row["id"],
    )
    return ShiftOut.model_validate(row)


@router.get("/shifts", response_model=list[ShiftOut])
async def list_shifts(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[ShiftOut]:
    rows = await service.list_shifts(db, user.hotel_id, date_from, date_to)
    return [ShiftOut.model_validate(r) for r in rows]


class ShiftPatch(BaseModel):
    start_time: time_type | None = None
    end_time: time_type | None = None
    break_minutes: int | None = Field(default=None, ge=0, le=480)
    notes: str | None = Field(default=None, max_length=120)


@router.patch("/shifts/{shift_id}", response_model=ShiftOut)
async def update_shift(
    shift_id: uuid.UUID,
    payload: ShiftPatch,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> ShiftOut:
    """Edit a shift IN PLACE (times/break/notes) — no more delete-and-re-add."""
    sh = await service.get_shift(db, shift_id, user.hotel_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shift not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(sh, k, v)
    if sh.end_time <= sh.start_time:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "End must be after start")
    await db.commit()
    rows = await service.list_shifts(db, user.hotel_id, sh.date, sh.date)
    row = next(r for r in rows if str(r["id"]) == str(shift_id))
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="shift.edit",
        summary=f"Shift edited: {row['employee_name']} {sh.date} "
                f"{sh.start_time}-{sh.end_time}",
        entity_type="shift", entity_id=shift_id,
    )
    return ShiftOut.model_validate(row)


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift(
    shift_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> None:
    sh = await service.get_shift(db, shift_id, user.hotel_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shift not found")
    when = sh.date
    await service.delete_shift(db, sh)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="shift.delete",
        summary=f"Deleted a shift on {when}",
        entity_type="shift", entity_id=shift_id,
    )


@router.get("/export.xlsx")
async def export_rota_xlsx(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> Response:
    shifts = await service.list_shifts(db, user.hotel_id, date_from, date_to)
    emps = await service._employees(db, user.hotel_id)
    emp_info = {eid: (e.employee_code, e.job_title) for eid, e in emps.items()}
    return _xlsx(
        export.rota_to_xlsx(shifts, date_from, date_to, emp_info), "mise-rota.xlsx"
    )


@router.get("/export.pdf")
async def export_rota_pdf(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> Response:
    hotel = await db.get(Hotel, user.hotel_id)
    shifts = await service.list_shifts(db, user.hotel_id, date_from, date_to)
    emps = await service._employees(db, user.hotel_id)
    emp_info = {eid: (e.employee_code, e.job_title) for eid, e in emps.items()}
    pdf = export.rota_to_pdf(
        shifts, hotel.name if hotel else "Rota", date_from, date_to, emp_info
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="mise-rota-{date_from}.pdf"'},
    )


@router.get("/template.xlsx")
async def rota_template_xlsx(
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> Response:
    df, dt = _week(date_from, date_to)
    rows = await _emp_rows(db, user.hotel_id)
    return _xlsx(export.template_grid_xlsx(rows, df, dt), "mise-rota-template.xlsx")


@router.get("/template.csv")
async def rota_template_csv(
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> Response:
    df, dt = _week(date_from, date_to)
    rows = await _emp_rows(db, user.hotel_id)
    return Response(
        content=export.template_grid_csv(rows, df, dt),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="mise-rota-template.csv"'},
    )


@router.post("/import")
async def import_rota_xlsx(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Upload a filled weekly-rota GRID (the same layout you download) — staff down
    the rows, days across the columns, cells like '09:00-17:00 -30m'. Re-uploading a
    week REPLACES those staff's shifts for that week (so edit-and-reupload is safe).
    Employees matched by full name; unknown names are reported (not created). The
    older one-row-per-shift template is still accepted as a fallback."""
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large")

    grid, grid_errors = export.parse_rota_grid(
        data, file.filename or "", file.content_type or ""
    )
    if grid is not None:
        if grid_errors:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": grid_errors}
            )
        emps = await service._employees(db, user.hotel_id)
        by_name = {e.full_name.strip().lower(): e for e in emps.values()}
        present: list[str] = []
        seen: set[str] = set()
        for n in grid["employees"]:
            k = n.strip().lower()
            if k not in seen:
                seen.add(k)
                present.append(n)
        skipped = sorted(n for n in present if n.strip().lower() not in by_name)
        # Replace each present-and-matched employee's week before re-adding (idempotent).
        for n in present:
            emp = by_name.get(n.strip().lower())
            if emp is not None:
                await service.clear_employee_shifts(
                    db, user.hotel_id, emp.id, grid["from"], grid["to"]
                )
        created = 0
        for sh in grid["shifts"]:
            emp = by_name.get(sh["employee"].strip().lower())
            if emp is None:
                continue
            await service.create_shift(
                db, user.hotel_id, employee_id=emp.id,
                date=sh["date"], start_time=sh["start"], end_time=sh["end"],
                break_minutes=sh["break_minutes"], notes=None,
            )
            created += 1
        return {"created": created, "skipped": skipped, "rows": len(grid["shifts"])}

    # Fallback: the older one-row-per-shift template.
    parsed, errors = template_io.parse_upload(
        data, file.filename or "", file.content_type or "", ROTA_TEMPLATE
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})
    emps = await service._employees(db, user.hotel_id)
    by_name = {e.full_name.strip().lower(): e for e in emps.values()}
    created = 0
    skipped = []
    for row in parsed:
        emp = by_name.get(str(row["employee"]).strip().lower())
        if emp is None:
            skipped.append(row["employee"])
            continue
        await service.create_shift(
            db, user.hotel_id, employee_id=emp.id,
            date=date_type.fromisoformat(row["date"]),
            start_time=time_type.fromisoformat(row["start"]),
            end_time=time_type.fromisoformat(row["end"]),
            break_minutes=int(row.get("break_minutes") or 0),
            notes=row.get("notes"),
        )
        created += 1
    return {"created": created, "skipped": skipped, "rows": len(parsed)}


@router.get("/labour", response_model=LabourSummary)
async def labour_summary(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> LabourSummary:
    return LabourSummary.model_validate(
        await service.labour_summary(db, user.hotel_id, date_from, date_to)
    )
