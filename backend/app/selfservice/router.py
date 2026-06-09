"""Self-service endpoints (/me): a logged-in employee sees only their OWN
attendance, payslips, and documents. Resolves the Employee linked to the user."""
import uuid

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
    status,
)
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
