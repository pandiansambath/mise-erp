"""Payroll endpoints: process runs, approve/pay, payslip PDF, advances. Hotel-scoped."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.employees.service import get_employee, list_employees
from app.hotels.models import Hotel
from app.payroll import calculator, payslip, service
from app.payroll.models import PayrollStatus
from app.payroll.schemas import AdvanceCreate, AdvanceOut, PayrollRow, ProcessRequest

router = APIRouter(prefix="/payroll", tags=["payroll"])


@router.post("/process", response_model=list[PayrollRow])
async def process(
    payload: ProcessRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> list[PayrollRow]:
    if payload.employee_id:
        emp = await get_employee(db, payload.employee_id, user.hotel_id)
        if emp is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
        employees = [emp]
    else:
        employees = await list_employees(db, user.hotel_id)

    try:
        for emp in employees:
            await service.process_payroll(
                db, emp, payload.pay_period,
                working_days=payload.working_days,
                other_deductions=payload.other_deductions,
                processed_by=user.id,
            )
    except calculator.MinWageError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    rows = await service.list_payroll(db, user.hotel_id, payload.pay_period)
    return [PayrollRow.model_validate(r) for r in rows]


@router.get("", response_model=list[PayrollRow])
async def list_payroll(
    pay_period: str = Query(..., pattern=r"^\d{4}-\d{2}$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> list[PayrollRow]:
    rows = await service.list_payroll(db, user.hotel_id, pay_period)
    return [PayrollRow.model_validate(r) for r in rows]


@router.post("/{payroll_id}/approve", response_model=PayrollRow)
async def approve(
    payroll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> PayrollRow:
    return await _set_status(db, payroll_id, user.hotel_id, PayrollStatus.APPROVED.value)


@router.post("/{payroll_id}/pay", response_model=PayrollRow)
async def mark_paid(
    payroll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> PayrollRow:
    return await _set_status(db, payroll_id, user.hotel_id, PayrollStatus.PAID.value)


async def _set_status(db, payroll_id, hotel_id, new_status) -> PayrollRow:
    rec = await service.get_payroll(db, payroll_id, hotel_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payroll not found")
    await service.set_status(db, rec, new_status)
    rows = await service.list_payroll(db, hotel_id, rec.pay_period)
    row = next(r for r in rows if r["id"] == rec.id)
    return PayrollRow.model_validate(row)


@router.get("/{payroll_id}/payslip.pdf")
async def payslip_pdf(
    payroll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> Response:
    rec = await service.get_payroll(db, payroll_id, user.hotel_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payroll not found")
    emp = await get_employee(db, rec.employee_id, user.hotel_id)
    hotel = await db.get(Hotel, user.hotel_id)
    pdf = payslip.generate_payslip(rec, emp, hotel)
    fname = f"payslip-{emp.employee_code}-{rec.pay_period}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── Advances ────────────────────────────────────────────────────────────────
@router.post("/advances", response_model=AdvanceOut, status_code=status.HTTP_201_CREATED)
async def create_advance(
    payload: AdvanceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> AdvanceOut:
    if await get_employee(db, payload.employee_id, user.hotel_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    adv = await service.create_advance(db, user.hotel_id, **payload.model_dump(exclude_none=True))
    return AdvanceOut.model_validate(adv)


@router.get("/advances", response_model=list[AdvanceOut])
async def list_advances(
    employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> list[AdvanceOut]:
    advances = await service.list_advances(db, user.hotel_id, employee_id)
    return [AdvanceOut.model_validate(a) for a in advances]
