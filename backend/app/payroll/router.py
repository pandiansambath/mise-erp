"""Payroll endpoints: runs, approving, paying, recalling, payslips, advances.

Hotel-scoped. Reading asks for `payroll:read`; everything that changes anything,
Recall included, asks for `payroll:write`, the permission that approves.
"""
import base64
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from datetime import date as date_type
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core import notify
from app.core.database import get_db
from app.core.timezones import hotel_today
from app.employees.service import get_employee, list_employees
from app.hotels.models import Hotel
from app.payroll import calculator, engine, payslip, runs, service
from app.payroll.models import PayrollStatus
from app.payroll.periods import say_range
from app.payroll.schemas import (
    AdvanceCreate,
    AdvanceOut,
    HoldRequest,
    LegacyOut,
    NextRun,
    OwedList,
    PayRequest,
    PayrollRow,
    PreviewOut,
    PreviewRequest,
    ProcessRequest,
    RecallDone,
    RecallPreview,
    RecallRequest,
    RunDetail,
    RunsOut,
    SaveRun,
    SlipDetail,
    SlipOut,
    SomeSlips,
)

router = APIRouter(prefix="/payroll", tags=["payroll"])


@contextmanager
def said_plainly() -> Iterator[None]:
    """The payroll module's refusals, as the answers a browser understands."""
    try:
        yield
    except runs.NotThere as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except runs.RunConflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except runs.RunError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


async def _hotel(db: AsyncSession, user: User) -> Hotel:
    hotel = await db.get(Hotel, user.hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Restaurant not found")
    return hotel


async def _log_run(db: AsyncSession, user: User, run_id: uuid.UUID, action: str, summary: str):
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action=action, summary=summary,
        entity_type="payroll_run", entity_id=run_id,
    )


def _people(n: int) -> str:
    return f"{n} {'person' if n == 1 else 'people'}"


# ── making a run ─────────────────────────────────────────────────────────────
def _in_run(c: engine.Cover) -> dict:
    return {
        "run_id": c.run_id, "number": c.number, "label": c.label, "status": c.status,
        "payslip_id": c.payslip_id,
    }


def _person(w: engine.Worked, *, picked: bool, detail: bool) -> dict:
    e = w.employee
    paid = w.paid_days
    covers: dict[uuid.UUID, engine.Cover] = {}
    for d in w.days:
        if d.in_run is not None:
            covers.setdefault(d.in_run.run_id or d.in_run.payslip_id, d.in_run)
    return {
        "employee_id": e.id,
        "name": e.full_name,
        "code": e.employee_code,
        "job_title": e.job_title,
        "active": e.is_active,
        "salary_type": e.salary_type,
        "joining_date": e.joining_date,
        "picked": picked,
        "suggested": engine.suggested(w),
        "basis": w.basis,
        "pay_type": w.pay_type,
        "rate": w.rate,
        "own_rate": w.own_rate,
        "rate_typed": w.rate_typed,
        "days": sum(1 for d in paid if d.half_days != 1),
        "half_days": sum(1 for d in paid if d.half_days == 1),
        "minutes": w.minutes,
        "pay": w.pay,
        "overtime": w.overtime,
        "additions": w.additions,
        "deductions": w.deductions,
        "advance": w.advance,
        "advance_due": w.advance_due,
        "advance_owed": w.advance_owed,
        "net": w.net,
        "adjustments": [
            {"kind": k, "label": label, "amount": a} for k, label, a in w.adjustments
        ],
        "flags": [
            {
                "code": f.code, "text": f.text, "blocking": f.blocking, "dates": f.dates,
                "rota": f.rota,
            }
            for f in w.flags
        ],
        "in_runs": [_in_run(c) for c in covers.values()],
        "in_run_days": sum(1 for d in w.days if d.in_run is not None and not d.again),
        "hold": w.hold,
        "note": w.note,
        "day_lines": [
            {
                "date": d.date, "include": d.include, "amount": d.amount,
                "minutes": d.minutes, "half_days": d.half_days,
                "attendance": d.attendance, "attendance_minutes": d.attendance_minutes,
                "rota_minutes": d.rota_minutes,
                "clock_in": d.clock_in, "clock_out": d.clock_out,
                "leave": d.leave, "typed": d.typed, "again": d.again,
                "in_run": _in_run(d.in_run) if d.in_run else None,
                "why": d.why,
            }
            for d in w.days
        ] if detail else [],
    }


@router.post("/runs/preview", response_model=PreviewOut)
async def preview_run(
    payload: PreviewRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> PreviewOut:
    """Everybody, worked out for these dates, ticked or not. Nothing is saved."""
    hotel = await _hotel(db, user)
    with said_plainly():
        if payload.run_id is not None:
            # Only a run of this restaurant may be left out of the count.
            await runs.get_run(db, payload.run_id, user.hotel_id)
        dates = runs.dates_of(payload)
        worked = await runs.preview(db, hotel, payload, ignore_run=payload.run_id)
    picked = {p.employee_id for p in payload.people}
    chosen = [w for w in worked if w.employee.id in picked]
    detail = set(payload.detail)
    zero = runs.ZERO
    return PreviewOut.model_validate({
        "date_from": payload.date_from,
        "date_to": payload.date_to,
        "label": say_range(dates[0], dates[-1]),
        "days_in_range": len(dates),
        "people": [
            _person(w, picked=w.employee.id in picked, detail=w.employee.id in detail)
            for w in worked
        ],
        "totals": {
            "people": len(chosen),
            "held": sum(1 for w in chosen if w.hold),
            "days": sum(len(w.paid_days) for w in chosen),
            "minutes": sum(w.minutes for w in chosen),
            "pay": sum((w.pay for w in chosen), zero),
            "overtime": sum((w.overtime for w in chosen), zero),
            "additions": sum((w.additions for w in chosen), zero),
            "deductions": sum((w.deductions for w in chosen), zero),
            "advances": sum((w.advance for w in chosen), zero),
            "net": sum((w.net for w in chosen), zero),
            "blocked": sum(1 for w in chosen if w.blocked),
            "left_out_days": sum(
                1 for w in chosen for d in w.days if d.in_run is not None and not d.again
            ),
        },
        "min_wage": hotel.min_hourly_rate,
        "today": hotel_today(hotel),
    })


@router.post("/runs", response_model=RunDetail, status_code=status.HTTP_201_CREATED)
async def create_run(
    payload: SaveRun,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> RunDetail:
    hotel = await _hotel(db, user)
    with said_plainly():
        run = await runs.save_run(db, hotel, user, payload, expect_net=payload.expect_net)
        detail = await runs.run_detail(db, user.hotel_id, run.id)
    await _log_run(
        db, user, run.id, "payroll.run",
        f"Payroll run {run.number} made for {detail['label']}: "
        f"{_people(detail['people'])}, {runs.money(detail['net'])}",
    )
    return RunDetail.model_validate(detail)


@router.put("/runs/{run_id}", response_model=RunDetail)
async def change_run(
    run_id: uuid.UUID,
    payload: SaveRun,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> RunDetail:
    """A draft, worked out again with these dates and these people."""
    hotel = await _hotel(db, user)
    with said_plainly():
        run = await runs.get_run(db, run_id, user.hotel_id)
        run = await runs.save_run(
            db, hotel, user, payload, run=run, expect_net=payload.expect_net
        )
        detail = await runs.run_detail(db, user.hotel_id, run.id)
    await _log_run(
        db, user, run.id, "payroll.run",
        f"Payroll run {run.number} changed: {detail['label']}, "
        f"{_people(detail['people'])}, {runs.money(detail['net'])}",
    )
    return RunDetail.model_validate(detail)


@router.get("/runs", response_model=RunsOut)
async def list_runs(
    run_status: Literal["DRAFT", "APPROVED", "PART_PAID", "PAID", "UNPAID"] | None = Query(
        default=None, alias="status"
    ),
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    employee_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> RunsOut:
    """Every run, newest first, narrowed, with what they come to."""
    rows = await runs.list_runs(
        db, user.hotel_id, status=run_status, date_from=date_from, date_to=date_to,
        employee_id=employee_id,
    )
    old = await runs.legacy(db, user.hotel_id)
    slips = {s.id: s for s, _ in old}
    return RunsOut.model_validate({
        "runs": rows,
        "totals": runs.totals(rows),
        "legacy": {
            "payslips": len(slips),
            "total": sum((s.net_pay for s in slips.values()), runs.ZERO),
            "rows": await runs.slip_rows(db, user.hotel_id, list(slips.values())),
        },
    })


@router.get("/runs/next", response_model=NextRun | None)
async def next_run(
    run_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> NextRun | None:
    """A run (the last one, unless named) moved on to the next dates. Not saved."""
    hotel = await _hotel(db, user)
    with said_plainly():
        run = (
            await runs.get_run(db, run_id, user.hotel_id)
            if run_id
            else await runs.last_run(db, user.hotel_id)
        )
        if run is None:
            return None
        return NextRun.model_validate(await runs.next_run(db, hotel, run))


@router.get("/runs/{run_id}", response_model=RunDetail)
async def get_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> RunDetail:
    with said_plainly():
        return RunDetail.model_validate(await runs.run_detail(db, user.hotel_id, run_id))


# ── agreeing, paying, undoing ────────────────────────────────────────────────
@router.post("/runs/{run_id}/approve", response_model=RunDetail)
async def approve_run(
    run_id: uuid.UUID,
    payload: SomeSlips,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> RunDetail:
    """Draft → approved, for everybody or for the people named. Not an expense."""
    with said_plainly():
        done = await runs.approve(db, user.hotel_id, run_id, payload.payslip_ids, user)
        detail = await runs.run_detail(db, user.hotel_id, run_id)
    if done:
        net = sum((s.net_pay for s in done), runs.ZERO)
        await _log_run(
            db, user, run_id, "payroll.approve",
            f"Approved {_people(len(done))}, {runs.money(net)}, in payroll run "
            f"{detail['number']} ({detail['label']})",
        )
    return RunDetail.model_validate(detail)


@router.post("/runs/{run_id}/unapprove", response_model=RunDetail)
async def unapprove_run(
    run_id: uuid.UUID,
    payload: SomeSlips,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> RunDetail:
    """Approved → back to draft, to be changed."""
    with said_plainly():
        done = await runs.unapprove(db, user.hotel_id, run_id, payload.payslip_ids)
        detail = await runs.run_detail(db, user.hotel_id, run_id)
    if done:
        await _log_run(
            db, user, run_id, "payroll.unapprove",
            f"Put {_people(len(done))} back to draft in payroll run "
            f"{detail['number']} ({detail['label']})",
        )
    return RunDetail.model_validate(detail)


@router.post("/runs/{run_id}/pay", response_model=RunDetail)
async def pay_run(
    run_id: uuid.UUID,
    payload: PayRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> RunDetail:
    """Mark as paid, the whole run or the people named. THIS is the expense."""
    hotel = await _hotel(db, user)
    with said_plainly():
        done = await runs.pay(
            db, hotel, run_id, payload.payslip_ids, on=payload.paid_on,
            method=payload.method, reference=payload.reference, by=user,
        )
        detail = await runs.run_detail(db, user.hotel_id, run_id)
    net = sum((s.net_pay for s in done), runs.ZERO)
    await _log_run(
        db, user, run_id, "payroll.pay",
        f"Marked {_people(len(done))} paid, {runs.money(net)}, "
        f"{runs.METHOD_WORDS[payload.method]} on {payload.paid_on}, in payroll run "
        f"{detail['number']} ({detail['label']})",
    )
    return RunDetail.model_validate(detail)


@router.post("/runs/{run_id}/unpay", response_model=RunDetail)
async def unpay_run(
    run_id: uuid.UUID,
    payload: SomeSlips,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> RunDetail:
    """Undo a payment: back to approved, and out of Expenses."""
    with said_plainly():
        done = await runs.unpay(db, user.hotel_id, run_id, payload.payslip_ids)
        detail = await runs.run_detail(db, user.hotel_id, run_id)
    net = sum((s.net_pay for s in done), runs.ZERO)
    await _log_run(
        db, user, run_id, "payroll.unpay",
        f"Undid the payment of {_people(len(done))}, {runs.money(net)}, in payroll run "
        f"{detail['number']} ({detail['label']})",
    )
    return RunDetail.model_validate(detail)


# ── recall ───────────────────────────────────────────────────────────────────
@router.post("/runs/{run_id}/recall/preview", response_model=RecallPreview)
async def recall_preview(
    run_id: uuid.UUID,
    payload: SomeSlips,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> RecallPreview:
    """Exactly what a recall would remove, counted. Nothing is touched."""
    with said_plainly():
        p = await runs.plan_recall(db, user.hotel_id, run_id, payload.payslip_ids)
    return RecallPreview.model_validate({
        "label": p.label,
        "number": p.run.number,
        "whole_run": p.whole,
        "people": len(p.slips),
        "names": p.names,
        "days": p.days,
        "net": p.net,
        "paid_people": len(p.paid),
        "paid_net": p.paid_net,
        "expenses": len(p.expenses),
        "expenses_total": p.expenses_total,
        "advances": p.advances,
        "advances_total": p.advances_total,
        "adjustments": p.adjustments,
        "notifications": len(p.events),
        "emailed": p.emailed,
        "needs_word": bool(p.paid),
        "lines": p.lines(),
        "warnings": p.warnings(),
    })


@router.post("/runs/{run_id}/recall", response_model=RecallDone)
async def recall_run(
    run_id: uuid.UUID,
    payload: RecallRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> RecallDone:
    """Take it back, at any stage. One audit line is left (written in the same
    transaction, inside `runs.recall`), and nothing else."""
    with said_plainly():
        n, gone = await runs.recall(
            db, user.hotel_id, run_id, payload.payslip_ids,
            reason=payload.reason, confirm=payload.confirm, by=user,
        )
    return RecallDone(recalled=n, run_gone=gone)


# ── what a run gives ─────────────────────────────────────────────────────────
@router.get("/runs/{run_id}/export.csv")
async def run_csv(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> Response:
    with said_plainly():
        name, body = await runs.run_csv(db, user.hotel_id, run_id)
    return Response(
        content=body, media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/runs/{run_id}/payslips.pdf")
async def run_payslips_pdf(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> Response:
    """One PDF with everyone's payslip in the run."""
    with said_plainly():
        run = await runs.get_run(db, run_id, user.hotel_id)
    items = await service.run_records(db, user.hotel_id, run_id)
    return await _payslips_pdf(db, user, items, f"payslips-run-{run.number}.pdf")


async def _payslips_pdf(db: AsyncSession, user: User, items: list, name: str) -> Response:
    hotel = await _hotel(db, user)
    extras = await runs.adjustments_of(db, user.hotel_id, [p.id for p, _ in items])
    pdf = payslip.generate_consolidated(items, hotel, extras)
    return Response(
        content=pdf, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.post("/runs/{run_id}/email")
async def email_run(
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> dict:
    """Every approved or paid payslip in the run. Says who was skipped and why."""
    with said_plainly():
        run = await runs.get_run(db, run_id, user.hotel_id)
    records = await service.run_records(db, user.hotel_id, run_id)
    out = await _email_records(db, user, records)
    await _log_run(
        db, user, run_id, "payroll.email",
        f"Emailed {out['sent']} payslip(s) of payroll run {run.number}",
    )
    return out


# ── one person in a run ──────────────────────────────────────────────────────
@router.get("/slips/{payslip_id}", response_model=SlipDetail)
async def get_slip(
    payslip_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> SlipDetail:
    with said_plainly():
        return SlipDetail.model_validate(
            await runs.slip_detail(db, user.hotel_id, payslip_id)
        )


@router.post("/slips/{payslip_id}/hold", response_model=SlipOut)
async def hold_slip(
    payslip_id: uuid.UUID,
    payload: HoldRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> SlipOut:
    """Hold one person back: not approved and not paid with the rest."""
    with said_plainly():
        slip = await runs.set_hold(db, user.hotel_id, payslip_id, payload.held)
        row = (await runs.slip_rows(db, user.hotel_id, [slip]))[0]
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="payroll.hold",
        summary=(
            f"{row['employee_name']} {'held back in' if payload.held else 'let go in'} "
            f"payroll ({row['label']})"
        ),
        entity_type="payroll", entity_id=payslip_id,
    )
    return SlipOut.model_validate(row)


# ── who is owed what ─────────────────────────────────────────────────────────
@router.get("/owed", response_model=OwedList)
async def who_is_owed(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> OwedList:
    """Everybody's days that are in no run yet, and what they come to."""
    hotel = await _hotel(db, user)
    return OwedList.model_validate(await runs.owed(db, hotel))


# ── approved by the old version ──────────────────────────────────────────────
@router.post("/legacy/paid", response_model=LegacyOut)
async def legacy_were_paid(
    payload: SomeSlips,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> LegacyOut:
    """"Those were paid": approved before approval stopped meaning "in Expenses".

    Each goes back into Expenses on the day, and by the method, it was booked
    with, so the months they were in read as they always did.
    """
    with said_plainly():
        done = await runs.legacy_paid(db, user.hotel_id, payload.payslip_ids, user)
    net = sum((s.net_pay for s in done), runs.ZERO)
    by_run: dict[uuid.UUID, int] = {}
    for s in done:
        if s.run_id:
            by_run[s.run_id] = by_run.get(s.run_id, 0) + 1
    for run_id, n in by_run.items():
        await _log_run(
            db, user, run_id, "payroll.pay",
            f"Marked {_people(n)} paid who were approved before, on the day each was "
            f"booked ({runs.money(net)} in all)",
        )
    left = {s.id: s for s, _ in await runs.legacy(db, user.hotel_id)}
    return LegacyOut.model_validate({
        "payslips": len(left),
        "total": sum((s.net_pay for s in left.values()), runs.ZERO),
        "rows": await runs.slip_rows(db, user.hotel_id, list(left.values())),
    })


# ── one period at a time ─────────────────────────────────────────────────────
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

    left_alone = 0
    rec = None
    try:
        for emp in employees:
            try:
                rec = await service.process_payroll(
                    db, emp, payload.pay_period,
                    date_from=payload.date_from,
                    date_to=payload.date_to,
                    working_days=payload.working_days,
                    other_deductions=payload.other_deductions,
                    processed_by=user.id,
                    min_wage=min_wage,
                )
            except service.PayslipSettledError:
                # One person asked for by name hears why. A whole-period run
                # carries on: one paid person must not stop the drafts.
                if payload.employee_id:
                    raise
                left_alone += 1
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
        summary=(
            f"Ran payroll for {period_label}: {len(rows)} staff, net £{net_total}"
            + (f", {left_alone} already settled and left alone" if left_alone else "")
        ),
        entity_type="payroll_run", entity_id=rec.run_id if rec else None,
    )
    return [PayrollRow.model_validate(r) for r in rows]


@router.get("", response_model=list[PayrollRow])
async def list_payroll(
    pay_period: str = Query(..., pattern=service.PERIOD_PATTERN),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> list[PayrollRow]:
    rows = await service.list_payroll(db, user.hotel_id, pay_period)
    return [PayrollRow.model_validate(r) for r in rows]


@router.post("/approve-all", response_model=list[PayrollRow])
async def approve_all(
    pay_period: str = Query(..., pattern=service.PERIOD_PATTERN),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> list[PayrollRow]:
    """Approve every DRAFT payslip for the period in one click. Not an expense."""
    n = await service.approve_all(db, user.hotel_id, pay_period, by=user)
    rows = await service.list_payroll(db, user.hotel_id, pay_period)
    if n:
        run_ids = {r["run_id"] for r in rows if r["run_id"]}
        await audit.record(
            db, hotel_id=user.hotel_id, user=user, action="payroll.approve_all",
            summary=f"Approved all {n} draft payslip(s) for {pay_period}",
            entity_type="payroll_run",
            entity_id=next(iter(run_ids)) if len(run_ids) == 1 else None,
        )
    return [PayrollRow.model_validate(r) for r in rows]


@router.get("/payslips.pdf")
async def payslips_pdf(
    pay_period: str = Query(..., pattern=service.PERIOD_PATTERN),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:read")),
) -> Response:
    """One PDF with everyone's payslip for the period (the super-admin run summary)."""
    items = await service.payroll_records(db, user.hotel_id, pay_period)
    name = f"payslips-{pay_period.replace('→', '-to-')}.pdf"
    return await _payslips_pdf(db, user, items, name)


# ── Payslips by email ───────────────────────────────────────────────────────
#
# Staff records hold no email of their own, so a payslip goes to the address on
# the person's LOGIN and nowhere else. A DRAFT is never sent: it is not yet a
# payslip anybody has agreed to.
async def _email_payslip(db: AsyncSession, rec, hotel: Hotel) -> str | None:
    """Send one payslip. Returns None when sent, else why it was not."""
    if rec.status == PayrollStatus.DRAFT.value:
        return "it is still a draft — approve it first"
    emp = await get_employee(db, rec.employee_id, hotel.id)
    if emp is None:
        return "the employee record is gone"
    login = await db.get(User, emp.user_id) if emp.user_id else None
    if login is None or login.hotel_id != hotel.id or not login.email:
        return f"{emp.full_name} has no login, so there is no email address on record"
    extras = await runs.adjustments_of(db, hotel.id, [rec.id])
    pdf = payslip.generate_payslip(rec, emp, hotel, extras.get(rec.id, ()))
    period = say_range(*engine.slip_range(rec))
    sent = await notify.send_email(
        login.email,
        f"Your payslip for {period} — {hotel.name}",
        f"Hi {emp.full_name},\n\nYour payslip for {period} from {hotel.name} is "
        "attached as a PDF.\n",
        attachments=[{
            "filename": payslip.file_name(rec, emp),
            "content": base64.b64encode(pdf).decode(),
        }],
    )
    if not sent:
        return f"the email to {emp.full_name} was not accepted"
    rec.emailed_at = datetime.now(UTC)
    await db.commit()
    return None


async def _email_records(db: AsyncSession, user: User, records: list) -> dict:
    hotel = await _hotel(db, user)
    sent = 0
    skipped: list[str] = []
    for rec, _employee in records:
        if rec.status == PayrollStatus.DRAFT.value:
            continue
        why = await _email_payslip(db, rec, hotel)
        if why:
            skipped.append(why)
        else:
            sent += 1
    return {"sent": sent, "skipped": skipped}


@router.post("/email-all")
async def email_all_payslips(
    pay_period: str = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> dict:
    """Every approved or paid payslip in the period. Says who was skipped and why."""
    records = await service.payroll_records(db, user.hotel_id, pay_period)
    out = await _email_records(db, user, records)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="payroll.email",
        summary=f"Emailed {out['sent']} payslip(s) for {pay_period}",
        entity_type="payroll",
    )
    return out


@router.post("/{payroll_id}/email")
async def email_payslip(
    payroll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> dict:
    rec = await service.get_payroll(db, payroll_id, user.hotel_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payroll not found")
    hotel = await db.get(Hotel, user.hotel_id)
    why = await _email_payslip(db, rec, hotel)
    if why:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Not sent: {why}.")
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="payroll.email",
        summary=f"Emailed the payslip for {say_range(*engine.slip_range(rec))}",
        entity_type="payroll", entity_id=rec.id,
    )
    return {"sent": 1}


@router.post("/{payroll_id}/approve", response_model=PayrollRow)
async def approve(
    payroll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> PayrollRow:
    """Agree one payslip. Not an expense: no money has moved."""
    with said_plainly():
        slip = await runs.approve_one(db, user.hotel_id, payroll_id, user)
    return await _logged_row(db, user, slip, "payroll.approve", "approved")


@router.post("/{payroll_id}/pay", response_model=PayrollRow)
async def mark_paid(
    payroll_id: uuid.UUID,
    payload: PayRequest | None = Body(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> PayrollRow:
    """One payslip, paid: today by bank transfer unless it is said otherwise."""
    hotel = await _hotel(db, user)
    with said_plainly():
        slip = await runs.pay_one(
            db, hotel, payroll_id,
            on=payload.paid_on if payload else hotel_today(hotel),
            method=payload.method if payload else "BANK",
            reference=payload.reference if payload else None,
            by=user,
        )
    return await _logged_row(db, user, slip, "payroll.pay", "paid")


async def _logged_row(db, user, slip, action: str, verb: str) -> PayrollRow:
    rows = await service.list_payroll(db, user.hotel_id, slip.pay_period)
    row = next(r for r in rows if r["id"] == slip.id)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action=action,
        summary=f"Payslip {verb}: {row['employee_name']} £{row['net_pay']} ({row['label']})",
        entity_type="payroll", entity_id=slip.id,
    )
    return PayrollRow.model_validate(row)


@router.delete("/{payroll_id}")
async def remove(
    payroll_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("payroll:write")),
) -> dict:
    """Take one unpaid person out of a run: their days are free again and any
    advance goes back to owed. A paid one is recalled instead, which asks why."""
    with said_plainly():
        name, net, run_id = await runs.take_out(db, user.hotel_id, payroll_id)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="payroll.remove",
        summary=f"Took {name} out of payroll ({runs.money(net)})",
        entity_type="payroll_run", entity_id=run_id,
    )
    return {"removed": True}


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
    extras = await runs.adjustments_of(db, user.hotel_id, [rec.id])
    pdf = payslip.generate_payslip(rec, emp, hotel, extras.get(rec.id, ()))
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{payslip.file_name(rec, emp)}"'
        },
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
            {**r, "id": str(r["id"]), "run_id": str(r["run_id"]) if r["run_id"] else None,
             "total_hours": str(r["total_hours"]),
             "gross_pay": str(r["gross_pay"]), "net_pay": str(r["net_pay"]),
             "additions": str(r["additions"]),
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
    name = payslip.safe_name(f"pay-statement-{emp.employee_code}") + ".pdf"
    return await _payslips_pdf(db, user, items, name)


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
