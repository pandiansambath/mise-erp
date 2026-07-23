"""Payroll endpoints: process runs, approve/pay, payslip PDF, advances. Hotel-scoped."""
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
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
    custom = bool(payload.date_from and payload.date_to)
    if not custom and not payload.pay_period:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Pick a month, a week, or a custom date range"
        )
    if custom and not payload.employee_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Custom date ranges are per-person — pick the employee first",
        )
    weekly = bool(payload.pay_period) and service.is_weekly(payload.pay_period)
    if payload.employee_id:
        emp = await get_employee(db, payload.employee_id, user.hotel_id)
        if emp is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
        employees = [emp]
    else:
        employees = await list_employees(db, user.hotel_id)
        if weekly:
            # A weekly run pays the weekly-paid (hourly) staff; monthly-salaried
            # colleagues are paid on their month-end run.
            employees = [e for e in employees if e.salary_type == "HOURLY"]
            if not employees:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "No hourly-paid staff to run weekly payroll for.",
                )
        else:
            # THE DOUBLE-PAY FIX: a monthly run pays monthly-salaried staff ONLY.
            # Hourly staff are paid by their weekly (or custom) runs; including
            # them here would pay the same hours twice.
            employees = [e for e in employees if e.salary_type == "MONTHLY"]
            if not employees:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "No monthly-salaried staff for a monthly run - hourly staff "
                    "are paid via weekly runs.",
                )

    hotel = await db.get(Hotel, user.hotel_id)
    min_wage = hotel.min_hourly_rate if hotel else calculator.MIN_WAGE_UK

    try:
        for emp in employees:
            rec = await service.process_payroll(
                db, emp, payload.pay_period,
                date_from=payload.date_from,
                date_to=payload.date_to,
                working_days=payload.working_days,
                other_deductions=payload.other_deductions,
                processed_by=user.id,
                min_wage=min_wage,
            )
    except service.AlreadyPaidError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except calculator.MinWageError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    period_label = payload.pay_period or rec.pay_period
    rows = await service.list_payroll(db, user.hotel_id, period_label)
    net_total = sum((r["net_pay"] for r in rows), Decimal("0"))
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="payroll.run",
        summary=f"Ran payroll for {period_label}: {len(rows)} staff, net £{net_total}",
        entity_type="payroll",
    )
    return [PayrollRow.model_validate(r) for r in rows]


@router.get("", response_model=list[PayrollRow])
async def list_payroll(
    pay_period: str = Query(..., pattern=r"^\d{4}-(\d{2}|W\d{2})$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> list[PayrollRow]:
    rows = await service.list_payroll(db, user.hotel_id, pay_period)
    return [PayrollRow.model_validate(r) for r in rows]


@router.post("/approve-all", response_model=list[PayrollRow])
async def approve_all(
    pay_period: str = Query(..., pattern=r"^\d{4}-(\d{2}|W\d{2})$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> list[PayrollRow]:
    """Approve every DRAFT payslip for the period in one click."""
    n = await service.approve_all(db, user.hotel_id, pay_period)
    if n:
        await audit.record(
            db, hotel_id=user.hotel_id, user=user, action="payroll.approve_all",
            summary=f"Approved all {n} draft payslip(s) for {pay_period}",
            entity_type="payroll",
        )
    rows = await service.list_payroll(db, user.hotel_id, pay_period)
    return [PayrollRow.model_validate(r) for r in rows]


@router.get("/payslips.pdf")
async def payslips_pdf(
    pay_period: str = Query(..., pattern=r"^\d{4}-(\d{2}|W\d{2})$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> Response:
    """One PDF with everyone's payslip for the period (the super-admin run summary)."""
    items = await service.payroll_records(db, user.hotel_id, pay_period)
    hotel = await db.get(Hotel, user.hotel_id)
    pdf = payslip.generate_consolidated(items, hotel)
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="payslips-{pay_period}.pdf"'},
    )


@router.post("/{payroll_id}/approve", response_model=PayrollRow)
async def approve(
    payroll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> PayrollRow:
    return await _set_status(db, payroll_id, user, PayrollStatus.APPROVED.value)


@router.post("/{payroll_id}/pay", response_model=PayrollRow)
async def mark_paid(
    payroll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> PayrollRow:
    return await _set_status(db, payroll_id, user, PayrollStatus.PAID.value)


@router.delete("/{payroll_id}")
async def remove(
    payroll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> dict:
    """Safely remove a payslip (any status) — also reverses its auto-posted salary
    expense so the P&L stays correct. The undo for a mistaken run."""
    rec = await service.get_payroll(db, payroll_id, user.hotel_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payroll not found")
    period = rec.pay_period
    net = rec.net_pay
    emp = await get_employee(db, rec.employee_id, user.hotel_id)
    name = emp.full_name if emp else "staff"
    await service.remove_payroll(db, rec)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="payroll.remove",
        summary=f"Removed payslip: {name} £{net} ({period})",
        entity_type="payroll", entity_id=payroll_id,
    )
    return {"removed": True}


async def _set_status(db, payroll_id, user, new_status) -> PayrollRow:
    rec = await service.get_payroll(db, payroll_id, user.hotel_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payroll not found")
    await service.set_status(db, rec, new_status)
    emp = await get_employee(db, rec.employee_id, user.hotel_id)
    if emp and new_status in (PayrollStatus.APPROVED.value, PayrollStatus.PAID.value):
        # ONE-STOP: approved wages appear in Expenses automatically (idempotent).
        await service.post_salary_expense(db, rec, emp.full_name)
    rows = await service.list_payroll(db, user.hotel_id, rec.pay_period)
    row = next(r for r in rows if r["id"] == rec.id)
    verb = new_status.lower()
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action=f"payroll.{verb}",
        summary=f"Payslip {verb}: {row['employee_name']} £{row['net_pay']} ({rec.pay_period})",
        entity_type="payroll", entity_id=rec.id,
    )
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


@router.post("/preview")
async def preview(
    payload: ProcessRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> dict:
    """Dry run for ONE employee: days worked, hours, pay and any already-paid
    clash - nothing is saved. The UI shows this before the human commits."""
    if not payload.employee_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Preview needs an employee")
    emp = await get_employee(db, payload.employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    hotel = await db.get(Hotel, user.hotel_id)
    try:
        return await service.preview_payroll(
            db, emp, payload.pay_period,
            date_from=payload.date_from,
            date_to=payload.date_to,
            working_days=payload.working_days,
            other_deductions=payload.other_deductions,
            min_wage=hotel.min_hourly_rate if hotel else calculator.MIN_WAGE_UK,
        )
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/history/{employee_id}")
async def employee_history(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> dict:
    """A person's complete pay record - every run ever: weekly, monthly, custom."""
    emp = await get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    rows = await service.history(db, user.hotel_id, employee_id)
    return {
        "employee": {
            "id": str(emp.id), "name": emp.full_name, "salary_type": emp.salary_type,
            "monthly_salary": str(emp.monthly_salary) if emp.monthly_salary else None,
            "hourly_rate": str(emp.hourly_rate) if emp.hourly_rate else None,
        },
        "runs": [
            {**r, "id": str(r["id"]), "total_hours": str(r["total_hours"]),
             "gross_pay": str(r["gross_pay"]), "net_pay": str(r["net_pay"]),
             "advance_deduction": str(r["advance_deduction"]),
             "other_deductions": str(r["other_deductions"])}
            for r in rows
        ],
    }


@router.get("/history/{employee_id}/statement.pdf")
async def employee_statement_pdf(
    employee_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> Response:
    """One PDF with every payslip this person ever received."""
    emp = await get_employee(db, employee_id, user.hotel_id)
    if emp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    items = await service.history_records(db, user.hotel_id, employee_id)
    hotel = await db.get(Hotel, user.hotel_id)
    pdf = payslip.generate_consolidated(items, hotel)
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition":
                 f'attachment; filename="pay-statement-{emp.employee_code}.pdf"'},
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
