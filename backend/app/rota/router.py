"""Rota endpoints: shifts + labour summary. Hotel-scoped."""
import uuid
from datetime import date as date_type
from datetime import time as time_type

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

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


@router.post("/shifts", response_model=ShiftOut, status_code=status.HTTP_201_CREATED)
async def create_shift(
    payload: ShiftCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> ShiftOut:
    await service.create_shift(db, user.hotel_id, **payload.model_dump())
    # re-read via list so the response carries employee_name + computed hours/cost
    rows = await service.list_shifts(db, user.hotel_id, payload.date, payload.date)
    return ShiftOut.model_validate(rows[-1])


@router.get("/shifts", response_model=list[ShiftOut])
async def list_shifts(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[ShiftOut]:
    rows = await service.list_shifts(db, user.hotel_id, date_from, date_to)
    return [ShiftOut.model_validate(r) for r in rows]


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift(
    shift_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> None:
    sh = await service.get_shift(db, shift_id, user.hotel_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shift not found")
    await service.delete_shift(db, sh)


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
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> Response:
    emps = await service._employees(db, user.hotel_id)
    names = sorted(e.full_name for e in emps.values())
    return _xlsx(export.template_xlsx(names), "mise-rota-template.xlsx")


@router.get("/template.csv")
async def rota_template_csv(
    user: User = Depends(require("employees:read")),
) -> Response:
    return Response(
        content=template_io.template_csv(ROTA_TEMPLATE),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="mise-rota-template.csv"'},
    )


@router.post("/import")
async def import_rota_xlsx(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Upload a filled rota template (Excel/CSV). Validated STRICTLY — a mismatch
    returns the exact problems (422). Employees matched by full name; unknown names
    are reported (not created)."""
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large")
    parsed, errors = template_io.parse_upload(
        data, file.filename or "", file.content_type or "", ROTA_TEMPLATE
    )
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail={"errors": errors})
    emps = await service._employees(db, user.hotel_id)
    by_name = {e.full_name.strip().lower(): e for e in emps.values()}
    created = 0
    skipped: list[str] = []
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
