"""Payroll by period, advances, and a person's own record.

Runs (any dates, anybody) live in `runs.py` and the sums in `engine.py`. This is
what was here before them and is still asked for: "run this month", "run this
week", one person's history, and the advances. Every sum in it goes through the
same engine, so there is one answer to what somebody is paid.
"""
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.models import Employee, SalaryType
from app.hotels.models import Hotel
from app.payroll import calculator, engine, runs
from app.payroll.models import Payroll, PayrollRun, PayrollStatus, SalaryAdvance
from app.payroll.periods import (  # noqa: F401  (callers and tests read them from here)
    MAX_DAYS,
    PERIOD_PATTERN,
    custom_label,
    days_between,
    is_weekly,
    period_range,
    say_range,
)
from app.payroll.schemas import AdjustmentIn, PersonIn

# kept for existing imports/tests
month_range = period_range


class MissingPayBasisError(ValueError):
    """No hourly rate or monthly salary — pay would silently be £0.00."""


class AlreadyPaidError(ValueError):
    """This employee already has pay covering (part of) the requested dates."""


class PayslipSettledError(AlreadyPaidError):
    """This very payslip is approved or paid, so a run must not touch it."""


async def settled_payslip(db: AsyncSession, employee_id: uuid.UUID, label: str) -> Payroll | None:
    """The person's payslip for this period, if it is past DRAFT.

    Running a period again used to recompute the row and set it back to DRAFT
    whatever state it was in. So pressing Run on a month already paid turned PAID
    payslips into drafts with new amounts, while the expense stayed in the P&L at
    the old one. Past DRAFT the figure is agreed, and the way to change it is to
    put it back to draft, or recall it.
    """
    rows = await db.execute(
        select(Payroll).where(
            Payroll.employee_id == employee_id,
            Payroll.pay_period == label,
            Payroll.status != PayrollStatus.DRAFT.value,
        ).order_by(Payroll.created_at)
    )
    return rows.scalars().first()


def record_range(rec: Payroll) -> tuple[date, date]:
    """The exact dates a payroll row covers (stored, or derived from its label)."""
    return engine.slip_range(rec)


# ── Advances ────────────────────────────────────────────────────────────────
async def create_advance(db: AsyncSession, hotel_id: uuid.UUID, **fields) -> SalaryAdvance:
    adv = SalaryAdvance(hotel_id=hotel_id, **fields)
    db.add(adv)
    await db.commit()
    await db.refresh(adv)
    return adv


async def list_advances(
    db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID | None = None
):
    stmt = select(SalaryAdvance).where(SalaryAdvance.hotel_id == hotel_id)
    if employee_id:
        stmt = stmt.where(SalaryAdvance.employee_id == employee_id)
    result = await db.execute(stmt.order_by(SalaryAdvance.given_date.desc()))
    return list(result.scalars().all())


# ── Process a pay run ─────────────────────────────────────────────────────────
def check_pay_basis(employee: Employee) -> None:
    """Refuse to run pay for somebody who has no rate set.

    `monthly_salary or Decimal("0")` turned a NULL salary into a £0.00 payslip,
    and the run approved it like any other. Live data had four of them:

        Mohamed / Praveen / Rajkumar / Sundar   gross 0.00   APPROVED

    Nobody notices a £0.00 payslip. It is not an empty list — the employee IS in
    the run, with a row, a status and a payslip PDF — so the screen looks
    complete and the person simply is not paid. `sarathkumar` has
    `monthly_salary: null` on production right now.

    Zero is a legitimate NET (somebody who worked no days, or whose advance took
    the lot). It is never a legitimate RATE, which is why the check is here on
    the basis rather than on the result.
    """
    if employee.salary_type == SalaryType.HOURLY.value:
        if not employee.hourly_rate or employee.hourly_rate <= 0:
            raise MissingPayBasisError(
                f"{employee.full_name} has no hourly rate set, so their pay would "
                "come out as £0.00. Set their rate on the Employees page first."
            )
    elif not employee.monthly_salary or employee.monthly_salary <= 0:
        raise MissingPayBasisError(
            f"{employee.full_name} has no monthly salary set, so their pay would "
            "come out as £0.00. Set their salary on the Employees page first."
        )


def _resolve_run(
    employee: Employee, pay_period: str | None, date_from: date | None, date_to: date | None
) -> tuple[str, date, date]:
    """Validate the requested run and return (label, start, end).

    THE RULE (kills double-pay): hourly staff are paid by weekly or custom runs;
    monthly-salaried staff by monthly or custom runs. Nobody can land in both."""
    if date_from and date_to:
        if date_to < date_from:
            raise ValueError("The pay range ends before it starts")
        if (date_to - date_from).days >= MAX_DAYS:
            raise ValueError("A custom pay range can cover at most three months")
        return custom_label(date_from, date_to), date_from, date_to
    if not pay_period:
        raise ValueError("Pick a month, a week, or a custom date range")
    weekly = is_weekly(pay_period)
    if weekly and employee.salary_type != SalaryType.HOURLY.value:
        raise ValueError(
            f"{employee.full_name} is on a monthly salary — weekly runs are for "
            "hourly-paid staff. Run their month (or a custom range) instead."
        )
    if not weekly and employee.salary_type == SalaryType.HOURLY.value:
        raise ValueError(
            f"{employee.full_name} is weekly-paid (hourly rate) — run their week "
            "or a custom date range instead, so they can't be paid twice."
        )
    start, end = period_range(pay_period)
    return pay_period, start, end


async def _label_run(
    db: AsyncSession, hotel_id: uuid.UUID, label: str, start: date, end: date, by
) -> PayrollRun:
    """The one run that holds this period's payslips, made if there is none."""
    rows = await db.execute(
        select(PayrollRun)
        .where(PayrollRun.hotel_id == hotel_id, PayrollRun.setup["label"].astext == label)
        .order_by(PayrollRun.number)
    )
    run = rows.scalars().first()
    if run is None:
        run = await runs.new_run(db, hotel_id, start, end, by=by, setup={"label": label})
    return run


async def _work_out(
    db: AsyncSession,
    hotel: Hotel,
    employee: Employee,
    start: date,
    end: date,
    *,
    working_days: int,
    other_deductions: Decimal,
    min_wage: Decimal,
    ignore_run: uuid.UUID | None,
) -> engine.Worked:
    facts = await engine.gather(
        db, hotel, [employee.id], days_between(start, end), ignore_run=ignore_run
    )
    pick = PersonIn(employee_id=employee.id)
    w = engine.work_out(
        employee, pick, facts, working_days=working_days, min_wage=min_wage
    )
    # A penalty bigger than the pay takes what there is and no more: a payslip
    # cannot be negative.
    off = min(other_deductions, w.pay)
    if off > 0:
        pick.adjustments = [
            AdjustmentIn(kind="DEDUCTION", label="Other deductions", amount=off)
        ]
        w = engine.work_out(
            employee, pick, facts, working_days=working_days, min_wage=min_wage
        )
    return w


async def process_payroll(
    db: AsyncSession,
    employee: Employee,
    pay_period: str | None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    working_days: int = 26,
    other_deductions: Decimal = Decimal("0"),
    processed_by: uuid.UUID | None = None,
    min_wage: Decimal = calculator.MIN_WAGE_UK,
) -> Payroll:
    label, start, end = _resolve_run(employee, pay_period, date_from, date_to)
    hotel = await db.get(Hotel, employee.hotel_id)
    # Two presses of Run queue here, and the second finds the first one's days.
    await runs.lock_hotel(db, employee.hotel_id)
    settled = await settled_payslip(db, employee.id, label)
    if settled:
        raise PayslipSettledError(
            f"{employee.full_name}'s payslip for {label} is already {settled.status.lower()} "
            f"(£{settled.net_pay}). Remove it first if it is wrong."
        )
    check_pay_basis(employee)
    run = await _label_run(db, employee.hotel_id, label, start, end, processed_by)
    # Run again: the draft goes first, and gives its advance back, or the advance
    # would read as already taken and drop off the new one.
    again = (
        await db.execute(
            select(Payroll).where(
                Payroll.employee_id == employee.id, Payroll.run_id == run.id
            )
        )
    ).scalar_one_or_none()
    if again is not None:
        await runs.release_advances(db, employee.hotel_id, [again])
        await db.delete(again)
        await db.flush()

    w = await _work_out(
        db, hotel, employee, start, end, working_days=working_days,
        other_deductions=other_deductions, min_wage=min_wage, ignore_run=run.id,
    )
    clashes = _clashes(w)
    if clashes:
        words = ", ".join(
            f"{c.label} ({c.status.lower()})" for c in clashes[:3]
        )
        raise AlreadyPaidError(
            f"{employee.full_name} already has pay covering these dates: {words}. "
            "Running again would pay them twice."
        )
    if any(f.code == "below_min" for f in w.flags):
        raise calculator.MinWageError(
            f"Hourly rate £{w.rate} is below the minimum wage £{min_wage}"
        )
    rec = await runs.write_slip(
        db, employee.hotel_id, run, w, working_days=working_days, by=processed_by, label=label,
    )
    await db.commit()
    await db.refresh(rec)
    return rec


def _clashes(w: engine.Worked) -> list[engine.Cover]:
    """The payslips that already pay for some of these days, each once."""
    seen: dict[uuid.UUID, engine.Cover] = {}
    for d in w.days:
        if d.in_run is not None:
            seen.setdefault(d.in_run.payslip_id, d.in_run)
    return list(seen.values())


async def get_payroll(
    db: AsyncSession, payroll_id: uuid.UUID, hotel_id: uuid.UUID
) -> Payroll | None:
    rec = await db.get(Payroll, payroll_id)
    if rec is None or rec.hotel_id != hotel_id:
        return None
    return rec


def _row(p: Payroll, e: Employee) -> dict:
    start, end = engine.slip_range(p)
    return {
        "id": p.id,
        "run_id": p.run_id,
        "employee_id": p.employee_id,
        "employee_name": e.full_name,
        "pay_period": p.pay_period,
        "label": say_range(start, end),
        "gross_pay": p.gross_pay,
        "overtime_pay": p.overtime_pay,
        "advance_deduction": p.advance_deduction,
        "other_deductions": p.other_deductions,
        "additions": p.additions,
        "net_pay": p.net_pay,
        "status": p.status,
        "paid_on": p.paid_on,
    }


async def list_payroll(db: AsyncSession, hotel_id: uuid.UUID, pay_period: str) -> list[dict]:
    return [_row(p, e) for p, e in await payroll_records(db, hotel_id, pay_period)]


async def payroll_records(
    db: AsyncSession, hotel_id: uuid.UUID, pay_period: str
) -> list[tuple[Payroll, Employee]]:
    """(Payroll, Employee) ORM pairs for a period — used to build the consolidated PDF
    (needs the full record: days present, hours, etc., not the list dict)."""
    rows = await db.execute(
        select(Payroll, Employee)
        .join(Employee, Payroll.employee_id == Employee.id)
        .where(Payroll.hotel_id == hotel_id, Payroll.pay_period == pay_period)
        .order_by(Employee.full_name)
    )
    return [(p, e) for p, e in rows.all()]


async def run_records(
    db: AsyncSession, hotel_id: uuid.UUID, run_id: uuid.UUID
) -> list[tuple[Payroll, Employee]]:
    """The same for one run, whatever its dates."""
    rows = await db.execute(
        select(Payroll, Employee)
        .join(Employee, Payroll.employee_id == Employee.id)
        .where(Payroll.hotel_id == hotel_id, Payroll.run_id == run_id)
        .order_by(Employee.full_name)
    )
    return [(p, e) for p, e in rows.all()]


async def approve_all(db: AsyncSession, hotel_id: uuid.UUID, pay_period: str, by=None) -> int:
    """Approve every DRAFT payslip in a period at once. Returns how many were approved.

    Approved is agreed and nothing more: no expense, no money. See `runs.pay`.
    """
    res = await db.execute(
        update(Payroll)
        .where(
            Payroll.hotel_id == hotel_id,
            Payroll.pay_period == pay_period,
            Payroll.status == PayrollStatus.DRAFT.value,
            Payroll.held.is_(False),
        )
        .values(
            status=PayrollStatus.APPROVED.value,
            approved_by=getattr(by, "id", None),
            approved_at=datetime.now(UTC),
        )
    )
    await db.commit()
    return res.rowcount or 0


async def preview_payroll(
    db: AsyncSession,
    employee: Employee,
    pay_period: str | None,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
    working_days: int = 26,
    other_deductions: Decimal = Decimal("0"),
    min_wage: Decimal = calculator.MIN_WAGE_UK,
) -> dict:
    """The DRY RUN: everything a run would produce — days, hours, pay, and any
    already-paid clashes — without writing a thing. The UI shows this before
    the human commits."""
    label, start, end = _resolve_run(employee, pay_period, date_from, date_to)
    hotel = await db.get(Hotel, employee.hotel_id)
    # A draft for this very period would be worked out again, so it is no clash.
    mine = (
        await db.execute(
            select(Payroll).where(
                Payroll.employee_id == employee.id,
                Payroll.pay_period == label,
                Payroll.status == PayrollStatus.DRAFT.value,
            )
        )
    ).scalars().first()
    w = await _work_out(
        db, hotel, employee, start, end, working_days=working_days,
        other_deductions=other_deductions, min_wage=min_wage,
        ignore_run=mine.run_id if mine else None,
    )
    ids = [c.payslip_id for c in _clashes(w)]
    settled = await settled_payslip(db, employee.id, label)
    if settled and settled.id not in ids:
        ids.insert(0, settled.id)
    slips = {
        s.id: s for s in (
            await db.execute(select(Payroll).where(Payroll.id.in_(ids)))
        ).scalars()
    } if ids else {}
    # A dry run must never raise where the real run would refuse — it is there
    # to REPORT the refusal, with the person's name on it.
    try:
        check_pay_basis(employee)
        blocked = None
    except MissingPayBasisError as exc:
        blocked = str(exc)
    return {
        "employee_id": str(employee.id),
        "employee_name": employee.full_name,
        "salary_type": employee.salary_type,
        "pay_period": label,
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "days_present": sum(1 for d in w.paid_days if d.half_days == 2),
        "half_days": sum(1 for d in w.paid_days if d.half_days == 1),
        "total_hours": str((Decimal(w.minutes) / 60).quantize(Decimal("0.01"))),
        "minutes": w.minutes,
        "overtime_pay": str(w.overtime),
        "gross_pay": str(w.pay),
        "advance_deduction": str(w.advance),
        "other_deductions": str(w.deductions),
        "net_pay": str(w.net),
        # STILL OWED AFTER THIS PAYSLIP. Shown on the dry run because "we could
        # only take £400 of the £3,500" is exactly the thing somebody needs to
        # know BEFORE they approve, not after.
        "advance_outstanding": str(w.advance_due - w.advance),
        # WHY THIS RUN WOULD BE WRONG, in words, before it is committed. The run
        # itself refuses on a missing rate; the dry run has to SAY so, because a
        # preview that shows £0.00 and no explanation is how four people ended
        # up with approved £0.00 payslips nobody questioned.
        "blocked": blocked,
        "already_paid": [
            {
                "pay_period": s.pay_period,
                "status": s.status,
                "net_pay": str(s.net_pay),
                "period_start": record_range(s)[0].isoformat(),
                "period_end": record_range(s)[1].isoformat(),
            }
            for s in (slips[i] for i in ids)
        ],
    }


async def history(db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID) -> list[dict]:
    """Every pay run this person ever had, newest first — the persistent record."""
    rows = await db.execute(
        select(Payroll, PayrollRun)
        .join(PayrollRun, PayrollRun.id == Payroll.run_id, isouter=True)
        .where(Payroll.hotel_id == hotel_id, Payroll.employee_id == employee_id)
        .order_by(Payroll.created_at.desc())
    )
    out = []
    for p, run in rows.all():
        r_start, r_end = record_range(p)
        out.append({
            "id": p.id,
            "run_id": p.run_id,
            "run_number": run.number if run else None,
            "pay_period": p.pay_period,
            "label": say_range(r_start, r_end),
            "pay_period_type": p.pay_period_type,
            "period_start": r_start.isoformat(),
            "period_end": r_end.isoformat(),
            "days_present": p.days_present,
            "half_days": p.half_days,
            "minutes": p.minutes,
            "total_hours": p.total_hours,
            "gross_pay": p.gross_pay,
            "additions": p.additions,
            "advance_deduction": p.advance_deduction,
            "other_deductions": p.other_deductions,
            "net_pay": p.net_pay,
            "status": p.status,
            "paid_on": p.paid_on.isoformat() if p.paid_on else None,
            "paid_method": p.paid_method,
            "paid_reference": p.paid_reference,
            "processed_at": p.processed_at.isoformat() if p.processed_at else None,
        })
    return out


async def history_records(
    db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID
) -> list[tuple[Payroll, Employee]]:
    """(Payroll, Employee) pairs of a person's whole history — feeds the
    consolidated statement PDF."""
    rows = await db.execute(
        select(Payroll, Employee)
        .join(Employee, Payroll.employee_id == Employee.id)
        .where(Payroll.hotel_id == hotel_id, Payroll.employee_id == employee_id)
        .order_by(Payroll.created_at)
    )
    return [(p, e) for p, e in rows.all()]


async def list_payroll_for_employee(
    db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID
) -> list[dict]:
    """One employee's own payslips, newest first (for self-service).

    Drafts are not there: a draft is a sum nobody has agreed to, it changes
    while the run is being put together, and it may be recalled. It is a payslip
    once it is approved.
    """
    rows = await db.execute(
        select(Payroll, Employee)
        .join(Employee, Payroll.employee_id == Employee.id)
        .where(
            Payroll.hotel_id == hotel_id,
            Payroll.employee_id == employee_id,
            Payroll.status != PayrollStatus.DRAFT.value,
        )
        .order_by(Payroll.period_end.desc().nulls_last(), Payroll.created_at.desc())
    )
    return [_row(p, e) for p, e in rows.all()]
