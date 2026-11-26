"""Payroll runs: making one, agreeing it, paying it, and taking it back.

    "When i give approve.. it appearing in expenses... why.... still we didn't
     click mark as paid button.. then what's the use of mark as paid button."

PAID IS THE ONLY STATE THAT REACHES THE BOOKS. `pay()` writes the expense and
`unpay()` and `recall()` take it away again, each in the same transaction as the
payslip's own change, so the two cannot disagree. Nothing else in the app may
write an expense for a wage.

    "we need recall button to remove all traces for safety like by mistake we
     did payroll."

`recall()` leaves one line in the audit log and nothing else.
"""
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditEvent
from app.auth.models import User
from app.core.timezones import hotel_today
from app.employees.models import Attendance, AttendanceStatus, Employee
from app.expenses.models import Expense, ExpenseCategory, ExpenseKind
from app.hotels.models import Hotel
from app.notifications.models import NotificationState
from app.payroll import engine
from app.payroll.models import (
    ParkedWage,
    PayBasis,
    Payroll,
    PayrollAdjustment,
    PayrollAdvanceRecovery,
    PayrollDay,
    PayrollRun,
    PayrollStatus,
    SalaryAdvance,
)
from app.payroll.periods import MAX_DAYS, days_between, label_for, next_range, say_day, say_range
from app.payroll.schemas import RunRequest

ZERO = Decimal("0.00")
_Q2 = Decimal("0.01")

DRAFT = PayrollStatus.DRAFT.value
APPROVED = PayrollStatus.APPROVED.value
PAID = PayrollStatus.PAID.value

#: Where wages land. `expenses.service` knows it by the same name.
WAGES_CATEGORY = "Staff Salaries"
METHOD_WORDS = {"CASH": "cash", "BANK": "bank transfer", "CARD": "card"}
#: What has to be typed to recall a run that money has gone out on.
RECALL_WORD = "RECALL"

PART_APPROVED = "PART_APPROVED"
PART_PAID = "PART_PAID"


class RunError(ValueError):
    """The run cannot be made as asked. → 400."""


class RunConflict(Exception):
    """It could have been, a moment ago, or in another state. → 409."""


class NotThere(Exception):
    """No such run, payslip or person in THIS restaurant. → 404."""


def money(v: Decimal) -> str:
    v = Decimal(v).quantize(_Q2)
    return f"{'-' if v < 0 else ''}£{abs(v):,}"


def _n(count: int, one: str, many: str | None = None) -> str:
    return f"{count} {one if count == 1 else (many or one + 's')}"


# ── dates and people asked for ───────────────────────────────────────────────
def dates_of(req: RunRequest) -> list[date]:
    if req.date_to < req.date_from:
        raise RunError("The dates end before they start")
    if (req.date_to - req.date_from).days >= MAX_DAYS:
        raise RunError("One run can cover at most three months")
    if req.only_dates is not None:
        picked = sorted(set(req.only_dates))
        if not picked:
            raise RunError("Pick at least one day")
        if picked[0] < req.date_from or picked[-1] > req.date_to:
            raise RunError("A picked day is outside the dates of the run")
        return picked
    return days_between(req.date_from, req.date_to)


async def _people(
    db: AsyncSession, hotel_id: uuid.UUID, wanted: set[uuid.UUID], dates: list[date]
) -> list[Employee]:
    """Everyone on the team, anyone asked for by name, and whoever has left with
    days in these dates that nobody has paid them for: a final pay."""
    worked = select(Attendance.employee_id).where(
        Attendance.hotel_id == hotel_id,
        Attendance.date >= min(dates),
        Attendance.date <= max(dates),
        Attendance.working_hours > 0,
    )
    rows = await db.execute(
        select(Employee)
        .where(
            Employee.hotel_id == hotel_id,
            or_(
                Employee.is_active.is_(True),
                Employee.id.in_(wanted or {uuid.UUID(int=0)}),
                Employee.id.in_(worked),
            ),
        )
        .order_by(Employee.full_name)
    )
    return list(rows.scalars())


async def preview(
    db: AsyncSession, hotel: Hotel, req: RunRequest, *, ignore_run: uuid.UUID | None = None
) -> list[engine.Worked]:
    """Everybody, worked out, ticked or not. Nothing is written."""
    dates = dates_of(req)
    picks = {p.employee_id: p for p in req.people}
    people = await _people(db, hotel.id, set(picks), dates)
    facts = await engine.gather(
        db, hotel, [e.id for e in people], dates, ignore_run=ignore_run
    )
    out = []
    for emp in people:
        w = engine.work_out(
            emp, picks.get(emp.id), facts,
            run_basis=req.basis, working_days=req.working_days,
            min_wage=hotel.min_hourly_rate,
        )
        # Somebody who has left, with nothing owed: not worth a line.
        if not emp.is_active and emp.id not in picks and not w.has_pay:
            continue
        out.append(w)
    return out


# ── saving ───────────────────────────────────────────────────────────────────
async def lock_hotel(db: AsyncSession, hotel_id: uuid.UUID) -> None:
    """One run is made at a time in one restaurant.

    Pressing Save twice, or two people saving the same week, would each have
    looked, seen Tuesday free, and paid it. The second waits here, and then
    sees it taken. (NO KEY UPDATE: ordinary inserts that only point at the
    hotel are not held up.)
    """
    await db.execute(select(Hotel.id).where(Hotel.id == hotel_id).with_for_update(key_share=True))


async def new_run(
    db: AsyncSession, hotel_id: uuid.UUID, start: date, end: date, *, by, setup: dict
) -> PayrollRun:
    """An empty run with the next number. The caller holds `lock_hotel`."""
    top = await db.scalar(
        select(func.max(PayrollRun.number)).where(PayrollRun.hotel_id == hotel_id)
    )
    run = PayrollRun(
        hotel_id=hotel_id, number=(top or 0) + 1, period_start=start, period_end=end,
        created_by=by, setup=setup,
    )
    db.add(run)
    await db.flush()
    return run


async def save_run(
    db: AsyncSession,
    hotel: Hotel,
    user,
    req: RunRequest,
    *,
    run: PayrollRun | None = None,
    expect_net: Decimal | None = None,
) -> PayrollRun:
    """Make a run, or make a draft one again. All of it, or none of it."""
    dates = dates_of(req)
    if not req.people:
        raise RunError("Tick at least one person")
    ids = [p.employee_id for p in req.people]
    if len(set(ids)) != len(ids):
        raise RunError("Somebody is in the list twice")
    await lock_hotel(db, hotel.id)

    slips: list[Payroll] = []
    if run is not None:
        run = await get_run(db, run.id, hotel.id, lock=True)
        slips = await _slips(db, run.id, lock=True)
        if any(s.status != DRAFT for s in slips):
            raise RunConflict(
                "Somebody in this run is already approved or paid. Put them back to "
                "draft first, or recall the run."
            )
        # Given back before it is worked out again, or an advance taken in the
        # draft would read as already taken and drop off the new one.
        await release_advances(db, hotel.id, slips)

    worked = {
        w.employee.id: w
        for w in await preview(db, hotel, req, ignore_run=run.id if run else None)
    }
    missing = [i for i in ids if i not in worked]
    if missing:
        raise NotThere("Employee not found")
    chosen = [worked[i] for i in ids]
    _refuse(chosen)
    net = sum((w.net for w in chosen), ZERO)
    if expect_net is not None and net != expect_net:
        raise RunConflict(
            f"The figures changed while this was open: {money(expect_net)} is now "
            f"{money(net)}. Nothing was saved. Look again and save."
        )

    setup = req.model_dump(
        mode="json",
        include={
            "date_from", "date_to", "only_dates", "basis", "working_days", "people",
            "note", "everyone", "preset", "week_start",
        },
    )
    if run is None:
        run = await new_run(
            db, hotel.id, min(dates), max(dates), by=user.id, setup=setup
        )
    else:
        for s in slips:
            await db.delete(s)
        run.period_start, run.period_end, run.setup = min(dates), max(dates), setup
    run.note = (req.note or "").strip() or None
    await db.flush()
    for w in chosen:
        await write_slip(
            db, hotel.id, run, w,
            working_days=req.working_days, by=user.id,
        )
    await db.commit()
    await db.refresh(run)
    return run


def _refuse(chosen: list[engine.Worked]) -> None:
    """Nobody goes into a run with something wrong. All of it, by name, at once."""
    clash = [(w, d) for w in chosen for d in w.conflicts]
    if clash:
        w, d = clash[0]
        raise RunConflict(
            f"{w.employee.full_name}, {say_day(d.date)}: {d.in_run.words()}. "
            "Paying it again has to be said about that day. Nothing was saved."
        )
    bad = [w for w in chosen if w.blocked]
    if bad:
        said = "; ".join(
            f"{w.employee.full_name}: " + next(f.text for f in w.flags if f.blocking)
            for w in bad[:3]
        )
        more = f" (and {len(bad) - 3} more)" if len(bad) > 3 else ""
        raise RunError(f"Put this right first, or leave them out. {said}{more}.")


async def write_slip(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    run: PayrollRun,
    w: engine.Worked,
    *,
    working_days: int,
    by: uuid.UUID | None,
    label: str | None = None,
) -> Payroll:
    """One worked-out person, written down: payslip, days, extras, advances."""
    start, end = run.period_start, run.period_end
    label = label or label_for(start, end)
    paid = w.paid_days
    if w.basis == PayBasis.SALARY.value:
        # Shared out over every day of the month: how many they were IN is
        # another question, and the one a payslip answers.
        full = sum(1 for d in paid if d.attendance == AttendanceStatus.PRESENT.value)
        half = sum(1 for d in paid if d.attendance == AttendanceStatus.HALF_DAY.value)
    else:
        full = sum(1 for d in paid if d.half_days == 2)
        half = sum(1 for d in paid if d.half_days == 1)
    slip = Payroll(
        hotel_id=hotel_id,
        employee_id=w.employee.id,
        run_id=run.id,
        pay_period=label,
        pay_period_type="WEEKLY" if "-W" in label else "MONTHLY",
        period_start=start,
        period_end=end,
        working_days=working_days,
        days_present=full,
        half_days=half,
        minutes=w.minutes,
        total_hours=(Decimal(w.minutes) / 60).quantize(_Q2),
        basis=w.basis,
        pay_type=w.pay_type,
        rate=w.rate,
        day_lines=True,
        gross_pay=w.pay,
        overtime_pay=w.overtime,
        additions=w.additions,
        other_deductions=w.deductions,
        advance_deduction=w.advance,
        net_pay=w.net,
        status=DRAFT,
        held=w.hold,
        note=w.note,
        processed_by=by,
        processed_at=datetime.now(UTC),
    )
    db.add(slip)
    await db.flush()
    for d in paid:
        db.add(PayrollDay(
            hotel_id=hotel_id, payroll_id=slip.id, employee_id=w.employee.id, date=d.date,
            minutes=d.minutes, half_days=d.half_days, amount=d.amount,
            typed=d.typed, again=d.again,
        ))
    for i, (kind, name, amount) in enumerate(w.adjustments):
        db.add(PayrollAdjustment(
            hotel_id=hotel_id, payroll_id=slip.id, kind=kind, label=name,
            amount=amount, position=i,
        ))
    await _take_advances(db, hotel_id, slip, end)
    await db.flush()
    return slip


# ── advances ─────────────────────────────────────────────────────────────────
async def _take_advances(
    db: AsyncSession, hotel_id: uuid.UUID, slip: Payroll, end: date
) -> None:
    """Spread what this payslip took back over the advances that are owed.

    What was TAKEN, which is not always what was owed. Marking every advance
    recovered regardless is how a payslip that could afford £400 of £3,500
    forgave the other £3,100. The ones due by now go first, oldest first; each
    share is written down, so that taking the payslip back gives it back.
    """
    left = slip.advance_deduction
    if left <= 0:
        return
    rows = await db.execute(
        select(SalaryAdvance)
        .where(
            SalaryAdvance.hotel_id == hotel_id,
            SalaryAdvance.employee_id == slip.employee_id,
            SalaryAdvance.is_deducted.is_(False),
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    advances = sorted(
        rows.scalars(),
        key=lambda a: (not engine.due_by(a, end), a.given_date, a.created_at),
    )
    for a in advances:
        if left <= 0:
            break
        take = min(engine.left_of(a), left)
        if take > 0:
            a.amount_recovered = (a.amount_recovered or ZERO) + take
            db.add(PayrollAdvanceRecovery(
                hotel_id=hotel_id, payroll_id=slip.id, advance_id=a.id, amount=take,
            ))
            left -= take
        # `>=` rather than `==`: one edited downward after a part recovery would
        # otherwise never close and be asked for for ever.
        a.is_deducted = a.amount_recovered >= a.amount
    await db.flush()


async def release_advances(
    db: AsyncSession, hotel_id: uuid.UUID, slips: list[Payroll]
) -> Decimal:
    """Give back what these payslips took. Returns how much."""
    given = ZERO
    for slip in slips:
        if slip.advance_deduction <= 0:
            continue
        rows = (
            await db.execute(
                select(PayrollAdvanceRecovery, SalaryAdvance)
                .join(SalaryAdvance, SalaryAdvance.id == PayrollAdvanceRecovery.advance_id)
                .where(
                    PayrollAdvanceRecovery.hotel_id == hotel_id,
                    PayrollAdvanceRecovery.payroll_id == slip.id,
                )
                .with_for_update(of=SalaryAdvance)
                .execution_options(populate_existing=True)
            )
        ).all()
        left = slip.advance_deduction
        for rec, adv in rows:
            adv.amount_recovered = max(ZERO, (adv.amount_recovered or ZERO) - rec.amount)
            adv.is_deducted = adv.amount_recovered >= adv.amount
            left -= rec.amount
            given += rec.amount
            await db.delete(rec)
        if not rows:
            given += await _release_unwritten(db, hotel_id, slip, left)
    await db.flush()
    return given


async def _release_unwritten(
    db: AsyncSession, hotel_id: uuid.UUID, slip: Payroll, left: Decimal
) -> Decimal:
    """A payslip from before recoveries were written down.

    It says HOW MUCH it took and not from which advance, so it is put back on
    that person's most recent ones that show anything recovered. The total is
    exact, which is what they owe.
    """
    rows = await db.execute(
        select(SalaryAdvance)
        .where(
            SalaryAdvance.hotel_id == hotel_id,
            SalaryAdvance.employee_id == slip.employee_id,
            SalaryAdvance.amount_recovered > 0,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    given = ZERO
    for adv in sorted(rows.scalars(), key=lambda a: (a.given_date, a.created_at), reverse=True):
        if left <= 0:
            break
        back = min(adv.amount_recovered, left)
        adv.amount_recovered -= back
        adv.is_deducted = adv.amount_recovered >= adv.amount
        left -= back
        given += back
    return given


# ── finding things ───────────────────────────────────────────────────────────
async def get_run(
    db: AsyncSession, run_id: uuid.UUID, hotel_id: uuid.UUID, *, lock: bool = False
) -> PayrollRun:
    q = select(PayrollRun).where(PayrollRun.id == run_id, PayrollRun.hotel_id == hotel_id)
    if lock:
        q = q.with_for_update().execution_options(populate_existing=True)
    run = (await db.execute(q)).scalar_one_or_none()
    if run is None:
        raise NotThere("Payroll run not found")
    return run


async def get_slip(
    db: AsyncSession, payslip_id: uuid.UUID, hotel_id: uuid.UUID, *, lock: bool = False
) -> Payroll:
    q = select(Payroll).where(Payroll.id == payslip_id, Payroll.hotel_id == hotel_id)
    if lock:
        q = q.with_for_update().execution_options(populate_existing=True)
    slip = (await db.execute(q)).scalar_one_or_none()
    if slip is None:
        raise NotThere("Payslip not found")
    return slip


async def _slips(
    db: AsyncSession, run_id: uuid.UUID, *, lock: bool = False
) -> list[Payroll]:
    """A run's payslips. Locked, always in the same order, so two people pressing
    two buttons queue instead of deadlocking."""
    q = select(Payroll).where(Payroll.run_id == run_id).order_by(Payroll.id)
    if lock:
        q = q.with_for_update().execution_options(populate_existing=True)
    return list((await db.execute(q)).scalars())


def _pick(slips: list[Payroll], ids: list[uuid.UUID] | None) -> list[Payroll] | None:
    """Those asked for by name, or None when it was not by name."""
    if ids is None:
        return None
    by_id = {s.id: s for s in slips}
    if any(i not in by_id for i in ids):
        raise NotThere("Payslip not found in this run")
    return [by_id[i] for i in dict.fromkeys(ids)]


async def _names(db: AsyncSession, slips: list[Payroll]) -> dict[uuid.UUID, str]:
    ids = {s.employee_id for s in slips}
    if not ids:
        return {}
    rows = await db.execute(select(Employee.id, Employee.full_name).where(Employee.id.in_(ids)))
    return dict(rows.all())


# ── agreeing ─────────────────────────────────────────────────────────────────
async def approve(
    db: AsyncSession, hotel_id: uuid.UUID, run_id: uuid.UUID, ids: list[uuid.UUID] | None, by
) -> list[Payroll]:
    """Draft → approved. Nothing else anywhere changes: no money has moved."""
    await get_run(db, run_id, hotel_id, lock=True)
    slips = await _slips(db, run_id, lock=True)
    named = _pick(slips, ids)
    todo = [s for s in (named if named is not None else slips) if s.status == DRAFT]
    if named is None:
        todo = [s for s in todo if not s.held]
    elif any(s.held for s in todo):
        names = await _names(db, todo)
        who = next(names[s.employee_id] for s in todo if s.held)
        raise RunConflict(f"{who} is on hold. Let them go first.")
    _approve(todo, by)
    await db.commit()
    return todo


def _approve(slips: list[Payroll], by) -> None:
    for s in slips:
        s.status = APPROVED
        s.approved_by = by.id if by else None
        s.approved_at = datetime.now(UTC)


async def approve_one(
    db: AsyncSession, hotel_id: uuid.UUID, payslip_id: uuid.UUID, by
) -> Payroll:
    """One payslip, by itself. Approving it twice is the same as once."""
    slip = await get_slip(db, payslip_id, hotel_id, lock=True)
    if slip.held:
        raise RunConflict("They are on hold. Let them go first.")
    if slip.status == DRAFT:
        _approve([slip], by)
    await db.commit()
    return slip


async def unapprove(
    db: AsyncSession, hotel_id: uuid.UUID, run_id: uuid.UUID, ids: list[uuid.UUID] | None
) -> list[Payroll]:
    """Approved → draft, to be changed. A paid one is left as it is."""
    await get_run(db, run_id, hotel_id, lock=True)
    slips = await _slips(db, run_id, lock=True)
    named = _pick(slips, ids)
    if named and any(s.status == PAID for s in named):
        raise RunConflict("They have been paid. Undo the payment first.")
    todo = [s for s in (named if named is not None else slips) if s.status == APPROVED]
    for s in todo:
        s.status, s.approved_by, s.approved_at = DRAFT, None, None
    await db.commit()
    return todo


async def set_hold(
    db: AsyncSession, hotel_id: uuid.UUID, payslip_id: uuid.UUID, held: bool
) -> Payroll:
    slip = await get_slip(db, payslip_id, hotel_id, lock=True)
    if slip.status == PAID:
        raise RunConflict("They have already been paid.")
    slip.held = held
    await db.commit()
    return slip


# ── paying ───────────────────────────────────────────────────────────────────
async def wages_category(db: AsyncSession, hotel_id: uuid.UUID) -> ExpenseCategory:
    cat = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.hotel_id == hotel_id, ExpenseCategory.name == WAGES_CATEGORY
        )
    )
    if cat is None:
        cat = ExpenseCategory(
            hotel_id=hotel_id, name=WAGES_CATEGORY, kind=ExpenseKind.FIXED.value
        )
        db.add(cat)
        await db.flush()
    return cat


def _marker(payslip_id: uuid.UUID) -> str:
    return f"[payroll:{payslip_id}]"


async def _expenses_of(
    db: AsyncSession, hotel_id: uuid.UUID, ids: list[uuid.UUID]
) -> list[Expense]:
    """Every expense that is the payment of one of these payslips: the one it is
    linked to, and any the old version wrote with only its marker."""
    if not ids:
        return []
    marks = [Expense.description.contains(_marker(i), autoescape=True) for i in ids]
    rows = await db.execute(
        select(Expense).where(
            Expense.hotel_id == hotel_id, or_(Expense.payroll_id.in_(ids), *marks)
        )
    )
    return list(rows.scalars())


async def _mark_paid(
    db: AsyncSession,
    slip: Payroll,
    name: str,
    *,
    on: date,
    method: str,
    reference: str | None,
    by,
    category_id: uuid.UUID | None = None,
) -> None:
    """One payslip, paid, and its one expense. The caller holds the row lock."""
    slip.status = PAID
    slip.paid_on, slip.paid_method, slip.paid_reference = on, method, reference
    slip.paid_by, slip.paid_at = (by.id if by else None), datetime.now(UTC)
    slip.held = False
    # No money moved, so there is nothing to put in Expenses: an advance that
    # took the whole of it, or a nil payslip from the old version.
    if slip.net_pay <= 0:
        return
    for old in await _expenses_of(db, slip.hotel_id, [slip.id]):
        await db.delete(old)
    await db.flush()
    if category_id is None:
        category_id = (await wages_category(db, slip.hotel_id)).id
    start, end = engine.slip_range(slip)
    words = f"Wages {say_range(start, end)} · {name}"
    if reference:
        words += f" · {reference}"
    db.add(Expense(
        hotel_id=slip.hotel_id,
        category_id=category_id,
        date=on,
        amount=slip.net_pay,
        payment_method=method,
        payroll_id=slip.id,
        created_by=by.id if by else None,
        description=f"{words} {_marker(slip.id)}",
    ))


async def pay(
    db: AsyncSession,
    hotel: Hotel,
    run_id: uuid.UUID,
    ids: list[uuid.UUID] | None,
    *,
    on: date,
    method: str,
    reference: str | None,
    by,
) -> list[Payroll]:
    """Approved → paid, for the whole run or for the people named."""
    await get_run(db, run_id, hotel.id, lock=True)
    slips = await _slips(db, run_id, lock=True)
    todo = _pick(slips, ids)
    if todo is None:
        todo = [s for s in slips if s.status == APPROVED and not s.held]
        if not todo:
            raise RunConflict("Nobody in this run is approved and waiting to be paid.")
    return await _pay(db, hotel, todo, on=on, method=method, reference=reference, by=by)


async def pay_one(
    db: AsyncSession,
    hotel: Hotel,
    payslip_id: uuid.UUID,
    *,
    on: date,
    method: str,
    reference: str | None,
    by,
) -> Payroll:
    slip = await get_slip(db, payslip_id, hotel.id, lock=True)
    await _pay(db, hotel, [slip], on=on, method=method, reference=reference, by=by)
    return slip


async def _pay(
    db: AsyncSession,
    hotel: Hotel,
    todo: list[Payroll],
    *,
    on: date,
    method: str,
    reference: str | None,
    by,
) -> list[Payroll]:
    """These payslips, all of them or none. The caller holds their locks."""
    if on > hotel_today(hotel):
        raise RunError("A payment can't be dated in the future.")
    names = await _names(db, todo)
    for s in todo:
        who = names.get(s.employee_id, "Somebody")
        if s.status == PAID:
            raise RunConflict(
                f"{who} was already paid"
                + (f" on {say_day(s.paid_on)}." if s.paid_on else ".")
            )
        if s.status == DRAFT:
            raise RunConflict(f"{who} is still a draft. Approve it first.")
        if s.held:
            raise RunConflict(f"{who} is on hold. Let them go first.")
    ref = (reference or "").strip() or None
    cat = await wages_category(db, hotel.id)
    for s in todo:
        await _mark_paid(
            db, s, names.get(s.employee_id, "staff"),
            on=on, method=method, reference=ref, by=by, category_id=cat.id,
        )
    await db.execute(
        delete(ParkedWage).where(ParkedWage.payroll_id.in_([s.id for s in todo]))
    )
    await db.commit()
    return todo


async def unpay(
    db: AsyncSession, hotel_id: uuid.UUID, run_id: uuid.UUID, ids: list[uuid.UUID] | None
) -> list[Payroll]:
    """Paid → approved. Its expense goes, and the payment's day, method and
    reference with it."""
    await get_run(db, run_id, hotel_id, lock=True)
    slips = await _slips(db, run_id, lock=True)
    named = _pick(slips, ids)
    todo = [s for s in (named if named is not None else slips) if s.status == PAID]
    if not todo:
        raise RunConflict("Nobody here has been paid.")
    for e in await _expenses_of(db, hotel_id, [s.id for s in todo]):
        await db.delete(e)
    for s in todo:
        s.status = APPROVED
        s.paid_on = s.paid_method = s.paid_reference = s.paid_by = s.paid_at = None
    await db.commit()
    return todo


# ── approved by the old version ──────────────────────────────────────────────
async def legacy(db: AsyncSession, hotel_id: uuid.UUID) -> list[tuple[Payroll, ParkedWage]]:
    """Approved when approval still meant "in Expenses", never marked paid.

    Not the £0.00 ones: there is nothing to have paid.
    """
    rows = await db.execute(
        select(Payroll, ParkedWage)
        .join(ParkedWage, ParkedWage.payroll_id == Payroll.id)
        .where(
            Payroll.hotel_id == hotel_id, Payroll.status == APPROVED, Payroll.net_pay > 0,
        )
        .order_by(ParkedWage.date, Payroll.id)
    )
    return list(rows.all())


async def legacy_paid(
    db: AsyncSession, hotel_id: uuid.UUID, ids: list[uuid.UUID] | None, by
) -> list[Payroll]:
    """"Yes, those were paid": back into Expenses on the day and by the method
    they were booked with, so the months they were in read as they did."""
    rows = await legacy(db, hotel_id)
    if ids is not None:
        rows = [(s, w) for s, w in rows if s.id in set(ids)]
    slips = list((await db.execute(
        select(Payroll)
        .where(Payroll.id.in_([s.id for s, _ in rows]), Payroll.status == APPROVED)
        .order_by(Payroll.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )).scalars())
    if not slips:
        raise RunConflict("There is nothing left to mark as paid.")
    still = {s.id for s in slips}
    names = await _names(db, slips)
    done: dict[uuid.UUID, Payroll] = {}
    for s, w in rows:
        if s.id in done or s.id not in still:
            continue
        done[s.id] = s
        await _mark_paid(
            db, s, names.get(s.employee_id, "staff"),
            on=w.date, method=w.payment_method, reference=None, by=by,
            category_id=w.category_id,
        )
    await db.execute(delete(ParkedWage).where(ParkedWage.payroll_id.in_(list(done))))
    await db.commit()
    return list(done.values())


# ── taking it back ───────────────────────────────────────────────────────────
@dataclass
class Recall:
    """Everything a recall would remove, counted, before anybody is asked."""

    run: PayrollRun
    slips: list[Payroll]
    whole: bool
    names: list[str]
    days: int
    expenses: list[Expense]
    advances: int
    advances_total: Decimal
    adjustments: int
    events: list[uuid.UUID]
    emailed: int

    @property
    def label(self) -> str:
        return say_range(self.run.period_start, self.run.period_end)

    @property
    def net(self) -> Decimal:
        return sum((s.net_pay for s in self.slips), ZERO)

    @property
    def paid(self) -> list[Payroll]:
        return [s for s in self.slips if s.status == PAID]

    @property
    def paid_net(self) -> Decimal:
        return sum((s.net_pay for s in self.paid), ZERO)

    @property
    def expenses_total(self) -> Decimal:
        return sum((e.amount for e in self.expenses), ZERO)

    def lines(self) -> list[str]:
        """What goes, in plain words, with the counts and the pounds."""
        out = [f"{_n(len(self.slips), 'payslip')}, {money(self.net)} in all"]
        if self.expenses:
            # There is a payslip of minus £3,500 in live data, and an expense
            # with it: taking that one out puts costs UP.
            way = "up" if self.expenses_total < 0 else "down"
            out.append(
                f"{_n(len(self.expenses), 'line')} in Expenses, "
                f"{money(self.expenses_total)}. Your costs go {way} by that much"
            )
        if self.days:
            out.append(f"{_n(self.days, 'day')} can be paid again from a new run")
        if self.advances:
            out.append(
                f"{_n(self.advances, 'advance')} put back as owed, "
                f"{money(self.advances_total)}"
            )
        if self.adjustments:
            out.append(_n(self.adjustments, "bonus, deduction or other extra",
                          "bonuses, deductions and other extras"))
        if self.events:
            out.append(f"{_n(len(self.events), 'notification')} and log "
                       f"{'line' if len(self.events) == 1 else 'lines'} about it")
        return out

    def warnings(self) -> list[str]:
        out = []
        if self.paid:
            n = len(self.paid)
            out.append(
                f"{_n(n, 'person', 'people')} {'is' if n == 1 else 'are'} marked as paid, "
                f"{money(self.paid_net)}. Recalling this does not bring the money back."
            )
        if self.emailed:
            n = self.emailed
            out.append(
                f"{_n(n, 'payslip')} {'was' if n == 1 else 'were'} emailed. "
                "An email cannot be called back."
            )
        return out


async def plan_recall(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    run_id: uuid.UUID,
    ids: list[uuid.UUID] | None,
    *,
    lock: bool = False,
) -> Recall:
    run = await get_run(db, run_id, hotel_id, lock=lock)
    everyone = await _slips(db, run_id, lock=lock)
    named = _pick(everyone, ids)
    slips = everyone if named is None else named
    whole = len(slips) == len(everyone)
    sids = [s.id for s in slips]
    names = await _names(db, slips)

    days = await db.scalar(
        select(func.count()).select_from(PayrollDay).where(
            PayrollDay.hotel_id == hotel_id, PayrollDay.payroll_id.in_(sids)
        )
    ) or 0
    for s in slips:
        if not s.day_lines:
            start, end = engine.slip_range(s)
            days += (end - start).days + 1
    adjustments = await db.scalar(
        select(func.count()).select_from(PayrollAdjustment).where(
            PayrollAdjustment.hotel_id == hotel_id, PayrollAdjustment.payroll_id.in_(sids)
        )
    ) or 0
    written = dict((await db.execute(
        select(PayrollAdvanceRecovery.payroll_id, func.count())
        .where(
            PayrollAdvanceRecovery.hotel_id == hotel_id,
            PayrollAdvanceRecovery.payroll_id.in_(sids),
        )
        .group_by(PayrollAdvanceRecovery.payroll_id)
    )).all())
    took = [s for s in slips if s.advance_deduction > 0]
    return Recall(
        run=run,
        slips=slips,
        whole=whole,
        names=sorted(names.get(s.employee_id, "Somebody") for s in slips),
        days=days,
        expenses=await _expenses_of(db, hotel_id, sids),
        advances=sum(written.get(s.id, 1) for s in took),
        advances_total=sum((s.advance_deduction for s in took), ZERO),
        adjustments=adjustments,
        events=await _events_of(db, hotel_id, run, sids, whole=whole),
        emailed=sum(1 for s in slips if s.emailed_at is not None),
    )


async def _events_of(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    run: PayrollRun,
    sids: list[uuid.UUID],
    *,
    whole: bool,
) -> list[uuid.UUID]:
    """The audit lines (and so the notifications, which are read from them) that
    are about this run and nothing else."""
    about = [
        and_(AuditEvent.entity_type == "payroll", AuditEvent.entity_id.in_(sids)),
    ]
    if whole:
        about.append(
            and_(AuditEvent.entity_type == "payroll_run", AuditEvent.entity_id == run.id)
        )
        # The old version named a run only by its label, in words.
        label = (run.setup or {}).get("label")
        if label:
            about.append(and_(
                AuditEvent.action == "payroll.run",
                AuditEvent.summary.startswith(f"Ran payroll for {label}:", autoescape=True),
            ))
            about.append(and_(
                AuditEvent.action == "payroll.approve_all",
                AuditEvent.summary.endswith(f" for {label}", autoescape=True),
            ))
            about.append(and_(
                AuditEvent.action == "payroll.email",
                AuditEvent.summary.endswith(f" for {label}", autoescape=True),
            ))
    rows = await db.execute(
        select(AuditEvent.id).where(
            AuditEvent.hotel_id == hotel_id,
            AuditEvent.action.startswith("payroll."),
            AuditEvent.action != "payroll.recall",
            or_(*about),
        )
    )
    return list(rows.scalars())


async def recall(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    run_id: uuid.UUID,
    ids: list[uuid.UUID] | None,
    *,
    reason: str | None,
    confirm: str | None,
    by,
) -> tuple[int, bool]:
    """Take a run (or some people in it) back, at any stage, as if it had never
    been made. Returns (payslips gone, whether the run itself went).

    ALL OF IT IN ONE TRANSACTION, the audit line included. A recall that took
    the expense and not the payslip, or left no record that it happened, would
    be worse than the mistake it was undoing.
    """
    plan = await plan_recall(db, hotel_id, run_id, ids, lock=True)
    if not plan.slips and not plan.whole:
        raise RunConflict("Pick somebody to recall.")
    why = " ".join((reason or "").split())[:160]
    if plan.paid:
        if (confirm or "").strip().upper() != RECALL_WORD:
            raise RunConflict(
                f"{_n(len(plan.paid), 'person', 'people')} in this run "
                f"{'has' if len(plan.paid) == 1 else 'have'} been paid. Type "
                f"{RECALL_WORD} to recall it all the same."
            )
        if len(why) < 3:
            raise RunConflict("Say why, in a few words. It is kept with the record.")

    for e in plan.expenses:
        await db.delete(e)
    await release_advances(db, hotel_id, plan.slips)
    if plan.events:
        await db.execute(
            delete(NotificationState).where(
                NotificationState.hotel_id == hotel_id,
                NotificationState.key.in_([f"act:{i}" for i in plan.events]),
            )
        )
        await db.execute(
            delete(AuditEvent).where(
                AuditEvent.hotel_id == hotel_id, AuditEvent.id.in_(plan.events)
            )
        )
    await db.flush()
    for s in plan.slips:
        # Its days, extras and recoveries go with it, in the database.
        await db.delete(s)
    await db.flush()
    run_number, label = plan.run.number, plan.label
    if plan.whole:
        await db.delete(plan.run)
    else:
        _forget(plan.run, plan.slips)
    db.add(AuditEvent(
        hotel_id=hotel_id,
        user_id=getattr(by, "id", None),
        user_email=getattr(by, "email", "") or "",
        action="payroll.recall",
        summary=_recall_line(plan, run_number, label, why)[:300],
        entity_type="payroll_run",
        # Not the run's id: nothing is there any more, and a later run's own
        # tidying must never take this line with it.
        entity_id=None,
    ))
    await db.commit()
    return len(plan.slips), plan.whole


def _recall_line(plan: Recall, number: int, label: str, why: str) -> str:
    who = plan.names[0] if len(plan.names) == 1 else _n(len(plan.names), "person", "people")
    head = f"Recalled payroll run {number} ({label}): {who}, {money(plan.net)}"
    if plan.paid:
        head += f", of which {money(plan.paid_net)} was marked paid"
    return head + (f". Why: {why}" if why else ". No reason given")


async def take_out(
    db: AsyncSession, hotel_id: uuid.UUID, payslip_id: uuid.UUID
) -> tuple[str, Decimal, uuid.UUID | None]:
    """Take one unpaid person out of a run. Their days are free again."""
    slip = await get_slip(db, payslip_id, hotel_id, lock=True)
    if slip.status == PAID:
        raise RunConflict("They have been paid. Use Recall, which asks why.")
    name = (await _names(db, [slip])).get(slip.employee_id, "staff")
    net, run_id = slip.net_pay, slip.run_id
    for e in await _expenses_of(db, hotel_id, [slip.id]):
        await db.delete(e)
    await release_advances(db, hotel_id, [slip])
    await db.delete(slip)
    await db.flush()
    if run_id is not None:
        left = await db.scalar(
            select(func.count()).select_from(Payroll).where(Payroll.run_id == run_id)
        )
        run = await db.get(PayrollRun, run_id)
        if not left:
            await db.delete(run)
        else:
            _forget(run, [slip])
    await db.commit()
    return name, net, run_id


def _forget(run: PayrollRun, slips: list[Payroll]) -> None:
    """Out of what the run was asked for, too: opened again to be changed, it
    must not put somebody back who was taken out."""
    if "people" not in (run.setup or {}):
        return
    gone = {str(s.employee_id) for s in slips}
    people = [p for p in run.setup["people"] if p.get("employee_id") not in gone]
    run.setup = {**run.setup, "people": people, "everyone": False}


# ── reading ──────────────────────────────────────────────────────────────────
def run_status(slips: list[Payroll]) -> str:
    n = len(slips)
    paid = sum(1 for s in slips if s.status == PAID)
    approved = sum(1 for s in slips if s.status == APPROVED)
    if n and paid == n:
        return PAID
    if paid:
        return PART_PAID
    if n and approved == n:
        return APPROVED
    if approved:
        return PART_APPROVED
    return DRAFT


def status_text(slips: list[Payroll]) -> str:
    """The run's state, the way somebody would say it."""
    n = len(slips)
    paid = sum(1 for s in slips if s.status == PAID)
    approved = sum(1 for s in slips if s.status == APPROVED)
    return {
        PAID: "Paid",
        PART_PAID: f"Part paid ({paid} of {n})",
        APPROVED: "Approved, not paid yet",
        PART_APPROVED: f"Part approved ({approved} of {n})",
        DRAFT: "Draft",
    }[run_status(slips)]


def run_row(
    run: PayrollRun,
    slips: list[Payroll],
    names: dict[uuid.UUID, str],
    made_by: str | None,
) -> dict:
    paid = [s for s in slips if s.status == PAID]
    net = sum((s.net_pay for s in slips), ZERO)
    paid_net = sum((s.net_pay for s in paid), ZERO)
    draft = sum(1 for s in slips if s.status == DRAFT)
    return {
        "id": run.id,
        "number": run.number,
        "label": say_range(run.period_start, run.period_end),
        "date_from": run.period_start,
        "date_to": run.period_end,
        "status": run_status(slips),
        "status_text": status_text(slips),
        "note": run.note,
        "created_at": run.created_at,
        "created_by": made_by,
        "people": len(slips),
        "names": sorted(names.get(s.employee_id, "Somebody") for s in slips),
        "draft": draft,
        "approved": sum(1 for s in slips if s.status == APPROVED),
        "paid": len(paid),
        "held": sum(1 for s in slips if s.held),
        "gross": sum((s.gross_pay for s in slips), ZERO),
        "additions": sum((s.additions for s in slips), ZERO),
        "deductions": sum((s.other_deductions + s.advance_deduction for s in slips), ZERO),
        "net": net,
        "draft_net": sum((s.net_pay for s in slips if s.status == DRAFT), ZERO),
        "approved_net": sum((s.net_pay for s in slips if s.status == APPROVED), ZERO),
        "paid_net": paid_net,
        "unpaid_net": net - paid_net,
        "last_paid_on": max((s.paid_on for s in paid if s.paid_on), default=None),
        "can_change": bool(slips) and draft == len(slips)
        and "people" in (run.setup or {}),
    }


async def list_runs(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    status: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    employee_id: uuid.UUID | None = None,
) -> list[dict]:
    """Every run, newest dates first, narrowed. A run belongs to a range it
    OVERLAPS: a month that starts before it and ends inside it is in it."""
    q = select(PayrollRun).where(PayrollRun.hotel_id == hotel_id)
    if date_from:
        q = q.where(PayrollRun.period_end >= date_from)
    if date_to:
        q = q.where(PayrollRun.period_start <= date_to)
    if employee_id:
        q = q.where(PayrollRun.id.in_(
            select(Payroll.run_id).where(
                Payroll.hotel_id == hotel_id, Payroll.employee_id == employee_id
            )
        ))
    runs = list((await db.execute(
        q.order_by(PayrollRun.period_end.desc(), PayrollRun.number.desc())
    )).scalars())
    if not runs:
        return []
    by_run: dict[uuid.UUID, list[Payroll]] = {r.id: [] for r in runs}
    rows = await db.execute(
        select(Payroll).where(Payroll.hotel_id == hotel_id, Payroll.run_id.in_(list(by_run)))
    )
    everybody = list(rows.scalars())
    for s in everybody:
        by_run[s.run_id].append(s)
    names = await _names(db, everybody)
    makers = await _emails(db, {r.created_by for r in runs})
    out = [run_row(r, by_run[r.id], names, makers.get(r.created_by)) for r in runs]
    if status:
        want = {
            "DRAFT": {DRAFT},
            "APPROVED": {APPROVED, PART_APPROVED},
            "PART_PAID": {PART_PAID},
            "PAID": {PAID},
            "UNPAID": {DRAFT, APPROVED, PART_APPROVED, PART_PAID},
        }.get(status, {status})
        out = [r for r in out if r["status"] in want]
    return out


async def _emails(db: AsyncSession, ids: set) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.email).where(User.id.in_(ids)))
    return dict(rows.all())


def totals(rows: list[dict]) -> dict:
    return {
        "runs": len(rows),
        "people": sum(r["people"] for r in rows),
        "gross": sum((r["gross"] for r in rows), ZERO),
        "net": sum((r["net"] for r in rows), ZERO),
        "draft_net": sum((r["draft_net"] for r in rows), ZERO),
        "approved_net": sum((r["approved_net"] for r in rows), ZERO),
        "paid_net": sum((r["paid_net"] for r in rows), ZERO),
        "unpaid_net": sum((r["unpaid_net"] for r in rows), ZERO),
    }


async def slip_rows(db: AsyncSession, hotel_id: uuid.UUID, slips: list[Payroll]) -> list[dict]:
    """Payslips as the page reads them, by name."""
    if not slips:
        return []
    ids = [s.id for s in slips]
    emps = {
        e.id: e for e in (
            await db.execute(
                select(Employee).where(Employee.id.in_({s.employee_id for s in slips}))
            )
        ).scalars()
    }
    logins = {
        u.id: u for u in (
            await db.execute(
                select(User).where(
                    User.hotel_id == hotel_id,
                    User.id.in_({e.user_id for e in emps.values() if e.user_id}),
                )
            )
        ).scalars()
    }
    extras = await adjustments_of(db, hotel_id, ids)
    parked = dict((await db.execute(
        select(ParkedWage.payroll_id, func.min(ParkedWage.date))
        .where(ParkedWage.hotel_id == hotel_id, ParkedWage.payroll_id.in_(ids))
        .group_by(ParkedWage.payroll_id)
    )).all())
    out = []
    for s in slips:
        e = emps.get(s.employee_id)
        login = logins.get(e.user_id) if e and e.user_id else None
        start, end = engine.slip_range(s)
        out.append({
            "id": s.id,
            "run_id": s.run_id,
            "employee_id": s.employee_id,
            "employee_name": e.full_name if e else "Somebody",
            "employee_code": e.employee_code if e else "",
            "job_title": e.job_title if e else None,
            "has_email": bool(login and login.email),
            "pay_period": s.pay_period,
            "label": say_range(start, end),
            "basis": s.basis,
            "pay_type": s.pay_type,
            "rate": s.rate,
            "days": s.days_present,
            "half_days": s.half_days,
            "minutes": s.minutes,
            "gross_pay": s.gross_pay,
            "overtime_pay": s.overtime_pay,
            "additions": s.additions,
            "other_deductions": s.other_deductions,
            "advance_deduction": s.advance_deduction,
            "net_pay": s.net_pay,
            "status": s.status,
            "held": s.held,
            "note": s.note,
            "adjustments": [
                {"kind": a.kind, "label": a.label, "amount": a.amount}
                for a in extras.get(s.id, [])
            ],
            "paid_on": s.paid_on,
            "paid_method": s.paid_method,
            "paid_reference": s.paid_reference,
            "emailed_at": s.emailed_at,
            "was_booked_on": parked.get(s.id),
        })
    return sorted(out, key=lambda r: r["employee_name"].lower())


async def adjustments_of(
    db: AsyncSession, hotel_id: uuid.UUID, ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[PayrollAdjustment]]:
    out: dict[uuid.UUID, list[PayrollAdjustment]] = {}
    if not ids:
        return out
    rows = await db.execute(
        select(PayrollAdjustment)
        .where(PayrollAdjustment.hotel_id == hotel_id, PayrollAdjustment.payroll_id.in_(ids))
        .order_by(PayrollAdjustment.position)
    )
    for a in rows.scalars():
        out.setdefault(a.payroll_id, []).append(a)
    return out


async def run_detail(db: AsyncSession, hotel_id: uuid.UUID, run_id: uuid.UUID) -> dict:
    run = await get_run(db, run_id, hotel_id)
    slips = await _slips(db, run.id)
    names = await _names(db, slips)
    makers = await _emails(db, {run.created_by})
    return {
        **run_row(run, slips, names, makers.get(run.created_by)),
        "slips": await slip_rows(db, hotel_id, slips),
        "setup": run.setup or {},
    }


async def slip_detail(db: AsyncSession, hotel_id: uuid.UUID, payslip_id: uuid.UUID) -> dict:
    slip = await get_slip(db, payslip_id, hotel_id)
    row = (await slip_rows(db, hotel_id, [slip]))[0]
    run = await db.get(PayrollRun, slip.run_id) if slip.run_id else None
    days = await db.execute(
        select(PayrollDay)
        .where(PayrollDay.hotel_id == hotel_id, PayrollDay.payroll_id == slip.id)
        .order_by(PayrollDay.date)
    )
    return {
        **row,
        "day_lines": slip.day_lines,
        "run_number": run.number if run else None,
        "day_list": [
            {
                "date": d.date, "minutes": d.minutes, "half_days": d.half_days,
                "amount": d.amount, "typed": d.typed, "again": d.again,
            }
            for d in days.scalars()
        ],
    }


async def next_run(db: AsyncSession, hotel: Hotel, run: PayrollRun) -> dict:
    """The same people, the same way, the dates that come next.

    Extras are NOT carried: a bonus copied without being thought about is how
    somebody gets it twice. Neither are typed days. A typed AMOUNT is, because
    paying the same figure every week is what it is for.
    """
    setup = run.setup or {}
    only = setup.get("only_dates")
    start, end = next_range(run.period_start, run.period_end)
    people = []
    if "people" in setup:
        for p in setup["people"]:
            keep = {k: p.get(k) for k in ("employee_id", "basis", "rate", "minutes", "amount")}
            people.append({k: v for k, v in keep.items() if v is not None})
    else:
        rows = await db.execute(select(Payroll.employee_id).where(Payroll.run_id == run.id))
        people = [{"employee_id": str(i)} for i in rows.scalars()]
    # Whoever has left since, or was removed, is not carried on.
    here = {
        str(i) for i in (
            await db.execute(
                select(Employee.id).where(
                    Employee.hotel_id == hotel.id, Employee.is_active.is_(True)
                )
            )
        ).scalars()
    }
    people = [p for p in people if str(p["employee_id"]) in here]
    request = {
        "date_from": start,
        "date_to": end,
        "basis": setup.get("basis") or PayBasis.AUTO.value,
        "working_days": setup.get("working_days") or 26,
        "people": people,
        "everyone": bool(setup.get("everyone")),
        "preset": None,
        "week_start": setup.get("week_start"),
    }
    if only:
        # Single days move on by the length of the run, keeping their weekdays.
        shift = start - run.period_start
        request["only_dates"] = [date.fromisoformat(d) + shift for d in only]
        request["date_from"] = min(request["only_dates"])
        request["date_to"] = max(request["only_dates"])
    return {
        "from_run": run.id,
        "from_number": run.number,
        "from_label": say_range(run.period_start, run.period_end),
        "from_preset": setup.get("preset"),
        "request": request,
    }


async def last_run(db: AsyncSession, hotel_id: uuid.UUID) -> PayrollRun | None:
    """The run whose choices a new one starts from: the last one put together
    by hand, and the last of any kind when there is none of those yet."""
    rows = await db.execute(
        select(PayrollRun)
        .where(PayrollRun.hotel_id == hotel_id)
        .order_by(
            PayrollRun.setup.has_key("people").desc(),
            PayrollRun.created_at.desc(),
            PayrollRun.number.desc(),
        )
        .limit(1)
    )
    return rows.scalar_one_or_none()


# ── who is owed what so far ──────────────────────────────────────────────────
#: How far back "so far" goes. A quarter: the most one run can cover.
OWED_DAYS = MAX_DAYS


async def owed(db: AsyncSession, hotel: Hotel) -> dict:
    """Everybody's days that are in no run yet, and what they come to.

    Worked out exactly as a run would, so "£412 owed" is what pressing Start
    then shows.
    """
    today = hotel_today(hotel)
    since = today - timedelta(days=OWED_DAYS - 1)
    req = RunRequest(date_from=since, date_to=today)
    worked = await preview(db, hotel, req)
    ids = [w.employee.id for w in worked]

    waiting = dict((await db.execute(
        select(Payroll.employee_id, func.sum(Payroll.net_pay))
        .where(
            Payroll.hotel_id == hotel.id, Payroll.status != PAID, Payroll.employee_id.in_(ids)
        )
        .group_by(Payroll.employee_id)
    )).all()) if ids else {}
    paid_to: dict[uuid.UUID, date] = {}
    paid_on: dict[uuid.UUID, date] = {}
    if ids:
        last_day = (
            select(PayrollDay.payroll_id, func.max(PayrollDay.date).label("d"))
            .where(PayrollDay.hotel_id == hotel.id)
            .group_by(PayrollDay.payroll_id)
            .subquery()
        )
        rows = await db.execute(
            select(Payroll, last_day.c.d)
            .join(last_day, last_day.c.payroll_id == Payroll.id, isouter=True)
            .where(
                Payroll.hotel_id == hotel.id, Payroll.status == PAID,
                Payroll.employee_id.in_(ids),
            )
        )
        for s, d in rows.all():
            if d is None and s.day_lines:
                continue  # a bonus on its own: no days were paid
            to = d or engine.slip_range(s)[1]
            emp = s.employee_id
            paid_to[emp] = max(to, paid_to.get(emp, to))
            if s.paid_on:
                paid_on[emp] = max(s.paid_on, paid_on.get(emp, s.paid_on))

    people = []
    for w in worked:
        days = [d for d in w.paid_days if d.minutes or d.half_days]
        wait = waiting.get(w.employee.id) or ZERO
        advance = w.advance_owed
        open_days = [f for f in w.flags if f.code in (
            "no_clock_out", "no_hours", "marked_off", "long_day", "no_rate", "below_min",
        )]
        if not days and not wait and not open_days:
            continue
        people.append({
            "employee_id": w.employee.id,
            "name": w.employee.full_name,
            "job_title": w.employee.job_title,
            "active": w.employee.is_active,
            "pay_type": w.pay_type,
            "days": sum(1 for d in days if d.half_days != 1),
            "half_days": sum(1 for d in days if d.half_days == 1),
            "minutes": sum(d.minutes for d in days),
            "estimate": w.pay,
            "first_day": min((d.date for d in days), default=None),
            "last_day": max((d.date for d in days), default=None),
            "paid_to": paid_to.get(w.employee.id),
            "paid_on": paid_on.get(w.employee.id),
            "waiting": wait,
            "advance_owed": advance,
            # The rate is only worth saying when there is work to pay at it.
            "flags": [
                {
                    "code": f.code, "text": f.text, "blocking": f.blocking,
                    "dates": f.dates, "rota": f.rota,
                }
                for f in open_days
                if days or f.code not in ("no_rate", "below_min")
            ],
        })
    people = [p for p in people if p["days"] or p["half_days"] or p["waiting"] or p["flags"]]
    people.sort(key=lambda p: (-p["estimate"], p["name"].lower()))
    return {
        "date_from": since,
        "date_to": today,
        "people": people,
        "days": sum(p["days"] + p["half_days"] for p in people),
        "estimate": sum((p["estimate"] for p in people), ZERO),
        "waiting": sum((p["waiting"] for p in people), ZERO),
    }


# ── out of the app ───────────────────────────────────────────────────────────
def hhmm(minutes: int) -> str:
    """7h 20m, as a spreadsheet can add it up: 7:20."""
    return f"{minutes // 60}:{minutes % 60:02d}"


def _cell(v) -> str:
    """A name typed as "=cmd()" must arrive in a spreadsheet as a name."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


async def run_csv(db: AsyncSession, hotel_id: uuid.UUID, run_id: uuid.UUID) -> tuple[str, bytes]:
    import csv
    import io

    d = await run_detail(db, hotel_id, run_id)
    buf = io.StringIO()
    out = csv.writer(buf)
    out.writerow([f"Payroll run {d['number']}", d["label"], d["status_text"]])
    out.writerow([])
    out.writerow([
        "Person", "Code", "Job", "Worked out from", "Days", "Half days", "Hours", "Rate",
        "Pay", "Of which overtime", "Added", "Taken off", "Advance taken back", "Net",
        "Status", "Paid on", "Paid by", "Reference", "Extras", "Note",
    ])
    basis = {
        "ATTENDANCE": "Attendance", "ROTA": "Rota", "SALARY": "Salary", "MANUAL": "Typed",
    }
    for s in d["slips"]:
        out.writerow([
            _cell(s["employee_name"]), _cell(s["employee_code"]), _cell(s["job_title"]),
            basis.get(s["basis"], s["basis"]), s["days"], s["half_days"], hhmm(s["minutes"]),
            s["rate"] if s["rate"] is not None else "",
            s["gross_pay"], s["overtime_pay"], s["additions"], s["other_deductions"],
            s["advance_deduction"], s["net_pay"],
            "On hold" if s["held"] else s["status"].capitalize(),
            s["paid_on"] or "", METHOD_WORDS.get(s["paid_method"] or "", s["paid_method"] or ""),
            _cell(s["paid_reference"]),
            _cell("; ".join(f"{a['label']} {a['amount']:+}" for a in s["adjustments"])),
            _cell(s["note"]),
        ])
    out.writerow([])
    out.writerow([
        "Total", "", "", "", "", "", hhmm(sum(s["minutes"] for s in d["slips"])), "",
        d["gross"], sum((s["overtime_pay"] for s in d["slips"]), ZERO), d["additions"],
        sum((s["other_deductions"] for s in d["slips"]), ZERO),
        sum((s["advance_deduction"] for s in d["slips"]), ZERO), d["net"],
    ])
    out.writerow([])
    out.writerow(["Day by day"])
    out.writerow(["Person", "Day", "Hours", "Amount", ""])
    rows = await db.execute(
        select(PayrollDay, Employee.full_name)
        .join(Payroll, Payroll.id == PayrollDay.payroll_id)
        .join(Employee, Employee.id == PayrollDay.employee_id)
        .where(PayrollDay.hotel_id == hotel_id, Payroll.run_id == run_id)
        .order_by(Employee.full_name, PayrollDay.date)
    )
    for day, name in rows.all():
        out.writerow([
            _cell(name), day.date, hhmm(day.minutes), day.amount,
            "typed by hand" if day.typed else "",
        ])
    # With a BOM, or Excel reads the pound sign in a note as two other letters.
    name = f"payroll-run-{d['number']}-{d['date_from']}-to-{d['date_to']}.csv"
    return name, buf.getvalue().encode("utf-8-sig")
