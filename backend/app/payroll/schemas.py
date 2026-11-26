"""Schemas for payroll.

⚠️ `response_model` drops what is not declared here, without a word. Every field
the page reads is declared, with its type, or it arrives as nothing.

Money is Decimal in and out, so it travels as a string ("88.00") and never as a
float. Hours travel as whole MINUTES.
"""
import uuid
from datetime import date as date_type
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.payroll.periods import MAX_DAYS

Basis = Literal["AUTO", "ATTENDANCE", "ROTA", "SALARY", "MANUAL"]
Kind = Literal["BONUS", "TIPS", "REIMBURSEMENT", "OTHER", "DEDUCTION"]
Method = Literal["CASH", "BANK", "CARD"]

_MOST = Decimal("1000000")


def _pennies(v: Decimal | None) -> Decimal | None:
    if v is not None and v != v.quantize(Decimal("0.01")):
        raise ValueError("Money is pounds and pence: two decimal places at most")
    return v


# ── asking for a run ─────────────────────────────────────────────────────────
class DayPick(BaseModel):
    """What somebody said about one day of one person."""

    date: date_type
    #: None = the usual rule for that day.
    include: bool | None = None
    #: Hours typed for this day, in minutes. (Hourly staff.)
    minutes: int | None = Field(default=None, ge=0, le=1440)
    #: 2 = a whole day, 1 = half, 0 = not. (Salaried staff.)
    half_days: int | None = Field(default=None, ge=0, le=2)
    #: "I know it is in another run. Pay it again."
    again: bool = False


class AdjustmentIn(BaseModel):
    kind: Kind
    label: str = Field(min_length=1, max_length=80)
    #: Always typed as a plain amount; DEDUCTION takes it off, the rest add it.
    amount: Decimal = Field(gt=0, le=_MOST)
    _money = field_validator("amount")(_pennies)

    @field_validator("label")
    @classmethod
    def named(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Say what it is for")
        return v


class PersonIn(BaseModel):
    """One person in the run, and anything said about them in particular."""

    employee_id: uuid.UUID
    basis: Basis | None = None
    #: A rate for THIS run only. Their own record is not touched.
    rate: Decimal | None = Field(default=None, gt=0, le=_MOST)
    #: Typed by hand: the hours, or the amount. The amount wins.
    minutes: int | None = Field(default=None, ge=0, le=100_000)
    amount: Decimal | None = Field(default=None, ge=0, le=_MOST)
    days: list[DayPick] = Field(default=[], max_length=MAX_DAYS)
    adjustments: list[AdjustmentIn] = Field(default=[], max_length=20)
    #: How much of an advance to take back. None = what is due, if pay covers it.
    advance: Decimal | None = Field(default=None, ge=0, le=_MOST)
    hold: bool = False
    note: str | None = Field(default=None, max_length=300)
    #: Their payslips in other runs, still a draft or approved and not paid, whose
    #: days are to be TAKEN into this run: those payslips go, and one payslip here
    #: covers it all. Never a paid one.
    take_from: list[uuid.UUID] = Field(default=[], max_length=10)
    #: Days outside the run's own dates that their payslip here also covers:
    #: the days taken in from an earlier run, kept so that changing the run
    #: keeps them. Saving fills it in; nobody types it.
    also: list[date_type] = Field(default=[], max_length=2 * MAX_DAYS)
    _money = field_validator("rate", "amount", "advance")(_pennies)


class RunRequest(BaseModel):
    date_from: date_type
    date_to: date_type
    #: Single days, when the run is not a stretch of them.
    only_dates: list[date_type] | None = Field(default=None, max_length=MAX_DAYS)
    basis: Basis = "AUTO"
    #: How many days count as a full month for salaried staff.
    working_days: int = Field(default=26, gt=0, le=31)
    people: list[PersonIn] = Field(default=[], max_length=500)
    note: str | None = Field(default=None, max_length=500)
    #: Remembered for next time, and nothing else: the page's preset, whether
    #: everyone was ticked, and which day their pay week starts on.
    everyone: bool = False
    preset: str | None = Field(default=None, max_length=24)
    week_start: int | None = Field(default=None, ge=0, le=6)


class PreviewRequest(RunRequest):
    #: The draft being changed, so its own days do not count against it.
    run_id: uuid.UUID | None = None
    #: Whose days to send back. The list only needs their totals.
    detail: list[uuid.UUID] = Field(default=[], max_length=20)


class SaveRun(RunRequest):
    #: The total that was on the screen. If the figures have moved since (a
    #: clock-out arrived, somebody else ran Tuesday), nothing is saved.
    expect_net: Decimal | None = None


# ── what it would pay ────────────────────────────────────────────────────────
class InRun(BaseModel):
    run_id: uuid.UUID | None
    number: int | None
    label: str
    status: str
    payslip_id: uuid.UUID


class DayOut(BaseModel):
    date: date_type
    include: bool
    amount: Decimal
    minutes: int
    half_days: int
    attendance: str | None
    attendance_minutes: int
    rota_minutes: int
    clock_in: datetime | None
    clock_out: datetime | None
    leave: str | None
    typed: bool
    again: bool
    in_run: InRun | None
    #: Why it is out, or what to look at, in a few plain words.
    why: str | None


class FlagOut(BaseModel):
    code: str
    text: str
    #: Nobody with one of these can be saved into a run until it is put right.
    blocking: bool = False
    dates: list[date_type] = []
    #: The rota's minutes for each of those dates, where that could be used.
    rota: list[int] = []


class WaitingOut(BaseModel):
    """A payslip of theirs in another run that is not finished: a draft, or
    approved and not paid."""

    payslip_id: uuid.UUID
    run_id: uuid.UUID
    number: int
    label: str
    date_from: date_type
    date_to: date_type
    status: str
    net: Decimal
    held: bool
    days: int
    #: Asked, in this preview, to be taken into the run being made.
    taken: bool = False


class WaitingPerson(BaseModel):
    employee_id: uuid.UUID
    name: str
    runs: list[WaitingOut]


class WaitingList(BaseModel):
    people: list[WaitingPerson]
    #: How many people have a draft waiting, and how many an approved one.
    drafts: int
    approved: int


class AdjustmentOut(BaseModel):
    kind: str
    label: str
    #: Signed: a deduction is negative.
    amount: Decimal


class PersonOut(BaseModel):
    employee_id: uuid.UUID
    name: str
    code: str
    job_title: str | None
    active: bool
    salary_type: str
    joining_date: date_type | None
    picked: bool
    #: Has something to pay and nothing in the way: ticked unless told otherwise.
    suggested: bool
    basis: str
    pay_type: str
    #: What it was worked out at, and what their own record says.
    rate: Decimal | None
    own_rate: Decimal | None
    rate_typed: bool
    days: int
    half_days: int
    minutes: int
    pay: Decimal
    overtime: Decimal
    additions: Decimal
    deductions: Decimal
    advance: Decimal
    advance_due: Decimal
    advance_owed: Decimal
    net: Decimal
    adjustments: list[AdjustmentOut]
    flags: list[FlagOut]
    #: The runs that already hold some of these days, and how many.
    in_runs: list[InRun]
    in_run_days: int
    hold: bool
    note: str | None
    day_lines: list[DayOut]
    #: Their other runs that are not finished. Said out loud, with what to do.
    waiting: list[WaitingOut] = []


class TotalsOut(BaseModel):
    people: int
    held: int
    days: int
    minutes: int
    pay: Decimal
    overtime: Decimal
    additions: Decimal
    deductions: Decimal
    advances: Decimal
    net: Decimal
    blocked: int
    left_out_days: int


class PreviewOut(BaseModel):
    date_from: date_type
    date_to: date_type
    label: str
    days_in_range: int
    people: list[PersonOut]
    totals: TotalsOut
    min_wage: Decimal
    today: date_type


# ── runs ─────────────────────────────────────────────────────────────────────
class RunOut(BaseModel):
    id: uuid.UUID
    number: int
    label: str
    date_from: date_type
    date_to: date_type
    #: DRAFT · PART_APPROVED · APPROVED · PART_PAID · PAID
    status: str
    #: The same, the way a person says it: "Part paid (3 of 8)".
    status_text: str
    note: str | None
    created_at: datetime
    created_by: str | None
    people: int
    names: list[str]
    draft: int
    approved: int
    paid: int
    held: int
    gross: Decimal
    additions: Decimal
    deductions: Decimal
    net: Decimal
    draft_net: Decimal
    approved_net: Decimal
    paid_net: Decimal
    unpaid_net: Decimal
    #: Payslips below nothing (only ever from the old version): money owed BACK.
    owed_back: Decimal = Decimal("0")
    last_paid_on: date_type | None
    #: Everybody in it is still a draft and it was made by this version, so it
    #: can be opened and changed.
    can_change: bool


class SlipOut(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID | None
    employee_id: uuid.UUID
    employee_name: str
    employee_code: str
    job_title: str | None
    has_email: bool
    pay_period: str
    label: str
    basis: str
    pay_type: str | None
    rate: Decimal | None
    days: int
    half_days: int
    minutes: int
    gross_pay: Decimal
    overtime_pay: Decimal
    additions: Decimal
    other_deductions: Decimal
    advance_deduction: Decimal
    net_pay: Decimal
    status: str
    held: bool
    note: str | None
    adjustments: list[AdjustmentOut]
    paid_on: date_type | None
    paid_method: str | None
    paid_reference: str | None
    emailed_at: datetime | None
    #: Approved by the old version, which put it in Expenses there and then.
    was_booked_on: date_type | None
    #: This person's other runs that are not finished.
    others: list[WaitingOut] = []


class SlipDayOut(BaseModel):
    date: date_type
    minutes: int
    half_days: int
    amount: Decimal
    typed: bool
    again: bool


class SlipDetail(SlipOut):
    #: False on a payslip from before day lines: it covers all its dates.
    day_lines: bool
    day_list: list[SlipDayOut]
    run_number: int | None


class RunDetail(RunOut):
    slips: list[SlipOut]
    #: What was asked for, so the page can open it again to change it.
    setup: dict


class RunTotals(BaseModel):
    runs: int
    people: int
    gross: Decimal
    net: Decimal
    draft_net: Decimal
    approved_net: Decimal
    paid_net: Decimal
    unpaid_net: Decimal
    owed_back: Decimal = Decimal("0")


class LegacyOut(BaseModel):
    """Approved before approval stopped meaning "in Expenses", never marked paid."""

    payslips: int
    total: Decimal
    rows: list[SlipOut]


class RunsOut(BaseModel):
    runs: list[RunOut]
    totals: RunTotals
    legacy: LegacyOut


class NextRun(BaseModel):
    """The last run, moved on to the next dates. Nothing is saved yet."""

    from_run: uuid.UUID
    from_number: int
    from_label: str
    #: Which preset it was made with, so "last week" means last week again.
    from_preset: str | None
    request: RunRequest


# ── doing things to a run ────────────────────────────────────────────────────
class SomeSlips(BaseModel):
    #: None = everybody it can be done to.
    payslip_ids: list[uuid.UUID] | None = Field(default=None, max_length=500)


class PayRequest(SomeSlips):
    paid_on: date_type
    method: Method
    reference: str | None = Field(default=None, max_length=120)


class HoldRequest(BaseModel):
    held: bool


class RecallRequest(SomeSlips):
    reason: str | None = Field(default=None, max_length=160)
    #: "RECALL", typed. Asked for only when money has gone out.
    confirm: str | None = Field(default=None, max_length=20)


class RecallPreview(BaseModel):
    label: str
    number: int
    whole_run: bool
    people: int
    names: list[str]
    days: int
    net: Decimal
    paid_people: int
    paid_net: Decimal
    expenses: int
    expenses_total: Decimal
    advances: int
    advances_total: Decimal
    adjustments: int
    notifications: int
    emailed: int
    #: Needs the word typed and a reason.
    needs_word: bool
    #: What goes, one plain sentence each.
    lines: list[str]
    #: What cannot be taken back.
    warnings: list[str]


class RecallDone(BaseModel):
    recalled: int
    run_gone: bool


# ── who is owed ──────────────────────────────────────────────────────────────
class OwedOut(BaseModel):
    employee_id: uuid.UUID
    name: str
    job_title: str | None
    active: bool
    pay_type: str
    days: int
    half_days: int
    minutes: int
    #: What those days come to the usual way, before anything is added or taken.
    estimate: Decimal
    first_day: date_type | None
    last_day: date_type | None
    #: The last day they have been paid for, and the day the money went.
    paid_to: date_type | None
    paid_on: date_type | None
    #: Already in a run and not paid yet.
    waiting: Decimal
    advance_owed: Decimal
    flags: list[FlagOut]


class OwedList(BaseModel):
    date_from: date_type
    date_to: date_type
    people: list[OwedOut]
    days: int
    estimate: Decimal
    waiting: Decimal


# ── one period at a time (as it always was) ──────────────────────────────────
class ProcessRequest(BaseModel):
    # YYYY-MM (monthly) or YYYY-Wnn (ISO week, for weekly-paid hourly staff).
    # For ONE employee you may instead send a custom date range (from→to) —
    # that's how "paid on the 18th" / "paid every Sunday" schedules run.
    pay_period: str | None = Field(default=None, pattern=r"^\d{4}-(\d{2}|W\d{2})$")
    date_from: date_type | None = None
    date_to: date_type | None = None
    employee_id: uuid.UUID | None = None  # None = all active employees
    working_days: int = Field(default=26, gt=0, le=31)
    other_deductions: Decimal = Field(default=Decimal("0"), ge=0)


class PayrollRow(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID | None = None
    employee_id: uuid.UUID
    employee_name: str
    pay_period: str
    #: "1 to 7 Nov 2026" — the period the way a person says it.
    label: str = ""
    gross_pay: Decimal
    overtime_pay: Decimal
    advance_deduction: Decimal
    other_deductions: Decimal
    additions: Decimal = Decimal("0")
    net_pay: Decimal
    status: str
    paid_on: date_type | None = None


class AdvanceCreate(BaseModel):
    employee_id: uuid.UUID
    amount: Decimal = Field(gt=0, le=_MOST)
    _money = field_validator("amount")(_pennies)
    reason: str | None = None
    given_date: date_type | None = None
    # month (2026-07) or ISO week (2026-W28) — whichever run should recover it
    deduct_period: str = Field(pattern=r"^\d{4}-(\d{2}|W\d{2})$")


class AdvanceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    employee_id: uuid.UUID
    amount: Decimal
    amount_recovered: Decimal = Decimal("0")
    reason: str | None
    given_date: date_type
    deduct_period: str
    is_deducted: bool
