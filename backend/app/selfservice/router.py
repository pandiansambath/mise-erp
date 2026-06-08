"""Self-service endpoints (/me): a logged-in employee sees only their OWN
attendance, payslips, and documents. Resolves the Employee linked to the user."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.models import User
from app.core.database import get_db
from app.documents import service as doc_service
from app.documents.schemas import DocumentOut
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
