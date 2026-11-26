// What the payroll popups share: the shapes the API sends, and the dates.
//
// NO SUM OF MONEY IS DONE HERE IN POUNDS. Every figure a person is paid comes
// from the server as a string. Where a row of them has to be added up on the
// screen (how much is ticked so far) they are added as whole pence, and the
// server checks the total again before it saves anything.

import { localISODate } from "@/lib/date";

export type Basis = "AUTO" | "ATTENDANCE" | "ROTA" | "SALARY" | "MANUAL";
export type Kind = "BONUS" | "TIPS" | "REIMBURSEMENT" | "OTHER" | "DEDUCTION";
export type SlipStatus = "DRAFT" | "APPROVED" | "PAID";
export type RunStatus = "DRAFT" | "PART_APPROVED" | "APPROVED" | "PART_PAID" | "PAID";

export interface DayPick {
  date: string;
  include?: boolean | null;
  minutes?: number | null;
  half_days?: number | null;
  again?: boolean;
}

export interface AdjustmentIn {
  kind: Kind;
  label: string;
  amount: string;
}

export interface PersonIn {
  employee_id: string;
  basis?: Basis | null;
  rate?: string | null;
  minutes?: number | null;
  amount?: string | null;
  days?: DayPick[];
  adjustments?: AdjustmentIn[];
  advance?: string | null;
  hold?: boolean;
  note?: string | null;
  /** Their payslips in other runs (not paid) whose days come into this one. */
  take_from?: string[];
  /** Days outside the run's dates that their payslip here also covers (taken in before). */
  also?: string[];
}

export interface RunRequest {
  date_from: string;
  date_to: string;
  only_dates?: string[] | null;
  basis: Basis;
  working_days: number;
  people: PersonIn[];
  note?: string | null;
  everyone?: boolean;
  preset?: string | null;
  week_start?: number | null;
}

export interface InRun {
  run_id: string | null;
  number: number | null;
  label: string;
  status: SlipStatus;
  payslip_id: string;
}

export interface DayLine {
  date: string;
  include: boolean;
  amount: string;
  minutes: number;
  half_days: number;
  attendance: string | null;
  attendance_minutes: number;
  rota_minutes: number;
  clock_in: string | null;
  clock_out: string | null;
  leave: string | null;
  typed: boolean;
  again: boolean;
  in_run: InRun | null;
  why: string | null;
}

export interface Flag {
  code: string;
  text: string;
  blocking: boolean;
  dates: string[];
  /** The rota's minutes for each of those dates, where that could be used. */
  rota: number[];
}

export interface Person {
  employee_id: string;
  name: string;
  code: string;
  job_title: string | null;
  active: boolean;
  salary_type: string;
  joining_date: string | null;
  picked: boolean;
  suggested: boolean;
  basis: Basis;
  pay_type: string;
  rate: string | null;
  own_rate: string | null;
  rate_typed: boolean;
  days: number;
  half_days: number;
  minutes: number;
  pay: string;
  overtime: string;
  additions: string;
  deductions: string;
  advance: string;
  advance_due: string;
  advance_owed: string;
  net: string;
  adjustments: { kind: Kind; label: string; amount: string }[];
  flags: Flag[];
  in_runs: InRun[];
  in_run_days: number;
  hold: boolean;
  note: string | null;
  day_lines: DayLine[];
  /** Their other runs that are not finished: a draft, or approved and not paid. */
  waiting: Waiting[];
}

export interface Waiting {
  payslip_id: string;
  run_id: string;
  number: number;
  label: string;
  date_from: string;
  date_to: string;
  status: SlipStatus;
  net: string;
  held: boolean;
  days: number;
  /** Being taken into the run that is being put together. */
  taken: boolean;
}

export interface WaitingList {
  people: { employee_id: string; name: string; runs: Waiting[] }[];
  drafts: number;
  approved: number;
}

export interface Preview {
  date_from: string;
  date_to: string;
  label: string;
  days_in_range: number;
  people: Person[];
  min_wage: string;
  today: string;
}

export interface Run {
  id: string;
  number: number;
  label: string;
  date_from: string;
  date_to: string;
  status: RunStatus;
  status_text: string;
  note: string | null;
  created_at: string;
  created_by: string | null;
  people: number;
  names: string[];
  draft: number;
  approved: number;
  paid: number;
  held: number;
  gross: string;
  additions: string;
  deductions: string;
  net: string;
  draft_net: string;
  approved_net: string;
  paid_net: string;
  unpaid_net: string;
  /** Payslips below nothing, from the old version: money owed BACK. */
  owed_back: string;
  last_paid_on: string | null;
  can_change: boolean;
}

export interface Slip {
  id: string;
  run_id: string | null;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  job_title: string | null;
  has_email: boolean;
  pay_period: string;
  label: string;
  basis: Basis;
  pay_type: string | null;
  rate: string | null;
  days: number;
  half_days: number;
  minutes: number;
  gross_pay: string;
  overtime_pay: string;
  additions: string;
  other_deductions: string;
  advance_deduction: string;
  net_pay: string;
  status: SlipStatus;
  held: boolean;
  note: string | null;
  adjustments: { kind: Kind; label: string; amount: string }[];
  paid_on: string | null;
  paid_method: string | null;
  paid_reference: string | null;
  emailed_at: string | null;
  was_booked_on: string | null;
  /** Their other runs that are not finished. */
  others: Waiting[];
}

export interface SlipDetail extends Slip {
  day_lines: boolean;
  day_list: {
    date: string;
    minutes: number;
    half_days: number;
    amount: string;
    typed: boolean;
    again: boolean;
  }[];
  run_number: number | null;
}

export interface RunDetail extends Run {
  slips: Slip[];
  setup: Partial<RunRequest>;
}

export interface RunTotals {
  runs: number;
  people: number;
  gross: string;
  net: string;
  draft_net: string;
  approved_net: string;
  paid_net: string;
  unpaid_net: string;
  owed_back: string;
}

export interface Legacy {
  payslips: number;
  total: string;
  rows: Slip[];
}

export interface Runs {
  runs: Run[];
  totals: RunTotals;
  legacy: Legacy;
}

export interface NextRun {
  from_run: string;
  from_number: number;
  from_label: string;
  from_preset: string | null;
  request: RunRequest;
}

export interface OwedPerson {
  employee_id: string;
  name: string;
  job_title: string | null;
  active: boolean;
  pay_type: string;
  days: number;
  half_days: number;
  minutes: number;
  estimate: string;
  first_day: string | null;
  last_day: string | null;
  paid_to: string | null;
  paid_on: string | null;
  waiting: string;
  advance_owed: string;
  flags: Flag[];
}

export interface Owed {
  date_from: string;
  date_to: string;
  people: OwedPerson[];
  days: number;
  estimate: string;
  waiting: string;
}

export interface RecallPlan {
  label: string;
  number: number;
  whole_run: boolean;
  people: number;
  names: string[];
  days: number;
  net: string;
  paid_people: number;
  paid_net: string;
  expenses: number;
  expenses_total: string;
  needs_word: boolean;
  lines: string[];
  warnings: string[];
}

// ── money, in whole pence ────────────────────────────────────────────────────
/** "1234.50" → 123450. Read as text: 0.1 + 0.2 is not asked to add up. */
export function pence(money: string | null | undefined): number {
  if (!money) return 0;
  const m = /^\s*(-?)(\d+)(?:\.(\d{1,2}))?/.exec(money);
  if (!m) return 0;
  const n = parseInt(m[2], 10) * 100 + parseInt((m[3] ?? "").padEnd(2, "0") || "0", 10);
  return m[1] ? -n : n;
}

/** 123450 → "1234.50", the way the server writes it. */
export function fromPence(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

export const sumPence = (list: string[]): string =>
  fromPence(list.reduce((t, x) => t + pence(x), 0));

/** What somebody typed, as money: two places at most. "" when it is not a number. */
export function typedMoney(raw: string): string {
  const s = raw.trim();
  if (!s || !/^\d*\.?\d{0,2}$/.test(s) || s === ".") return "";
  return fromPence(pence(s.startsWith(".") ? `0${s}` : s));
}

// ── hours, in whole minutes ──────────────────────────────────────────────────
export function sayMinutes(n: number): string {
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (!h && !m) return "0h";
  if (!m) return `${h}h`;
  if (!h) return `${m}m`;
  return `${h}h ${m}m`;
}

/** "3 days", "2½ days", "1 day". */
export function sayDays(full: number, half: number): string {
  const total = full + half / 2;
  const whole = Math.floor(total);
  const num = `${whole || (total % 1 ? "" : "0")}${total % 1 ? "½" : ""}`;
  return `${num} ${total === 1 || total === 0.5 ? "day" : "days"}`;
}

// ── dates, as text ───────────────────────────────────────────────────────────
// "2026-11-25" in, "2026-11-25" out, worked out in UTC on purpose: a date has no
// clock, and adding a day to local midnight on the night the clocks change
// lands on the same day twice.
const at = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (d: Date): string => d.toISOString().slice(0, 10);

export const today = (): string => localISODate();

export function addDays(day: string, n: number): string {
  const d = at(day);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** 0 = Monday … 6 = Sunday. */
export const weekday = (day: string): number => (at(day).getUTCDay() + 6) % 7;

export const monthStart = (day: string): string => `${day.slice(0, 8)}01`;

export function monthEnd(day: string): string {
  const d = at(monthStart(day));
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function addMonths(day: string, n: number): string {
  const d = at(monthStart(day));
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)));
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "5 Nov" (and "5 Nov 2025" when it is not this year). */
export function sayDay(day: string | null | undefined, year = false): string {
  if (!day) return "";
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  const other = year || String(y) !== today().slice(0, 4);
  return `${d} ${MONTHS[m - 1]}${other ? ` ${y}` : ""}`;
}

export const sayWeekday = (day: string): string => `${WEEKDAYS[weekday(day)]} ${Number(day.slice(8, 10))}`;

export const monthName = (day: string): string =>
  `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

export function sayRange(from: string, to: string): string {
  if (from === to) return sayDay(from);
  if (from === monthStart(from) && to === monthEnd(from)) return monthName(from);
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8, 10))} to ${sayDay(to)}`;
  return `${sayDay(from)} to ${sayDay(to)}`;
}

/** A clock time in the restaurant's own zone, as the server's timestamps mean it. */
export function sayTime(stamp: string | null, zone: string | null): string {
  if (!stamp) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zone ?? undefined,
    }).format(new Date(stamp));
  } catch {
    return stamp.slice(11, 16);
  }
}

export type PresetKey =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "pay_week"
  | "this_month"
  | "last_month"
  | "custom"
  | "days";

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "pay_week", label: "Pay week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "From and to" },
  { key: "days", label: "Single days" },
];

/** The dates a preset means, or null for the two that are picked by hand. */
export function presetDates(
  key: PresetKey,
  now: string,
  weekStart: number,
): { from: string; to: string } | null {
  switch (key) {
    case "today":
      return { from: now, to: now };
    case "yesterday":
      return { from: addDays(now, -1), to: addDays(now, -1) };
    case "this_week": {
      const mon = addDays(now, -weekday(now));
      return { from: mon, to: addDays(mon, 6) };
    }
    case "last_week": {
      const mon = addDays(now, -weekday(now) - 7);
      return { from: mon, to: addDays(mon, 6) };
    }
    case "pay_week": {
      // The last pay week that is over: the seven days before the most recent
      // day their week starts on.
      const back = (weekday(now) - weekStart + 7) % 7;
      const start = addDays(now, -back - 7);
      return { from: start, to: addDays(start, 6) };
    }
    case "this_month":
      return { from: monthStart(now), to: monthEnd(now) };
    case "last_month": {
      const first = addMonths(now, -1);
      return { from: first, to: monthEnd(first) };
    }
    default:
      return null;
  }
}

/** The most days one run can cover, the same as the server's. */
export const MAX_DAYS = 93;

// ── words ────────────────────────────────────────────────────────────────────
export const BASES: { value: Basis; label: string; hint: string }[] = [
  {
    value: "AUTO",
    label: "Their usual way",
    hint: "Hourly staff by the hours they worked, salaried staff by the days they came in.",
  },
  {
    value: "ROTA",
    label: "Rota hours",
    hint: "What the rota planned, whether or not they clocked in.",
  },
  {
    value: "SALARY",
    label: "Salary, shared out",
    hint: "The monthly salary split over the days of the month. A whole month is the salary exactly.",
  },
  {
    value: "MANUAL",
    label: "Typed by hand",
    hint: "You type each person’s hours, or the amount.",
  },
];

export const basisWord = (b: Basis): string =>
  ({
    AUTO: "Usual way",
    ATTENDANCE: "Attendance",
    ROTA: "Rota",
    SALARY: "Salary shared out",
    MANUAL: "Typed by hand",
  })[b] ?? b;

export const KINDS: { value: Kind; label: string; example: string; sign: 1 | -1 }[] = [
  { value: "BONUS", label: "Bonus", example: "e.g. covered Friday", sign: 1 },
  { value: "TIPS", label: "Tips", example: "e.g. tips this week", sign: 1 },
  { value: "REIMBURSEMENT", label: "Money back", example: "e.g. taxi home", sign: 1 },
  { value: "OTHER", label: "Other, added", example: "what it is for", sign: 1 },
  { value: "DEDUCTION", label: "Taken off", example: "e.g. uniform", sign: -1 },
];

export const kindWord = (k: string): string => KINDS.find((x) => x.value === k)?.label ?? k;

export function rateWord(rate: string | null, payType: string | null): string {
  return rate ? (payType === "HOURLY" ? "an hour" : "a month") : "no rate";
}

export type Tone = "slate" | "amber" | "green" | "red";
export const runTone = (s: RunStatus): Tone =>
  s === "PAID" ? "green" : s === "DRAFT" ? "slate" : "amber";
export const slipTone = (s: SlipStatus): Tone =>
  s === "PAID" ? "green" : s === "APPROVED" ? "amber" : "slate";
export const slipWord = (s: SlipStatus): string =>
  s === "PAID" ? "Paid" : s === "APPROVED" ? "Approved, not paid" : "Draft";

/** "Run 3 (3 to 9 Aug), a draft, £146.74, not approved." */
export function waitingWords(w: Waiting, format: (v: string) => string): string {
  const state =
    w.status === "DRAFT" ? "a draft, not approved" : "approved and not paid yet";
  return `Run ${w.number} (${w.label}), ${state}, ${format(w.net)}`;
}

export const people = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;

/** Open one popup after another has closed, a moment later.
 *
 *  Closing and opening in the same commit is the race `useBackToClose` warns
 *  about: the closing one's `history.back()` lands after the new one has
 *  mounted, and closes it. */
export const afterClose = (fn: () => void): void => {
  window.setTimeout(fn, 90);
};
