"""Self-service endpoints (/me): a logged-in employee sees only their OWN
attendance, payslips, and documents. Resolves the Employee linked to the user."""
import uuid

from datetime import date as date_type, timedelta

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.models import User
from app.core.config import settings
from app.core.database import get_db
from app.core.storage import get_storage
from app.documents import service as doc_service
from app.documents.schemas import DocRequestOut, DocumentOut
from app.employees import service as emp_service
from app.employees.models import Employee
from app.employees.schemas import AttendanceRow, EmployeeOut
from app.hotels.models import Hotel
from app.payroll import payslip
from app.payroll import service as payroll_service
from app.payroll.schemas import PayrollRow
from app.rota import service as rota_service
from app.rota.schemas import ShiftOut

router = APIRouter(prefix="/me", tags=["self-service"])


async def _my_employee(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Employee:
    emp = await emp_service.get_employee_for_user(db, user.id, user.hotel_id)
    if emp is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "No employee record is linked to your login. Ask your manager to link it.",
        )
    return emp


@router.get("/employee", response_model=EmployeeOut)
async def my_employee(emp: Employee = Depends(_my_employee)) -> EmployeeOut:
    return EmployeeOut.model_validate(emp)


@router.get("/attendance", response_model=list[AttendanceRow])
async def my_attendance(
    emp: Employee = Depends(_my_employee),
    db: AsyncSession = Depends(get_db),
) -> list[AttendanceRow]:
    rows = await emp_service.list_attendance_for_employee(db, emp.id)
    return [AttendanceRow.model_validate(r) for r in rows]


class MyAttendanceTotals(BaseModel):
    present: int
    half_days: int
    absent: int
    recorded_days: int
    total_hours: str
    indicative_pay: str
    basis: str


class MyAttendanceHistory(BaseModel):
    """DECLARED IN FULL, deliberately. `response_model` silently drops any field
    the schema does not mention — this project has been bitten by that four
    times, most recently a PO PDF that printed a quantity the screen never
    showed. If a figure is meant to reach the page, it is named here."""

    date_from: str
    date_to: str
    totals: MyAttendanceTotals
    days: list[AttendanceRow]


@router.get("/attendance/history", response_model=MyAttendanceHistory)
async def my_attendance_history(
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    emp: Employee = Depends(_my_employee),
    db: AsyncSession = Depends(get_db),
) -> MyAttendanceHistory:
    """Their own attendance over ANY range, with the hours totalled.

    "attendance we need historical data too. i mean he can use filter to go back
     and check attendance and hours etc."

    The plain /me/attendance is the last 90 rows and no totals, which answers
    "was I in yesterday" and nothing else. This answers "how many hours did I do
    last month". Scoped by _my_employee, so the range is the only thing the
    caller controls — never whose data comes back.
    """
    today = date_type.today()
    d_to = date_to or today
    d_from = date_from or (d_to - timedelta(days=30))
    data = await emp_service.attendance_history(db, emp.hotel_id, emp.id, d_from, d_to)
    if not data:
        return MyAttendanceHistory(
            date_from=d_from.isoformat(),
            date_to=d_to.isoformat(),
            totals=MyAttendanceTotals(
                present=0, half_days=0, absent=0, recorded_days=0,
                total_hours="0", indicative_pay="0", basis="no records",
            ),
            days=[],
        )
    return MyAttendanceHistory(
        date_from=data["date_from"],
        date_to=data["date_to"],
        totals=MyAttendanceTotals(**data["totals"]),
        days=[AttendanceRow.model_validate(d) for d in data["days"]],
    )


@router.get("/rota", response_model=list[ShiftOut])
async def my_rota(
    date_from: date_type | None = Query(None),
    date_to: date_type | None = Query(None),
    emp: Employee = Depends(_my_employee),
    db: AsyncSession = Depends(get_db),
) -> list[ShiftOut]:
    """Their own shifts, past and future.

    "likewise rota too" — the rota page shows the whole team and needs a
    manager's permission to see. A member of staff wanting to know when they are
    next on should not need either. The employee filter is applied in the QUERY,
    so no other person's shift is ever loaded, let alone returned.
    """
    today = date_type.today()
    d_from = date_from or (today - timedelta(days=7))
    d_to = date_to or (today + timedelta(days=28))
    rows = await rota_service.list_shifts(db, emp.hotel_id, d_from, d_to, employee_id=emp.id)
    return [ShiftOut.model_validate(r) for r in rows]


@router.get("/payslips", response_model=list[PayrollRow])
async def my_payslips(
    emp: Employee = Depends(_my_employee),
    db: AsyncSession = Depends(get_db),
) -> list[PayrollRow]:
    rows = await payroll_service.list_payroll_for_employee(db, emp.hotel_id, emp.id)
    return [PayrollRow.model_validate(r) for r in rows]


@router.get("/payslips/{payroll_id}.pdf")
async def my_payslip_pdf(
    payroll_id: uuid.UUID,
    emp: Employee = Depends(_my_employee),
    db: AsyncSession = Depends(get_db),
) -> Response:
    rec = await payroll_service.get_payroll(db, payroll_id, emp.hotel_id)
    if rec is None or rec.employee_id != emp.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payslip not found")
    hotel = await db.get(Hotel, emp.hotel_id)
    pdf = payslip.generate_payslip(rec, emp, hotel)
    fname = f"payslip-{emp.employee_code}-{rec.pay_period}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/documents", response_model=list[DocumentOut])
async def my_documents(
    emp: Employee = Depends(_my_employee),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentOut]:
    docs = await doc_service.list_documents(
        db, emp.hotel_id, entity_type="EMPLOYEE", entity_id=emp.id
    )
    return [DocumentOut.model_validate(d) for d in docs]


@router.get("/documents/{doc_id}/download")
async def download_my_document(
    doc_id: uuid.UUID,
    emp: Employee = Depends(_my_employee),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Download one of MY OWN documents (must be tagged to this employee)."""
    doc = await doc_service.get_document(db, doc_id, emp.hotel_id)
    if doc is None or doc.related_entity_type != "EMPLOYEE" or doc.related_entity_id != emp.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    try:
        data = get_storage().read(doc.storage_key)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File missing") from exc
    return Response(
        content=data,
        media_type=doc.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{doc.filename}"'},
    )


@router.get("/document-requests", response_model=list[DocRequestOut])
async def my_document_requests(
    emp: Employee = Depends(_my_employee),
    db: AsyncSession = Depends(get_db),
) -> list[DocRequestOut]:
    rows = await doc_service.list_requests(db, emp.hotel_id, employee_id=emp.id)
    return [DocRequestOut.model_validate(r) for r in rows]


@router.post("/document-requests/{request_id}/upload", response_model=DocRequestOut)
async def fulfil_document_request(
    request_id: uuid.UUID,
    file: UploadFile = File(...),
    emp: Employee = Depends(_my_employee),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocRequestOut:
    req = await doc_service.get_request(db, request_id, emp.hotel_id)
    if req is None or req.employee_id != emp.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {settings.max_upload_mb} MB",
        )
    await doc_service.fulfil_request(
        db, req,
        filename=file.filename or "document",
        mime_type=file.content_type,
        data=data,
        uploaded_by=user.id,
    )
    rows = await doc_service.list_requests(db, emp.hotel_id, employee_id=emp.id)
    return DocRequestOut.model_validate(next(r for r in rows if r["id"] == request_id))
