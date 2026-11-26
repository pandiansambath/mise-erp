"""What a run would pay, worked out person by person and day by day. Writes nothing.

ONE ENGINE. The live preview, the saved run, "who is owed what" and the old
one-period run all come through `work_out`, so the number somebody agrees to on
the screen is the number that is saved. They were two copies once, and the
preview showed a deduction the run then did not take.

WHAT COUNTS, for each of the bases:

    ATTENDANCE  hourly staff: the minutes they worked, at their rate, per day.
                salaried staff: the days they came in (and the halves), at
                salary ÷ working days, with time past 8 hours at time and a half.
    ROTA        the same, from what the rota planned instead.
    SALARY      the monthly salary shared over the days of the month, so a whole
                month is the salary exactly and a week is its share of it.
    MANUAL      what somebody typed. The days are only "settled by" it.

WHICH DAYS. A day that is already in a run is left out, whatever the basis, and
goes back in only when somebody says "pay it again" about that very day.
"""
import uuid
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from fractions import Fraction

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezones import hotel_now, zone_of
from app.employees.models import (
    Attendance,
    AttendanceStatus,
    Employee,
    Leave,
    LeaveStatus,
    SalaryType,
)
from app.payroll import calculator as calc
from app.payroll.models import (
    PayBasis,
    Payroll,
    PayrollDay,
    PayrollRun,
    PayrollStatus,
    SalaryAdvance,
)
from app.payroll.periods import days_between, period_range, say_day, say_range
from app.payroll.schemas import DayPick, PersonIn
from app.rota.models import Shift

ZERO = Decimal("0.00")
#: Nobody works this long by intention: a clock-out that came the next morning.
LONG_DAY_MINUTES = 16 * 60
#: Clocked in this recently with no clock-out yet is a shift, not a mistake.
ON_SHIFT = timedelta(hours=16)

_ADDS = {"BONUS", "TIPS", "REIMBURSEMENT", "OTHER"}


# ── what is known ────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Cover:
    """The payslip that already pays somebody for a day."""

    payslip_id: uuid.UUID
    run_id: uuid.UUID | None
    number: int | None
    label: str
    status: str

    def words(self) -> str:
        where = f"run {self.number}" if self.number else "a run"
        return f"already in {where} ({self.label}, {self.status.lower()})"


@dataclass
class Facts:
    """Everything the sums need, read once for everybody."""

    hotel: object
    dates: list[date]
    now: datetime
    attendance: dict[tuple[uuid.UUID, date], Attendance] = field(default_factory=dict)
    rota: dict[tuple[uuid.UUID, date], int] = field(default_factory=dict)
    leave: dict[tuple[uuid.UUID, date], str] = field(default_factory=dict)
    covered: dict[tuple[uuid.UUID, date], Cover] = field(default_factory=dict)
    #: Outstanding advances, oldest first.
    advances: dict[uuid.UUID, list[SalaryAdvance]] = field(default_factory=dict)
    #: Days outside the run's own dates that are on one person's payslip all the
    #: same: the days of an unfinished earlier run, taken into this one.
    extra: dict[uuid.UUID, list[date]] = field(default_factory=dict)

    def dates_for(self, employee_id: uuid.UUID) -> list[date]:
        more = self.extra.get(employee_id)
        return sorted(set(self.dates) | set(more)) if more else self.dates

    @property
    def today(self) -> date:
        return self.now.date()


def rota_minutes(shift: Shift, tz) -> int:
    """How long a planned shift really lasts, break taken off.

    Through the restaurant's own clock: a shift that ends before it starts ends
    the next morning, and one that crosses the night the clocks change is an
    hour longer or shorter than it reads. People work the hour, not the clock.
    """
    start = datetime.combine(shift.date, shift.start_time, tzinfo=tz)
    end_day = shift.date
    if shift.end_time <= shift.start_time:
        end_day += timedelta(days=1)
    end = datetime.combine(end_day, shift.end_time, tzinfo=tz)
    span = end.astimezone(UTC) - start.astimezone(UTC)
    return max(0, int(span.total_seconds() // 60) - (shift.break_minutes or 0))


async def gather(
    db: AsyncSession,
    hotel,
    employee_ids: list[uuid.UUID],
    dates: list[date],
    *,
    ignore_run: uuid.UUID | None = None,
    extra: dict[uuid.UUID, list[date]] | None = None,
) -> Facts:
    """Read the attendance, rota, leave, runs and advances these sums need."""
    # autoflush is off in this app: what this very transaction has just written
    # must be visible to the questions below.
    await db.flush()
    facts = Facts(hotel=hotel, dates=dates, now=hotel_now(hotel), extra=dict(extra or {}))
    if not dates or not employee_ids:
        return facts
    every = set(dates).union(*facts.extra.values()) if facts.extra else set(dates)
    lo, hi = min(every), max(every)

    rows = await db.execute(
        select(Attendance)
        .where(
            Attendance.hotel_id == hotel.id,
            Attendance.employee_id.in_(employee_ids),
            Attendance.date >= lo,
            Attendance.date <= hi,
        )
        .execution_options(populate_existing=True)
    )
    for a in rows.scalars():
        facts.attendance[(a.employee_id, a.date)] = a

    tz = zone_of(hotel)
    rows = await db.execute(
        select(Shift).where(
            Shift.hotel_id == hotel.id,
            Shift.employee_id.in_(employee_ids),
            Shift.date >= lo,
            Shift.date <= hi,
        )
    )
    for s in rows.scalars():
        key = (s.employee_id, s.date)
        facts.rota[key] = facts.rota.get(key, 0) + rota_minutes(s, tz)

    rows = await db.execute(
        select(Leave).where(
            Leave.hotel_id == hotel.id,
            Leave.employee_id.in_(employee_ids),
            Leave.status == LeaveStatus.APPROVED.value,
            Leave.start_date <= hi,
            Leave.end_date >= lo,
        )
    )
    for lv in rows.scalars():
        for d in days_between(max(lv.start_date, lo), min(lv.end_date, hi)):
            facts.leave[(lv.employee_id, d)] = (lv.kind or "").lower()

    facts.covered = await covered_days(
        db, hotel.id, lo, hi, employee_ids=employee_ids, ignore_run=ignore_run
    )

    rows = await db.execute(
        select(SalaryAdvance)
        .where(
            SalaryAdvance.hotel_id == hotel.id,
            SalaryAdvance.employee_id.in_(employee_ids),
            SalaryAdvance.is_deducted.is_(False),
        )
        .execution_options(populate_existing=True)
    )
    for adv in sorted(rows.scalars(), key=lambda a: (a.given_date, a.created_at)):
        facts.advances.setdefault(adv.employee_id, []).append(adv)
    return facts


async def covered_days(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    lo: date,
    hi: date,
    *,
    employee_ids: list[uuid.UUID] | None = None,
    ignore_run: uuid.UUID | None = None,
) -> dict[tuple[uuid.UUID, date], Cover]:
    """Every day in this range that a payslip already pays somebody for.

    Draft or paid makes no difference: a day worked out in a draft is spoken
    for, and paying it again from another run is the mistake this is for.
    """
    out: dict[tuple[uuid.UUID, date], Cover] = {}

    def add(emp: uuid.UUID, d: date, c: Cover) -> None:
        had = out.get((emp, d))
        # Should a day be in two, name the paid one: it is the one that matters.
        if had is None or c.status == PayrollStatus.PAID.value:
            out[(emp, d)] = c

    q = (
        select(PayrollDay.employee_id, PayrollDay.date, Payroll, PayrollRun)
        .join(Payroll, Payroll.id == PayrollDay.payroll_id)
        .join(PayrollRun, PayrollRun.id == Payroll.run_id, isouter=True)
        .where(PayrollDay.hotel_id == hotel_id, PayrollDay.date >= lo, PayrollDay.date <= hi)
    )
    # Payslips from before day lines cover the whole of their dates.
    old = (
        select(Payroll, PayrollRun)
        .join(PayrollRun, PayrollRun.id == Payroll.run_id, isouter=True)
        .where(
            Payroll.hotel_id == hotel_id,
            Payroll.day_lines.is_(False),
            or_(Payroll.period_start.is_(None), Payroll.period_start <= hi),
            or_(Payroll.period_end.is_(None), Payroll.period_end >= lo),
        )
    )
    if employee_ids is not None:
        q = q.where(PayrollDay.employee_id.in_(employee_ids))
        old = old.where(Payroll.employee_id.in_(employee_ids))
    if ignore_run is not None:
        q = q.where(or_(Payroll.run_id.is_(None), Payroll.run_id != ignore_run))
        old = old.where(or_(Payroll.run_id.is_(None), Payroll.run_id != ignore_run))

    for emp, d, slip, run in (await db.execute(q)).all():
        add(emp, d, cover_of(slip, run))
    for slip, run in (await db.execute(old)).all():
        start, end = slip_range(slip)
        for d in days_between(max(start, lo), min(end, hi)):
            add(slip.employee_id, d, cover_of(slip, run))
    return out


def slip_range(slip: Payroll) -> tuple[date, date]:
    """The dates a payslip is for (stored, or read off its label)."""
    if slip.period_start and slip.period_end:
        return slip.period_start, slip.period_end
    return period_range(slip.pay_period)


def cover_of(slip: Payroll, run: PayrollRun | None) -> Cover:
    start, end = (run.period_start, run.period_end) if run else slip_range(slip)
    return Cover(
        payslip_id=slip.id,
        run_id=slip.run_id,
        number=run.number if run else None,
        label=say_range(start, end),
        status=slip.status,
    )


# ── one person ───────────────────────────────────────────────────────────────
@dataclass
class Day:
    date: date
    include: bool = False
    amount: Decimal = ZERO
    minutes: int = 0
    half_days: int = 0
    attendance: str | None = None
    attendance_minutes: int = 0
    rota_minutes: int = 0
    clock_in: datetime | None = None
    clock_out: datetime | None = None
    leave: str | None = None
    typed: bool = False
    again: bool = False
    in_run: Cover | None = None
    why: str | None = None
    #: Asked for while in another run, without saying "again".
    conflict: bool = False
    #: Clocked in and never out: hours nobody can work out.
    open_clock: bool = False
    #: The same, but so recently that they are simply still at work.
    on_shift: bool = False
    #: Marked absent or on leave, and there are hours on the day all the same.
    marked_off: bool = False
    #: Somebody looked at it and left it out. Nothing more to say about it.
    left_out: bool = False


@dataclass
class Flag:
    code: str
    text: str
    blocking: bool = False
    dates: list[date] = field(default_factory=list)
    #: What the rota says for each of those dates: the one-tap way to put a
    #: missing clock-out right, offered only when there is something to use.
    rota: list[int] = field(default_factory=list)


@dataclass
class Worked:
    employee: Employee
    basis: str
    pay_type: str
    rate: Decimal | None
    own_rate: Decimal | None
    rate_typed: bool
    days: list[Day]
    pay: Decimal = ZERO
    overtime: Decimal = ZERO
    additions: Decimal = ZERO
    deductions: Decimal = ZERO
    advance: Decimal = ZERO
    advance_due: Decimal = ZERO
    advance_owed: Decimal = ZERO
    net: Decimal = ZERO
    #: (kind, label, signed amount)
    adjustments: list[tuple[str, str, Decimal]] = field(default_factory=list)
    flags: list[Flag] = field(default_factory=list)
    hold: bool = False
    note: str | None = None
    #: Typed by hand for the whole of it, instead of day by day.
    typed_minutes: int | None = None

    @property
    def paid_days(self) -> list[Day]:
        return [d for d in self.days if d.include]

    @property
    def minutes(self) -> int:
        if self.typed_minutes is not None:
            return self.typed_minutes
        return sum(d.minutes for d in self.paid_days)

    @property
    def blocked(self) -> bool:
        return any(f.blocking for f in self.flags)

    @property
    def has_pay(self) -> bool:
        return self.pay + self.additions > 0

    @property
    def conflicts(self) -> list[Day]:
        return [d for d in self.days if d.conflict]


def own_rate(emp: Employee, pay_type: str) -> Decimal | None:
    r = emp.hourly_rate if pay_type == SalaryType.HOURLY.value else emp.monthly_salary
    return r if r is not None and r > 0 else None


def resolve_basis(pick_basis: str | None, run_basis: str) -> str:
    b = pick_basis or run_basis
    return PayBasis.ATTENDANCE.value if b == PayBasis.AUTO.value else b


def days_in_month(d: date) -> int:
    return period_range(f"{d.year:04d}-{d.month:02d}")[1].day


def work_out(
    emp: Employee,
    pick: PersonIn | None,
    facts: Facts,
    *,
    run_basis: str = PayBasis.AUTO.value,
    working_days: int = 26,
    min_wage: Decimal = calc.MIN_WAGE_UK,
) -> Worked:
    """This person's payslip for these dates, with what is said about them in
    `pick`, and every reason to look twice."""
    pick = pick or PersonIn(employee_id=emp.id)
    basis = resolve_basis(pick.basis, run_basis)
    pay_type = (
        SalaryType.MONTHLY.value if basis == PayBasis.SALARY.value else emp.salary_type
    )
    mine = own_rate(emp, pay_type)
    w = Worked(
        employee=emp,
        basis=basis,
        pay_type=pay_type,
        rate=pick.rate or mine,
        own_rate=mine,
        rate_typed=pick.rate is not None,
        days=[],
        hold=pick.hold,
        note=(pick.note or "").strip() or None,
    )
    said = {d.date: d for d in pick.days}
    for d in facts.dates_for(emp.id):
        w.days.append(_day(emp, d, said.get(d), facts, basis, pay_type, pick))

    if basis == PayBasis.MANUAL.value:
        _pay_typed(w, pick)
    elif basis == PayBasis.SALARY.value:
        _pay_salary(w)
    elif pay_type == SalaryType.HOURLY.value:
        _pay_hours(w)
    else:
        _pay_days(w, working_days)

    for a in pick.adjustments:
        amount = a.amount.quantize(Decimal("0.01"))
        if a.kind in _ADDS:
            w.additions += amount
        else:
            w.deductions += amount
            amount = -amount
        w.adjustments.append((a.kind, a.label, amount))

    _take_advance(w, pick, facts)
    _flag(w, pick, facts, min_wage)
    return w


def _day(
    emp: Employee,
    d: date,
    said: DayPick | None,
    facts: Facts,
    basis: str,
    pay_type: str,
    pick: PersonIn,
) -> Day:
    """One day: what is known about it, and whether it is in."""
    key = (emp.id, d)
    a = facts.attendance.get(key)
    day = Day(
        date=d,
        attendance=a.status if a else None,
        attendance_minutes=calc.to_minutes(a.working_hours) if a else 0,
        rota_minutes=facts.rota.get(key, 0),
        clock_in=a.clock_in if a else None,
        clock_out=a.clock_out if a else None,
        leave=facts.leave.get(key),
        in_run=facts.covered.get(key),
    )
    hourly = pay_type == SalaryType.HOURLY.value
    off = a is not None and a.status in (
        AttendanceStatus.ABSENT.value, AttendanceStatus.LEAVE.value,
    )

    # What the day comes to, before asking whether it is in.
    if basis == PayBasis.MANUAL.value:
        # A typed figure settles these dates. A bonus on its own settles none:
        # it must not use up days nobody has been paid for.
        usual, why = pick.amount is not None or pick.minutes is not None, None
    elif basis == PayBasis.SALARY.value:
        usual, why = True, None
        day.half_days = 2
        if emp.joining_date and d < emp.joining_date:
            usual, why = False, f"before they joined ({say_day(emp.joining_date)})"
    elif hourly:
        day.minutes = (
            day.rota_minutes if basis == PayBasis.ROTA.value else day.attendance_minutes
        )
        usual = day.minutes > 0
        why = None
        if basis == PayBasis.ATTENDANCE.value and off and day.minutes:
            # Somebody said they were not there, and there are hours on the day.
            # One of the two is wrong, and only a person can say which.
            usual, why = False, f"marked {a.status.lower()}, with hours recorded"
            day.marked_off = True
    else:
        if basis == PayBasis.ROTA.value:
            day.half_days = 2 if day.rota_minutes else 0
        elif a is not None and a.status == AttendanceStatus.PRESENT.value:
            day.half_days = 2
        elif a is not None and a.status == AttendanceStatus.HALF_DAY.value:
            day.half_days = 1
        usual, why = day.half_days > 0, None

    if said is not None:
        if hourly and said.minutes is not None and basis != PayBasis.MANUAL.value:
            day.minutes, day.typed = said.minutes, True
            day.marked_off = False
            usual, why = said.minutes > 0, None
        if not hourly and said.half_days is not None and basis in (
            PayBasis.ATTENDANCE.value, PayBasis.ROTA.value,
        ):
            day.half_days, day.typed = said.half_days, True
            usual, why = said.half_days > 0, None

    if day.in_run is not None:
        day.again = bool(said and said.include and said.again)
        day.include = day.again
        if not day.again:
            why = day.in_run.words()
            day.conflict = bool(said and said.include)
    elif said is not None and said.include is not None:
        day.include = said.include
        if not said.include:
            why, day.left_out, day.marked_off = "left out", True, False
        elif not hourly and basis != PayBasis.MANUAL.value and not day.half_days:
            # Put in by hand: a whole day, or it would be in and pay nothing.
            day.half_days, day.typed = 2, True
    else:
        day.include = usual

    # An open clock-in only stops pay that is read off the clock.
    looked_at = day.typed or day.left_out or day.in_run is not None
    if hourly and basis == PayBasis.ATTENDANCE.value and not looked_at:
        day.open_clock, day.on_shift = _open_clock(a, facts)
        if day.open_clock:
            why = "no clock-out"
        elif day.on_shift:
            why = "still clocked in"
    if why is None and not day.include:
        why = f"on leave ({day.leave})" if day.leave else (
            a.status.replace("_", " ").lower() if off else None
        )
    day.why = why
    return day


def _open_clock(a: Attendance | None, facts: Facts) -> tuple[bool, bool]:
    """(clocked in and never out, or simply still at work)."""
    if a is None or a.clock_in is None or a.clock_out is not None or a.working_hours:
        return False, False
    started = a.clock_in if a.clock_in.tzinfo else a.clock_in.replace(tzinfo=UTC)
    at_work = facts.now - started <= ON_SHIFT
    return not at_work, at_work


def _pay_hours(w: Worked) -> None:
    for d in w.paid_days:
        d.amount = calc.hourly_day(d.minutes, w.rate) if w.rate else ZERO
        if d.minutes:
            d.half_days = 1 if d.attendance == AttendanceStatus.HALF_DAY.value else 2
    w.pay = sum((d.amount for d in w.paid_days), ZERO)


def _pay_days(w: Worked, working_days: int) -> None:
    """Salaried, by the days they came in."""
    if not w.rate:
        return
    daily = Fraction(w.rate) / max(working_days, 1)
    per_minute = daily / calc.STANDARD_DAY_MINUTES * Fraction(calc.OVERTIME_MULTIPLIER)
    base, extra = [], []
    for d in w.paid_days:
        if w.basis == PayBasis.ATTENDANCE.value and not d.typed:
            d.minutes = d.attendance_minutes
        over = max(0, d.minutes - calc.STANDARD_DAY_MINUTES)
        base.append(daily * d.half_days / 2)
        extra.append(per_minute * over)
    lines = calc.spread([b + o for b, o in zip(base, extra, strict=True)])
    for d, amount in zip(w.paid_days, lines, strict=True):
        d.amount = amount
    w.pay = sum(lines, ZERO)
    w.overtime = sum(calc.spread(extra), ZERO)


def _pay_salary(w: Worked) -> None:
    """The salary shared out: each day is one part of ITS month."""
    if not w.rate:
        return
    lines = calc.spread([Fraction(w.rate) / days_in_month(d.date) for d in w.paid_days])
    for d, amount in zip(w.paid_days, lines, strict=True):
        d.amount = amount
        d.minutes = d.attendance_minutes
    w.pay = sum(lines, ZERO)


def _pay_typed(w: Worked, pick: PersonIn) -> None:
    """Typed: one figure for the whole of it. The days carry no amounts of their
    own; they say what has been settled."""
    if pick.amount is not None:
        w.pay = pick.amount.quantize(Decimal("0.01"))
        w.typed_minutes = pick.minutes or 0
    elif pick.minutes is not None:
        w.typed_minutes = pick.minutes
        if w.rate and w.pay_type == SalaryType.HOURLY.value:
            w.pay = calc.hourly_day(pick.minutes, w.rate)
    else:
        w.typed_minutes = 0


def due_by(advance: SalaryAdvance, end: date) -> bool:
    """Should a run that ends on this day take this advance back?

    Scheduled for a period that has started by then. It used to have to be the
    very same period, so £3,100 left over from July was in no August run and
    was never asked for again.
    """
    return period_range(advance.deduct_period)[0] <= end


def left_of(advance: SalaryAdvance) -> Decimal:
    return max(ZERO, advance.amount - (advance.amount_recovered or ZERO))


def _take_advance(w: Worked, pick: PersonIn, facts: Facts) -> None:
    advances = facts.advances.get(w.employee.id, [])
    end = max(facts.dates) if facts.dates else facts.today
    w.advance_owed = sum((left_of(a) for a in advances), ZERO)
    w.advance_due = sum((left_of(a) for a in advances if due_by(a, end)), ZERO)
    want = w.advance_due if pick.advance is None else min(pick.advance, w.advance_owed)
    d = calc.apply_deductions(w.pay + w.additions, want, w.deductions)
    w.advance = d["advance_applied"].quantize(Decimal("0.01"))
    w.net = d["net"].quantize(Decimal("0.01"))


def _some(dates: list[date]) -> str:
    """"3 and 5 Nov" — the first few, and how many more."""
    shown = [say_day(d, year=False) for d in dates[:3]]
    more = len(dates) - len(shown)
    if more:
        return ", ".join(shown) + f" and {more} more"
    if len(shown) > 1:
        return ", ".join(shown[:-1]) + " and " + shown[-1]
    return shown[0] if shown else ""


def _flag(w: Worked, pick: PersonIn, facts: Facts, min_wage: Decimal) -> None:
    """Every reason to look twice, in words, with what is in the way first."""
    emp = w.employee
    add = w.flags.append
    hourly = w.pay_type == SalaryType.HOURLY.value
    typed_amount = w.basis == PayBasis.MANUAL.value and pick.amount is not None

    if w.basis == PayBasis.MANUAL.value and pick.amount is None and pick.minutes is None:
        if not w.adjustments:
            add(Flag("typed_empty", "Type the hours or the amount", blocking=True))
    elif not w.rate and not typed_amount:
        if w.basis == PayBasis.SALARY.value and emp.salary_type == SalaryType.HOURLY.value:
            text = "Paid by the hour: no monthly salary to share out"
        elif hourly:
            text = "No hourly rate"
        else:
            text = "No monthly salary"
        add(Flag("no_rate", text, blocking=True))
    if hourly and w.rate and w.rate < min_wage and not typed_amount:
        add(Flag(
            "below_min",
            f"£{w.rate} an hour is below your minimum of £{min_wage}",
            blocking=True,
        ))
    over = w.deductions - (w.pay + w.additions)
    if over > 0:
        add(Flag(
            "too_much_off",
            f"£{w.deductions} is being taken off, and there is only £{w.pay + w.additions} "
            "to take it from",
            blocking=True,
        ))
    if pick.advance is not None and pick.advance > w.advance_owed:
        add(Flag(
            "advance_too_big",
            f"£{pick.advance} taken back is more than the £{w.advance_owed} they owe",
            blocking=True,
        ))
    elif pick.advance is not None and pick.advance > w.advance:
        add(Flag(
            "advance_short",
            f"Only £{w.advance} of the £{pick.advance} advance fits in this pay. "
            "The rest stays owed",
        ))
    elif pick.advance is None and w.advance < w.advance_due:
        add(Flag(
            "advance_short",
            f"Only £{w.advance} of the £{w.advance_due} advance due fits in this pay. "
            "The rest stays owed",
        ))

    missing = [d for d in w.days if d.open_clock]
    if missing:
        dates = [d.date for d in missing]
        add(Flag("no_clock_out", f"No clock-out on {_some(dates)}", dates=dates,
                 rota=[d.rota_minutes for d in missing]))
    working = [d.date for d in w.days if d.on_shift]
    if working:
        add(Flag("on_shift", "Still clocked in", dates=working))
    no_hours = [
        d for d in w.days
        if hourly and w.basis == PayBasis.ATTENDANCE.value
        and d.attendance in (AttendanceStatus.PRESENT.value, AttendanceStatus.HALF_DAY.value)
        and not d.attendance_minutes and not d.clock_in
        and not d.typed and not d.left_out and d.in_run is None
    ]
    if no_hours:
        dates = [d.date for d in no_hours]
        add(Flag("no_hours", f"Marked present with no hours on {_some(dates)}", dates=dates,
                 rota=[d.rota_minutes for d in no_hours]))
    odd = [d.date for d in w.days if d.marked_off and not d.include]
    if odd:
        add(Flag("marked_off", f"Marked absent or on leave, with hours, on {_some(odd)}",
                 dates=odd))
    long = [d.date for d in w.paid_days if d.minutes > LONG_DAY_MINUTES]
    if long:
        add(Flag("long_day", f"More than 16 hours on {_some(long)}. Check the clock-out",
                 dates=long))
    ahead = [d.date for d in w.paid_days if d.date > facts.today]
    if ahead:
        n = len(ahead)
        add(Flag("ahead", f"{n} {'day has' if n == 1 else 'days have'} not happened yet",
                 dates=ahead))
    held = [d for d in w.days if d.in_run is not None and not d.again]
    if held:
        runs = sorted({d.in_run.number for d in held if d.in_run.number})
        where = "run " + ", ".join(map(str, runs)) if runs else "another run"
        n = len(held)
        add(Flag("in_run", f"{n} {'day' if n == 1 else 'days'} already in {where}, left out",
                 dates=[d.date for d in held]))
    again = [d.date for d in w.days if d.again]
    if again:
        add(Flag("again", f"Paid again: {_some(again)}", dates=again))
    if not w.has_pay and not any(f.code in ("no_rate", "typed_empty") for f in w.flags):
        open_day = any(f.code in ("no_clock_out", "no_hours", "marked_off") for f in w.flags)
        if not w.paid_days and open_day:
            # (The day above is the reason: put it right, and there is.)
            text = "Nothing to pay until that day is put right"
        elif not w.paid_days:
            text = "Nothing to pay in these dates"
        else:
            text = "These days come to nothing"
        add(Flag("nothing", text, blocking=True))
    if not emp.is_active:
        add(Flag("left", "No longer on the team"))


def suggested(w: Worked) -> bool:
    return w.has_pay and not w.blocked and w.employee.is_active
