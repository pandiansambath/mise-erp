"use client";

// One person in the run being put together: their days, their extras, and how
// their pay is worked out.
//
//   "i need day wise"
//
// Three pages in one popup, with what they come to always in sight above them.
// A day is a tile; tapping it says what is known about that day and offers the
// only things that can be done with it.

import { useState } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import { Choice, Figure, HoursInput, MoneyInput, MoneyLine, Pager, Said, useNarrow } from "@/components/payroll/bits";
import { usePreview } from "@/components/payroll/usePreview";
import {
  type AdjustmentIn,
  BASES,
  type Basis,
  type DayLine,
  type DayPick,
  type Kind,
  KINDS,
  kindWord,
  pence,
  type Person,
  type PersonIn,
  sayDay,
  sayDays,
  sayMinutes,
  sayTime,
  sayWeekday,
  typedMoney,
} from "@/components/payroll/lib";
import { useCurrency } from "@/lib/currency";
import { getAppTimeZone } from "@/lib/date";
import { numeric } from "@/lib/sanitize";

// Three weeks of tiles on a laptop, three rows of three on a phone.
const PAGE = 21;
const PAGE_NARROW = 9;

export function PersonPlan({
  base,
  person,
  pick,
  ticked,
  onTick,
  onChange,
  onClose,
}: {
  base: Record<string, unknown>;
  /** The row from the list: shown until this person's own days arrive. */
  person: Person;
  pick: PersonIn;
  ticked: boolean;
  onTick: () => void;
  onChange: (p: PersonIn) => void;
  onClose: () => void;
}) {
  const { format } = useCurrency();
  const [tab, setTab] = useState<"days" | "extras" | "how">(
    person.basis === "MANUAL" ? "how" : "days",
  );
  const [page, setPage] = useState(0);
  const [day, setDay] = useState<string | null>(null);

  const { data, loading, error } = usePreview(
    JSON.stringify({ ...base, people: [pick], detail: [person.employee_id] }),
  );
  const p = data?.people.find((x) => x.employee_id === person.employee_id) ?? person;
  const lines = p.day_lines;
  const hourly = p.pay_type === "HOURLY";
  const byDay = p.basis === "ATTENDANCE" || p.basis === "ROTA";

  const set = (more: Partial<PersonIn>) => onChange({ ...pick, ...more });

  function sayOfDay(date: string, more: Partial<DayPick> | null) {
    const rest = (pick.days ?? []).filter((d) => d.date !== date);
    if (more === null) return set({ days: rest });
    const had = (pick.days ?? []).find((d) => d.date === date);
    set({ days: [...rest, { ...had, date, ...more }] });
  }

  const blocking = p.flags.filter((f) => f.blocking);
  const open = day ? lines.find((d) => d.date === day) ?? null : null;

  return (
    <>
      <SheetPopup
        depth={2}
        columns={3}
        onClose={onClose}
        onBack={onClose}
        title={p.name}
        subtitle={[
          p.job_title,
          p.rate ? `${format(p.rate)} ${hourly ? "an hour" : "a month"}` : "no rate",
        ]
          .filter(Boolean)
          .join(" · ")}
        footer={
          <div className="flex items-center justify-between gap-2 px-2">
            <button
              type="button"
              onClick={onTick}
              className="mise-btn-flat mise-press min-h-[44px] px-4 text-sm text-fg-soft"
            >
              {ticked ? "Leave out of this run" : "Put in this run"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mise-btn-key mise-press min-h-[44px] px-6 text-sm font-semibold"
            >
              Done
            </button>
          </div>
        }
      >
        <div className={`grid grid-cols-3 gap-1.5 lg:grid-cols-6 ${loading ? "opacity-60" : ""}`}>
          <Figure
            label={hourly ? "Hours" : "Days"}
            value={hourly || p.basis === "MANUAL" ? sayMinutes(p.minutes) : sayDays(p.days, p.half_days)}
          />
          <Figure label="Pay" value={format(p.pay)} />
          <Figure label="Added" value={format(p.additions)} />
          <Figure
            label="Taken off"
            value={format(p.deductions)}
            tone={pence(p.deductions) ? "mise-tone-bad" : "text-fg"}
          />
          <Figure label="Advance" value={format(p.advance)} />
          <Figure label="They get" value={format(p.net)} tone="mise-tone-good" strong />
        </div>

        <div className="mt-3">
          <Choice
            value={tab}
            options={[
              { value: "days" as const, label: "Days" },
              { value: "extras" as const, label: "Extras" },
              { value: "how" as const, label: "How it counts" },
            ]}
            onChange={setTab}
          />
        </div>

        <div className="mt-3 space-y-3">
          <Said error={error} />
          {blocking.map((f) => (
            <p key={f.code} className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
              {f.text}
              {f.code === "no_rate" && (
                <button
                  type="button"
                  onClick={() => setTab("how")}
                  className="ml-2 font-semibold underline underline-offset-2"
                >
                  Give a rate for this run
                </button>
              )}
              {f.code === "typed_empty" && tab !== "how" && (
                <button
                  type="button"
                  onClick={() => setTab("how")}
                  className="ml-2 font-semibold underline underline-offset-2"
                >
                  Type it
                </button>
              )}
            </p>
          ))}

          {tab === "days" && (
            <Days
              lines={lines}
              loading={loading}
              flags={p.flags.filter((f) => !f.blocking)}
              page={page}
              onPage={setPage}
              onDay={setDay}
              format={format}
              hourly={hourly && byDay}
              typed={p.basis === "MANUAL"}
              onFix={(dates, how) => {
                const rest = (pick.days ?? []).filter((d) => !dates.includes(d.date));
                const next = dates.map((date): DayPick => {
                  const line = lines.find((l) => l.date === date);
                  return how === "rota"
                    ? { date, minutes: line?.rota_minutes ?? 0 }
                    : { date, include: how === "in" };
                });
                set({ days: [...rest, ...next] });
              }}
            />
          )}
          {tab === "extras" && <Extras p={p} pick={pick} set={set} format={format} />}
          {tab === "how" && <How p={p} pick={pick} set={set} format={format} runBasis={base.basis as Basis} />}
        </div>
      </SheetPopup>

      {open && (
        <DayPopup
          key={open.date}
          line={open}
          said={(pick.days ?? []).find((d) => d.date === open.date) ?? null}
          hourly={hourly}
          byDay={byDay}
          format={format}
          onSay={(m) => sayOfDay(open.date, m)}
          onClose={() => setDay(null)}
        />
      )}
    </>
  );
}

// ── days ─────────────────────────────────────────────────────────────────────
function Days({
  lines,
  loading,
  flags,
  page,
  onPage,
  onDay,
  format,
  hourly,
  typed,
  onFix,
}: {
  lines: DayLine[];
  loading: boolean;
  flags: Person["flags"];
  page: number;
  onPage: (p: number) => void;
  onDay: (d: string) => void;
  format: (v: string) => string;
  hourly: boolean;
  typed: boolean;
  onFix: (dates: string[], how: "rota" | "out" | "in") => void;
}) {
  const size = useNarrow() ? PAGE_NARROW : PAGE;
  if (!lines.length) {
    return (
      <p className="py-8 text-center text-sm text-fg-faint">
        {loading ? "Working it out…" : "No days in these dates."}
      </p>
    );
  }
  const last = Math.max(0, Math.ceil(lines.length / size) - 1);
  const here = Math.min(page, last);
  const small = "mise-press rounded-lg px-2.5 py-1.5 text-xs font-semibold mise-btn-flat";
  return (
    <>
      {flags.map((f) => {
        const fixable = f.code === "no_clock_out" || f.code === "no_hours";
        const rota = fixable && f.dates.every((d) => (lines.find((l) => l.date === d)?.rota_minutes ?? 0) > 0);
        return (
          <div key={f.code} className="mise-well flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm text-fg-soft">
            <span className="mise-tone-warn min-w-0 flex-1">{f.text}</span>
            {rota && (
              <button type="button" className={small} onClick={() => onFix(f.dates, "rota")}>
                Use their rota hours
              </button>
            )}
            {fixable && f.dates.length === 1 && (
              <button type="button" className={small} onClick={() => onDay(f.dates[0])}>
                Type the hours
              </button>
            )}
            {fixable && (
              <button type="button" className={small} onClick={() => onFix(f.dates, "out")}>
                Skip
              </button>
            )}
            {f.code === "marked_off" && (
              <>
                <button type="button" className={small} onClick={() => onFix(f.dates, "in")}>
                  They worked: put in
                </button>
                <button type="button" className={small} onClick={() => onFix(f.dates, "out")}>
                  Leave out
                </button>
              </>
            )}
          </div>
        );
      })}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-7">
        {lines.slice(here * size, (here + 1) * size).map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => onDay(d.date)}
            aria-label={`${sayWeekday(d.date)}, ${d.include ? "in" : "left out"}`}
            className={`mise-press min-h-[68px] rounded-xl px-2 py-1.5 text-left ${
              d.include ? "mise-card-inset ring-1 ring-brand-400/50" : "mise-well opacity-75"
            }`}
          >
            <span className="flex items-center justify-between gap-1 text-[11px] text-fg-faint">
              <span className={d.include ? "font-semibold text-fg" : ""}>{sayWeekday(d.date)}</span>
              <span aria-hidden>{d.in_run && !d.again ? "🔒" : d.typed ? "✎" : d.include ? "✓" : ""}</span>
            </span>
            <span className="mt-0.5 block truncate text-sm font-semibold tabular-nums text-fg">
              {d.include
                ? typed
                  ? "settled"
                  : hourly
                    ? sayMinutes(d.minutes)
                    : d.half_days === 1
                      ? "½ day"
                      : d.half_days === 2
                        ? "1 day"
                        : "in"
                : "–"}
            </span>
            <span className="block truncate text-[11px] tabular-nums text-fg-faint">
              {d.include && !typed ? format(d.amount) : d.in_run && !d.again ? `run ${d.in_run.number ?? ""}` : (d.why ?? "")}
            </span>
          </button>
        ))}
      </div>
      <Pager page={here} size={size} total={lines.length} onPage={onPage} />
    </>
  );
}

function DayPopup({
  line,
  said,
  hourly,
  byDay,
  format,
  onSay,
  onClose,
}: {
  line: DayLine;
  said: DayPick | null;
  hourly: boolean;
  byDay: boolean;
  format: (v: string) => string;
  onSay: (m: Partial<DayPick> | null) => void;
  onClose: () => void;
}) {
  const zone = getAppTimeZone();
  const taken = line.in_run !== null;
  const [typing, setTyping] = useState(0);
  const button = "mise-btn-flat mise-press min-h-[42px] px-3 text-sm text-fg-soft";
  const facts: [string, string][] = [
    [
      "Clocked",
      line.clock_in
        ? `${sayTime(line.clock_in, zone)} to ${line.clock_out ? sayTime(line.clock_out, zone) : "no clock-out"}`
        : "not clocked in",
    ],
    ["Worked", line.attendance_minutes ? sayMinutes(line.attendance_minutes) : "no hours recorded"],
    ["Rota", line.rota_minutes ? sayMinutes(line.rota_minutes) : "not on the rota"],
  ];
  if (line.attendance) facts.push(["Marked", line.attendance.replace("_", " ").toLowerCase()]);
  if (line.leave) facts.push(["Leave", line.leave]);

  return (
    <SheetPopup
      depth={3}
      onClose={onClose}
      title={`${sayWeekday(line.date)} ${sayDay(line.date).split(" ").slice(1).join(" ")}`}
      subtitle={line.include ? "In this run" : `Not in this run${line.why ? `: ${line.why}` : ""}`}
      footer={
        <div className="flex justify-between gap-2">
          {said ? (
            <button type="button" onClick={() => onSay(null)} className={button}>
              Back to how it was
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="mise-btn-key mise-press min-h-[42px] px-5 text-sm font-semibold"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1">
          {facts.map(([k, v]) => (
            <MoneyLine key={k} label={k} value={v} />
          ))}
          {line.include && <MoneyLine label="Pays" value={format(line.amount)} strong />}
        </div>

        {taken && !line.again ? (
          <div className="rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm">
            <p className="text-fg-soft">
              {`This day is already in ${line.in_run?.number ? `run ${line.in_run.number}` : "a run"} (${line.in_run?.label}, ${line.in_run?.status.toLowerCase()}). It is left out so it is not paid twice.`}
            </p>
            <button
              type="button"
              onClick={() => onSay({ include: true, again: true })}
              className="mise-btn-flat mise-press mt-2 min-h-[42px] px-3 text-sm"
              data-tone="danger"
            >
              Pay this day again all the same
            </button>
          </div>
        ) : taken ? (
          <button type="button" onClick={() => onSay(null)} className={button}>
            Leave it out, it is paid in the other run
          </button>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={line.include}
                onClick={() => onSay({ include: true })}
                className={`mise-press min-h-[42px] rounded-xl text-sm ${line.include ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"}`}
              >
                In
              </button>
              <button
                type="button"
                aria-pressed={!line.include}
                onClick={() => onSay({ include: false })}
                className={`mise-press min-h-[42px] rounded-xl text-sm ${!line.include ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"}`}
              >
                Out
              </button>
            </div>
            {byDay && hourly && (
              <div className="space-y-2">
                <p className="text-xs text-fg-faint">Hours to pay for this day</p>
                <HoursInput
                  key={typing}
                  label="Hours for this day"
                  minutes={said?.minutes ?? line.minutes}
                  onChange={(m) => onSay({ minutes: m, include: null })}
                />
                <div className="flex flex-wrap gap-2">
                  {line.attendance_minutes > 0 && (
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        onSay({ minutes: line.attendance_minutes, include: null });
                        setTyping((n) => n + 1);
                      }}
                    >
                      {`As worked, ${sayMinutes(line.attendance_minutes)}`}
                    </button>
                  )}
                  {line.rota_minutes > 0 && (
                    <button
                      type="button"
                      className={button}
                      onClick={() => {
                        onSay({ minutes: line.rota_minutes, include: null });
                        setTyping((n) => n + 1);
                      }}
                    >
                      {`As the rota, ${sayMinutes(line.rota_minutes)}`}
                    </button>
                  )}
                </div>
              </div>
            )}
            {byDay && !hourly && (
              <Choice
                value={String(line.include ? line.half_days : 0)}
                options={[
                  { value: "2", label: "Whole day" },
                  { value: "1", label: "Half a day" },
                  { value: "0", label: "Not a day" },
                ]}
                onChange={(v) => onSay({ half_days: Number(v), include: null })}
              />
            )}
          </>
        )}
      </div>
    </SheetPopup>
  );
}

// ── extras ───────────────────────────────────────────────────────────────────
function Extras({
  p,
  pick,
  set,
  format,
}: {
  p: Person;
  pick: PersonIn;
  set: (m: Partial<PersonIn>) => void;
  format: (v: string) => string;
}) {
  const [kind, setKind] = useState<Kind>("BONUS");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const list = pick.adjustments ?? [];
  const money = typedMoney(amount);
  const ok = label.trim() !== "" && pence(money) > 0;
  const of = KINDS.find((k) => k.value === kind);

  function addIt() {
    if (!ok) return;
    const one: AdjustmentIn = { kind, label: label.trim(), amount: money };
    set({ adjustments: [...list, one] });
    setLabel("");
    setAmount("");
  }

  const owed = pence(p.advance_owed);
  // A button fills the box, and the box keeps what is typed in it: a new one.
  const [advanceKey, setAdvanceKey] = useState(0);
  const takeBack = (v: string | null) => {
    set({ advance: v });
    setAdvanceKey((n) => n + 1);
  };
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-2.5">
        <h3 className="text-xs font-semibold text-fg">Add or take off</h3>
        <Choice small value={kind} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} onChange={setKind} />
        <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
          <input
            value={label}
            maxLength={80}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={of?.example}
            aria-label="What it is for"
            className="mise-well min-w-0 rounded-lg px-3 py-2 text-sm outline-none"
          />
          <input
            value={amount}
            inputMode="decimal"
            onChange={(e) => setAmount(numeric(e.target.value))}
            placeholder="0.00"
            aria-label="Amount"
            className="mise-well min-w-0 rounded-lg px-3 py-2 text-right text-sm tabular-nums outline-none"
          />
        </div>
        <button
          type="button"
          disabled={!ok}
          onClick={addIt}
          className="mise-btn-flat mise-press min-h-[42px] w-full text-sm font-semibold disabled:opacity-50"
          data-tone="brand"
        >
          {ok ? `${of?.sign === -1 ? "Take off" : "Add"} ${format(money)}` : "Say what it is for, and how much"}
        </button>
      </section>

      <section className="space-y-2.5">
        <h3 className="text-xs font-semibold text-fg">In this run</h3>
        {list.length === 0 && <p className="text-sm text-fg-faint">Nothing added, nothing taken off.</p>}
        {list.map((a, i) => (
          <div key={`${a.label}-${i}`} className="mise-well flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-fg">{a.label}</span>
              <span className="block text-[11px] text-fg-faint">{kindWord(a.kind)}</span>
            </span>
            <span className={`tabular-nums ${a.kind === "DEDUCTION" ? "mise-tone-bad" : "mise-tone-good"}`}>
              {`${a.kind === "DEDUCTION" ? "−" : "+"} ${format(a.amount)}`}
            </span>
            <button
              type="button"
              aria-label={`Remove ${a.label}`}
              onClick={() => set({ adjustments: list.filter((_, j) => j !== i) })}
              className="mise-press grid h-9 w-9 place-items-center rounded-lg text-fg-faint hover:text-rose-400"
            >
              ✕
            </button>
          </div>
        ))}
        {owed > 0 && (
          <div className="mise-well space-y-2 rounded-xl px-3 py-2.5 text-sm">
            <p className="text-fg-soft">
              {`They owe ${format(p.advance_owed)} of an advance. ${pence(p.advance) ? `${format(p.advance)} comes off this pay.` : "None of it comes off this pay."}`}
            </p>
            <label className="flex items-center gap-2 text-xs text-fg-faint">
              Take back
              <MoneyInput
                key={advanceKey}
                zero
                label="How much of the advance to take back"
                value={pick.advance ?? null}
                placeholder={p.advance}
                className="w-24"
                onMoney={(v) => set({ advance: v })}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="mise-btn-flat mise-press px-3 py-1.5 text-xs" onClick={() => takeBack("0.00")}>
                None this time
              </button>
              <button type="button" className="mise-btn-flat mise-press px-3 py-1.5 text-xs" onClick={() => takeBack(p.advance_owed)}>
                All they owe
              </button>
              {pick.advance != null && (
                <button type="button" className="mise-btn-flat mise-press px-3 py-1.5 text-xs" onClick={() => takeBack(null)}>
                  As usual
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ── how it counts ────────────────────────────────────────────────────────────
function How({
  p,
  pick,
  set,
  format,
  runBasis,
}: {
  p: Person;
  pick: PersonIn;
  set: (m: Partial<PersonIn>) => void;
  format: (v: string) => string;
  runBasis: Basis;
}) {
  const hourly = p.pay_type === "HOURLY";
  const now = pick.basis ?? runBasis;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="space-y-2.5">
        <h3 className="text-xs font-semibold text-fg">What counts for them</h3>
        <Choice
          small
          columns="grid-cols-2"
          value={now === "ATTENDANCE" ? "AUTO" : now}
          options={BASES.map((b) => ({ value: b.value, label: b.label }))}
          onChange={(b) => set({ basis: b === runBasis ? null : b })}
        />
        <p className="text-[11px] leading-snug text-fg-faint">
          {BASES.find((b) => b.value === (now === "ATTENDANCE" ? "AUTO" : now))?.hint}
        </p>
        {p.basis === "MANUAL" && (
          <div className="mise-well space-y-2.5 rounded-xl p-3">
            <label className="flex items-center justify-between gap-2 text-sm text-fg-soft">
              The amount
              <MoneyInput
                label="The amount"
                value={pick.amount ?? null}
                onMoney={(v) => set({ amount: v })}
              />
            </label>
            {p.salary_type === "HOURLY" && (
              <div className="flex items-center justify-between gap-2 text-sm text-fg-soft">
                <span>or the hours</span>
                <HoursInput
                  label="Hours"
                  max={99_999}
                  minutes={pick.minutes ?? null}
                  onChange={(m) => set({ minutes: m })}
                />
              </div>
            )}
            <p className="text-[11px] leading-snug text-fg-faint">
              This settles every day in these dates for them. Take a day out on the Days page to keep it owed.
            </p>
          </div>
        )}
      </section>

      <section className="space-y-2.5">
        <h3 className="text-xs font-semibold text-fg">Their rate</h3>
        <div className="mise-well space-y-2 rounded-xl p-3 text-sm">
          <p className="text-fg-soft">
            {p.own_rate
              ? `${format(p.own_rate)} ${hourly ? "an hour" : "a month"} on their record.`
              : `Nothing on their record. ${hourly ? "Their hourly rate" : "Their salary"} is set on Employees.`}
          </p>
          <label className="flex items-center justify-between gap-2 text-fg-soft">
            For this run only
            <MoneyInput
              label="Rate for this run only"
              value={pick.rate ?? null}
              placeholder={p.own_rate ?? "0.00"}
              onMoney={(v) => set({ rate: v })}
            />
          </label>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={pick.hold ?? false}
          onClick={() => set({ hold: !pick.hold })}
          className={`mise-press w-full rounded-xl px-3 py-2.5 text-left text-sm ${
            pick.hold ? "mise-btn-key" : "mise-btn-flat text-fg-soft"
          }`}
        >
          <span className="block font-semibold">{pick.hold ? "On hold" : "Hold them back"}</span>
          <span className="block text-[11px] opacity-80">
            In the run, and not approved or paid with the others.
          </span>
        </button>
        <label className="block">
          <span className="block text-[11px] text-fg-faint">Note about them (optional)</span>
          <input
            value={pick.note ?? ""}
            maxLength={300}
            onChange={(e) => set({ note: e.target.value || null })}
            className="mise-well mt-0.5 w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
          />
        </label>
      </section>
    </div>
  );
}
