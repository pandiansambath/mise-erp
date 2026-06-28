"""Rota endpoints: shifts + labour summary. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.hotels.models import Hotel
from app.rota import export, service
from app.rota.schemas import LabourSummary, ShiftCreate, ShiftOut

router = APIRouter(prefix="/rota", tags=["rota"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


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


@router.post("/import")
async def import_rota_xlsx(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    """Parse a filled rota template (Excel) and create the shifts. Employees are
    matched by full name (case-insensitive); unknown names are reported, not created."""
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large")
    parsed = export.parse_rota_xlsx(data)
    emps = await service._employees(db, user.hotel_id)
    by_name = {e.full_name.strip().lower(): e for e in emps.values()}
    created = 0
    skipped: list[str] = []
    for row in parsed:
        emp = by_name.get(row["employee_name"].strip().lower())
        if emp is None:
            skipped.append(row["employee_name"])
            continue
        await service.create_shift(
            db, user.hotel_id, employee_id=emp.id, date=row["date"],
            start_time=row["start_time"], end_time=row["end_time"], notes=row["notes"],
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
