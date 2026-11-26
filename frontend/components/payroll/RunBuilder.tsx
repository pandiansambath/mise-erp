"use client";

// Putting a run together: when, what counts, who, and what it comes to.
//
//   "currently we have monthly weekly... i need day wise, like custom date i can
//    pick and then i can pick for whom and all.. etc etc... full n full
//    customizable and playable"
//
// ONE popup, and the figures are on it from the first second: there is no step
// where somebody has chosen things and has not yet seen what they mean. On a
// laptop the dates are on the left and the people on the right; on a phone they
// are two pages of the same popup, one tap apart.

import { useEffect, useMemo, useRef, useState } from "react";

import { useConfirm } from "@/components/confirm";

import { SheetPopup } from "@/components/SheetPopup";
import { Select } from "@/components/Select";
import { Choice, DayPickerPopup, MoneyInput, Pager, Said, Tick, useNarrow } from "@/components/payroll/bits";
import { PersonPlan } from "@/components/payroll/PersonPlan";
import { RunSheet } from "@/components/payroll/RunSheet";
import { Act, waitingChip, type WaitingDo, WaitingNote } from "@/components/payroll/Waiting";
import { usePreview } from "@/components/payroll/usePreview";
import {
  addDays,
  addMonths,
  type AdjustmentIn,
  BASES,
  type Basis,
  basisWord,
  type DayPick,
  daysBetween,
  MAX_DAYS,
  monthEnd,
  monthStart,
  people as peopleWord,
  type Person,
  type PersonIn,
  presetDates,
  PRESETS,
  type PresetKey,
  rateWord,
  type RunDetail,
  type RunRequest,
  sayDay,
  type SlipDetail,
  type Waiting,
  sayDays,
  sayMinutes,
  sayRange,
  sumPence,
  today,
  WEEKDAYS,
} from "@/components/payroll/lib";
import { api, ApiError } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { numeric } from "@/lib/sanitize";

/** How the builder opens. Everything is optional: nothing is an empty start. */
export interface BuilderStart {
  title?: string;
  subtitle?: string;
  request?: Partial<RunRequest>;
  preset?: PresetKey;
  /** A draft being changed, and not a new run. */
  run?: RunDetail;
  /** Take these people's days from another run in as soon as it opens. */
  take?: { employee_id: string; from: Waiting }[];
}

// Six fit a laptop's popup with nothing to scroll; a seventh is a scroll.
const PAGE = 6;
const PAGE_NARROW = 4;

/** Is there anything said about this person, beyond that they are in? */
const saysSomething = (p: PersonIn): boolean =>
  Boolean(
    p.basis || p.rate || p.amount != null || p.minutes != null || p.days?.length ||
      p.adjustments?.length || p.advance != null || p.hold || p.note || p.take_from?.length ||
      p.also?.length,
  );

export function RunBuilder({
  start,
  onClose,
  onSaved,
}: {
  start: BuilderStart;
  onClose: () => void;
  onSaved: (run: RunDetail) => void;
}) {
  const { format } = useCurrency();
  const asked = start.request ?? {};
  const now = today();

  const [preset, setPreset] = useState<PresetKey>(
    start.preset ?? (asked.only_dates ? "days" : asked.date_from ? "custom" : "last_week"),
  );
  const [weekStart, setWeekStart] = useState(asked.week_start ?? 0);
  const first = presetDates(preset, now, weekStart);
  const [from, setFrom] = useState(asked.date_from ?? first?.from ?? now);
  const [to, setTo] = useState(asked.date_to ?? first?.to ?? now);
  const [only, setOnly] = useState<string[]>(asked.only_dates ?? []);
  const [basis, setBasis] = useState<Basis>(
    asked.basis === "ATTENDANCE" ? "AUTO" : (asked.basis ?? "AUTO"),
  );
  const [workingDays, setWorkingDays] = useState(String(asked.working_days ?? 26));
  const [note, setNote] = useState(asked.note ?? "");
  const [picks, setPicks] = useState<Record<string, PersonIn>>(() =>
    Object.fromEntries(
      (asked.people ?? []).filter(saysSomething).map((p) => [p.employee_id, p]),
    ),
  );
  // null = everybody with something to pay and nothing in the way.
  const [ticked, setTicked] = useState<Set<string> | null>(() =>
    asked.people && !asked.everyone ? new Set(asked.people.map((p) => p.employee_id)) : null,
  );

  const [side, setSide] = useState<"when" | "who">("when");
  const [pickDays, setPickDays] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [payType, setPayType] = useState<"ALL" | "HOURLY" | "MONTHLY">("ALL");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const narrow = useNarrow();

  // ── the dates ──────────────────────────────────────────────────────────────
  const single = preset === "days";
  const range = single
    ? only.length
      ? { from: only[0], to: only[only.length - 1] }
      : null
    : { from, to };
  const length = range ? daysBetween(range.from, range.to).length : 0;
  const wrong = !range
    ? "Pick at least one day."
    : range.to < range.from
      ? "The dates end before they start."
      : length > MAX_DAYS
        ? "One run can cover at most three months."
        : null;

  function choose(key: PresetKey, ws = weekStart) {
    setPreset(key);
    setPage(0);
    if (key === "days") {
      setPickDays(true);
      return;
    }
    const d = presetDates(key, now, ws);
    if (d) {
      setFrom(d.from);
      setTo(d.to);
    }
  }

  /** The same length again, earlier or later. A whole month moves by a month. */
  function move(dir: -1 | 1) {
    setPreset("custom");
    if (from === monthStart(from) && to === monthEnd(from)) {
      const f = addMonths(from, dir);
      setFrom(f);
      setTo(monthEnd(f));
      return;
    }
    const by = daysBetween(from, to).length * dir;
    setFrom(addDays(from, by));
    setTo(addDays(to, by));
  }

  // ── what it comes to ───────────────────────────────────────────────────────
  const base = useMemo(() => {
    const days = parseInt(workingDays || "0", 10);
    return {
      date_from: range?.from ?? now,
      date_to: range?.to ?? now,
      only_dates: single ? only : null,
      basis,
      working_days: Math.min(31, Math.max(1, days || 26)),
      run_id: start.run?.id ?? null,
    };
  }, [range?.from, range?.to, single, only, basis, workingDays, start.run?.id, now]);

  const { data, loading, error, refresh } = usePreview(
    wrong ? null : JSON.stringify({ ...base, people: Object.values(picks) }),
  );
  const rows = useMemo(() => data?.people ?? [], [data]);
  const isTicked = (p: Person) => (ticked ? ticked.has(p.employee_id) : p.suggested);
  const chosen = rows.filter(isTicked);
  const blocked = chosen.filter((p) => p.flags.some((f) => f.blocking));
  const total = sumPence(chosen.map((p) => p.net));
  const minutes = chosen.reduce((t, p) => t + p.minutes, 0);
  const leftOut = chosen.reduce((t, p) => t + p.in_run_days, 0);

  const roles = [...new Set(rows.map((p) => p.job_title).filter((r): r is string => Boolean(r)))].sort();
  const shown = rows.filter(
    (p) =>
      (payType === "ALL" || p.salary_type === payType) &&
      (!role || p.job_title === role) &&
      (!search.trim() ||
        `${p.name} ${p.code} ${p.job_title ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())),
  );
  const narrowed = shown.length !== rows.length;
  const size = narrow ? PAGE_NARROW : PAGE;
  const lastPage = Math.max(0, Math.ceil(shown.length / size) - 1);
  const here = Math.min(page, lastPage);
  const visible = shown.slice(here * size, (here + 1) * size);

  // ── who ────────────────────────────────────────────────────────────────────
  const tickedNow = () => new Set(chosen.map((p) => p.employee_id));
  function toggle(id: string) {
    const next = tickedNow();
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTicked(next);
  }
  function tickShown(on: boolean) {
    const next = tickedNow();
    for (const p of shown) {
      if (!on) next.delete(p.employee_id);
      // Typed by hand, nobody comes to anything until it is typed.
      else if (p.suggested || basis === "MANUAL") next.add(p.employee_id);
    }
    // All of it, with nothing narrowed, is "everybody", today and next time.
    setTicked(on && !narrowed && basis !== "MANUAL" ? null : next);
  }
  const onlyShown = () =>
    setTicked(
      new Set(
        shown.filter((p) => p.suggested || basis === "MANUAL").map((p) => p.employee_id),
      ),
    );
  const skipBlocked = () => {
    const next = tickedNow();
    for (const p of blocked) next.delete(p.employee_id);
    setTicked(next);
  };
  function say(id: string, pick: PersonIn) {
    setPicks((all) => {
      const next = { ...all };
      if (saysSomething(pick)) next[id] = pick;
      else delete next[id];
      return next;
    });
  }

  // ── somebody's earlier run that is not finished ────────────────────────────
  const confirm = useConfirm();
  const [left, setLeft] = useState<Set<string>>(new Set());
  const [lookAt, setLookAt] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // What taking an earlier payslip added, so putting it back takes exactly that.
  const [brought, setBrought] = useState<Record<string, { dates: string[]; extras: AdjustmentIn[] }>>({});

  /** That payslip's days (and its extras) come into this run: one payslip here. */
  async function take(employeeId: string, w: Waiting) {
    setAsking(true);
    setFailed(null);
    try {
      const slip = await api.get<SlipDetail>(`/payroll/slips/${w.payslip_id}`);
      const days: DayPick[] = slip.day_list.map((d) =>
        d.typed
          ? slip.pay_type === "HOURLY"
            ? { date: d.date, minutes: d.minutes, include: true }
            : { date: d.date, half_days: d.half_days, include: true }
          : { date: d.date, include: true },
      );
      const extras: AdjustmentIn[] = slip.adjustments.map((a) => ({
        kind: a.kind,
        label: a.label,
        amount: a.amount.replace("-", ""),
      }));
      setBrought((b) => ({ ...b, [w.payslip_id]: { dates: days.map((d) => d.date), extras } }));
      setPicks((all) => {
        const was = all[employeeId] ?? { employee_id: employeeId };
        const dates = new Set(days.map((d) => d.date));
        return {
          ...all,
          [employeeId]: {
            ...was,
            take_from: [...(was.take_from ?? []).filter((x) => x !== w.payslip_id), w.payslip_id],
            days: [...(was.days ?? []).filter((d) => !dates.has(d.date)), ...days],
            adjustments: [...(was.adjustments ?? []), ...extras],
          },
        };
      });
      setTicked((t) => {
        if (t === null) return t;
        const n = new Set(t);
        n.add(employeeId);
        return n;
      });
    } catch (err) {
      setFailed(err instanceof ApiError ? err.message : "Could not read that run.");
    } finally {
      setAsking(false);
    }
  }

  function untake(employeeId: string, w: Waiting) {
    const got = brought[w.payslip_id];
    setBrought((b) => {
      const next = { ...b };
      delete next[w.payslip_id];
      return next;
    });
    setPicks((all) => {
      const was = all[employeeId];
      if (!was) return all;
      const dates = new Set(got?.dates ?? []);
      const extras = [...(got?.extras ?? [])];
      const keep = (was.adjustments ?? []).filter((a) => {
        const i = extras.findIndex((e) => e.kind === a.kind && e.label === a.label && e.amount === a.amount);
        if (i < 0) return true;
        extras.splice(i, 1);
        return false;
      });
      const next: PersonIn = {
        ...was,
        take_from: (was.take_from ?? []).filter((x) => x !== w.payslip_id),
        days: (was.days ?? []).filter((d) => !dates.has(d.date)),
        adjustments: keep,
      };
      const out = { ...all };
      if (saysSomething(next)) out[employeeId] = next;
      else delete out[employeeId];
      return out;
    });
  }

  async function approveThere(name: string, w: Waiting) {
    const ok = await confirm({
      title: `Approve Run ${w.number} for ${name}?`,
      message: `${format(w.net)}, ${w.label}. It is agreed there, and you carry on here. Nothing goes into Expenses until it is marked as paid.`,
      confirmText: "Approve it",
    });
    if (!ok) return;
    setAsking(true);
    setFailed(null);
    try {
      await api.post(`/payroll/runs/${w.run_id}/approve`, { payslip_ids: [w.payslip_id] });
      refresh();
    } catch (err) {
      setFailed(err instanceof ApiError ? err.message : "Could not approve it.");
    } finally {
      setAsking(false);
    }
  }

  /** Days taken in from another run when this run was saved: leave them out after all. */
  function dropAlso(employeeId: string) {
    setPicks((all) => {
      const was = all[employeeId];
      if (!was) return all;
      const gone = new Set(was.also ?? []);
      const next: PersonIn = { ...was, also: [], days: (was.days ?? []).filter((d) => !gone.has(d.date)) };
      const out = { ...all };
      if (saysSomething(next)) out[employeeId] = next;
      else delete out[employeeId];
      return out;
    });
  }

  const waitingAct = (employeeId: string, name: string): WaitingDo => ({
    open: (w) => setLookAt(w.run_id),
    approve: (w) => void approveThere(name, w),
    take: (w) => void take(employeeId, w),
    untake: (w) => untake(employeeId, w),
    leave: (w) => setLeft((l) => new Set(l).add(w.payslip_id)),
  });

  // Opened from a run sheet with "take those days into this run" already said.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !start.take?.length) return;
    started.current = true;
    for (const t of start.take) void take(t.employee_id, t.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setSaving(true);
    setFailed(null);
    const body = {
      ...base,
      run_id: undefined,
      note: note.trim() || null,
      everyone: ticked === null,
      preset,
      week_start: weekStart,
      people: chosen.map((p) => ({ ...(picks[p.employee_id] ?? {}), employee_id: p.employee_id })),
      expect_net: total,
    };
    try {
      const run = start.run
        ? await api.put<RunDetail>(`/payroll/runs/${start.run.id}`, body)
        : await api.post<RunDetail>("/payroll/runs", body);
      onSaved(run);
    } catch (err) {
      setFailed(err instanceof ApiError ? err.message : "Could not save the run. Try again.");
      refresh();
    } finally {
      setSaving(false);
    }
  }

  const ready =
    !wrong && !loading && !asking && !error && chosen.length > 0 && blocked.length === 0;
  const unfinished = chosen.filter((p) => p.waiting.some((w) => !left.has(w.payslip_id)));
  const kept = chosen.filter((p) => picks[p.employee_id]?.also?.length);
  const opened = openId ? rows.find((p) => p.employee_id === openId) ?? null : null;
  const small = "mise-btn-flat mise-press min-h-[38px] px-3 text-xs font-medium text-fg-soft";
  const arrow = "mise-btn-flat mise-press grid h-9 w-8 shrink-0 place-items-center text-fg-soft";

  // ── left: when, and what counts ────────────────────────────────────────────
  const when = (
    <div className="space-y-3">
      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-fg">When</h3>
        <Choice
          small
          value={preset}
          options={PRESETS.map((p) => ({ value: p.key, label: p.label }))}
          onChange={(k) => choose(k)}
        />
        {preset === "pay_week" && (
          <div className="mt-2">
            <p className="mb-1 text-[11px] text-fg-faint">Your pay week starts on</p>
            <div className="grid grid-cols-7 gap-1">
              {WEEKDAYS.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  aria-pressed={weekStart === i}
                  onClick={() => {
                    setWeekStart(i);
                    choose("pay_week", i);
                  }}
                  className={`mise-press h-9 rounded-lg text-[11px] ${
                    weekStart === i ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
        )}
        {preset === "custom" ? (
          <div className="mt-2 flex items-center gap-1">
            <button type="button" aria-label="Earlier" onClick={() => move(-1)} className={arrow}>
              ‹
            </button>
            {(
              [
                ["From", from, setFrom],
                ["To", to, setTo],
              ] as const
            ).map(([label, value, set]) => (
              <input
                key={label}
                type="date"
                aria-label={label}
                value={value}
                onChange={(e) => e.target.value && set(e.target.value)}
                className="mise-well min-w-0 flex-1 rounded-lg px-1.5 py-2 text-xs text-fg outline-none"
              />
            ))}
            <button type="button" aria-label="Later" onClick={() => move(1)} className={arrow}>
              ›
            </button>
          </div>
        ) : single ? (
          <button
            type="button"
            onClick={() => setPickDays(true)}
            className="mise-btn-flat mise-press mt-2 w-full px-3 py-2.5 text-left text-sm text-fg-soft"
          >
            {only.length
              ? `${only.length} ${only.length === 1 ? "day" : "days"}: ${only.slice(0, 4).map((d) => sayDay(d)).join(", ")}${only.length > 4 ? "…" : ""}`
              : "Pick the days"}
          </button>
        ) : null}
        {!single && preset !== "custom" && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <button type="button" aria-label="Earlier" onClick={() => move(-1)} className={small}>
              ‹ Earlier
            </button>
            <p className="min-w-0 truncate text-center text-sm font-semibold text-fg">
              {sayRange(from, to)}
            </p>
            <button type="button" aria-label="Later" onClick={() => move(1)} className={small}>
              Later ›
            </button>
          </div>
        )}
        {wrong && <p className="mt-1.5 text-xs text-rose-400">{wrong}</p>}
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-semibold text-fg">What counts</h3>
        <Choice
          small
          columns="grid-cols-2"
          value={basis}
          options={BASES.map((b) => ({ value: b.value, label: b.label }))}
          onChange={setBasis}
        />
        <p className="mt-1.5 text-[11px] leading-snug text-fg-faint">
          {BASES.find((b) => b.value === basis)?.hint}
        </p>
      </section>

      {(basis === "AUTO" || basis === "ROTA") && rows.some((p) => p.pay_type === "MONTHLY") && (
        <label className="flex items-center justify-between gap-3">
          <span className="text-[11px] leading-snug text-fg-faint">
            Working days in a full month, for salaried staff
          </span>
          <input
            inputMode="numeric"
            value={workingDays}
            onChange={(e) => setWorkingDays(numeric(e.target.value, { decimal: false }).slice(0, 2))}
            className="mise-well w-16 shrink-0 rounded-lg px-2.5 py-2 text-center text-sm tabular-nums outline-none"
          />
        </label>
      )}

      <input
        value={note}
        maxLength={500}
        aria-label="Note on the run"
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note on the run (optional)"
        className="mise-well w-full rounded-lg px-3 py-2 text-sm text-fg outline-none"
      />
    </div>
  );

  // ── right: who, and what each comes to ─────────────────────────────────────
  const who = (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search a name"
          aria-label="Search a name"
          className="mise-well min-h-[40px] w-full min-w-0 rounded-xl px-3 text-sm outline-none sm:w-44"
        />
        <div className="grid grid-cols-3 gap-1 sm:flex">
          {(
            [
              ["ALL", "Everyone"],
              ["HOURLY", "By the hour"],
              ["MONTHLY", "Salaried"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={payType === v}
              onClick={() => {
                setPayType(v);
                setPage(0);
              }}
              className={`mise-press min-h-[40px] rounded-xl px-3 text-xs ${
                payType === v ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {roles.length > 1 && (
          <div className="sm:w-40">
            <Select
              value={role}
              onChange={(v) => {
                setRole(v);
                setPage(0);
              }}
              options={[{ value: "", label: "Any job" }, ...roles.map((r) => ({ value: r, label: r }))]}
            />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
          {narrowed && (
            <button type="button" onClick={onlyShown} className={small}>
              Only these
            </button>
          )}
          <button type="button" onClick={() => tickShown(true)} className={small}>
            {narrowed ? "Tick these" : "Tick all"}
          </button>
          <button type="button" onClick={() => tickShown(false)} className={small}>
            {narrowed ? "Untick these" : "Untick all"}
          </button>
        </div>
      </div>

      <Said error={error ?? failed} />

      {unfinished.length > 0 && (
        <div className="space-y-2">
          {unfinished.slice(0, 2).map((p) => (
            <WaitingNote
              key={p.employee_id}
              name={p.name}
              items={p.waiting}
              format={format}
              left={left}
              busy={asking}
              act={waitingAct(p.employee_id, p.name)}
            />
          ))}
          {unfinished.length > 2 && (
            <p className="text-xs text-fg-faint">
              {`${peopleWord(unfinished.length - 2)} more with another run not finished: marked on their line. Open them to choose.`}
            </p>
          )}
        </div>
      )}
      {kept.map((p) => {
        const also = [...(picks[p.employee_id]?.also ?? [])].sort();
        return (
          <div
            key={`also-${p.employee_id}`}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-sm"
          >
            <p className="min-w-0 flex-1 text-fg-soft">
              {`${p.name}’s payslip here also covers ${also.length === 1 ? "1 more day" : `${also.length} more days`} (${sayRange(also[0], also[also.length - 1])}), taken in from another run. They stay in it when you save.`}
            </p>
            <Act
              label="Leave those days out"
              says="They go back to Owed so far, in no run."
              onClick={() => dropAlso(p.employee_id)}
            />
          </div>
        );
      })}

      <div className={`mise-card-inset min-h-[12rem] overflow-hidden p-0 transition-opacity ${loading && data ? "opacity-60" : ""}`}>
        {!data && loading ? (
          <p className="p-6 text-center text-sm text-fg-faint">Working it out…</p>
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-fg-faint">
            {rows.length ? "Nobody matches." : "Nobody on the team yet."}
          </p>
        ) : (
          <ul className="divide-y divide-line/60">
            {visible.map((p) => (
              <PersonRow
                key={p.employee_id}
                p={p}
                on={isTicked(p)}
                format={format}
                runBasis={basis}
                left={left}
                onTick={() => toggle(p.employee_id)}
                onOpen={() => setOpenId(p.employee_id)}
                pick={picks[p.employee_id] ?? { employee_id: p.employee_id }}
                onSay={(pick, tick) => {
                  say(p.employee_id, pick);
                  if (tick && !isTicked(p)) toggle(p.employee_id);
                }}
              />
            ))}
          </ul>
        )}
      </div>
      <Pager page={here} size={size} total={shown.length} onPage={setPage} />
    </div>
  );

  const summary = (
    <div className="min-w-0 text-sm">
      <p className="font-display text-xl font-semibold leading-tight tabular-nums text-fg">
        {format(total)}
        <span className="ml-2 text-xs font-normal text-fg-faint">
          {`${peopleWord(chosen.length)}${minutes ? ` · ${sayMinutes(minutes)}` : ""}`}
        </span>
      </p>
      {blocked.length > 0 ? (
        <p className="text-xs text-rose-400">
          {`${peopleWord(blocked.length)} can’t be paid like this. `}
          <button type="button" onClick={skipBlocked} className="font-semibold underline underline-offset-2">
            Skip them
          </button>
        </p>
      ) : leftOut > 0 ? (
        <p className="truncate text-xs text-fg-faint">
          {`${leftOut} ${leftOut === 1 ? "day" : "days"} already in another run, left out`}
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      <SheetPopup
        columns={4}
        onClose={onClose}
        title={start.title ?? (start.run ? `Change run ${start.run.number}` : "New run")}
        subtitle={start.subtitle ?? "Nothing is paid by saving. It starts as a draft."}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2">
            {summary}
            <div className="flex flex-1 gap-2 sm:flex-none">
              <button
                type="button"
                onClick={() => setSide(side === "when" ? "who" : "when")}
                className="mise-btn-flat mise-press min-h-[44px] flex-1 px-4 text-sm text-fg-soft lg:hidden"
              >
                {side === "when" ? "Who ›" : "‹ When"}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!ready || saving}
                className="mise-btn-key mise-press min-h-[44px] flex-1 px-5 text-sm font-semibold disabled:opacity-50"
              >
                {saving ? "Saving…" : start.run ? "Save the draft" : "Save as a draft"}
              </button>
            </div>
          </div>
        }
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className={side === "when" ? "" : "hidden lg:block"}>{when}</div>
          <div className={side === "who" ? "" : "hidden lg:block"}>{who}</div>
        </div>
      </SheetPopup>

      {pickDays && (
        <DayPickerPopup
          chosen={only}
          onChange={setOnly}
          onClose={() => setPickDays(false)}
        />
      )}

      {opened && (
        <PersonPlan
          key={opened.employee_id}
          base={base}
          person={opened}
          pick={picks[opened.employee_id] ?? { employee_id: opened.employee_id }}
          ticked={isTicked(opened)}
          onTick={() => toggle(opened.employee_id)}
          onChange={(p) => say(opened.employee_id, p)}
          onClose={() => setOpenId(null)}
          waiting={waitingAct(opened.employee_id, opened.name)}
          left={left}
          busy={asking}
        />
      )}

      {lookAt && (
        <RunSheet
          key={lookAt}
          id={lookAt}
          depth={2}
          canWrite
          onClose={() => {
            setLookAt(null);
            refresh();
          }}
          onChanged={refresh}
        />
      )}
    </>
  );
}

function PersonRow({
  p,
  on,
  format,
  runBasis,
  left,
  onTick,
  onOpen,
  pick,
  onSay,
}: {
  p: Person;
  on: boolean;
  format: (v: string) => string;
  runBasis: Basis;
  left: Set<string>;
  onTick: () => void;
  onOpen: () => void;
  pick: PersonIn;
  /** Something said about them from the list itself. `tick`: and put them in. */
  onSay: (pick: PersonIn, tick: boolean) => void;
}) {
  // Typed by hand, the box to type in is right there: no need to say so too.
  const flags = p.flags.filter((f) => !(p.basis === "MANUAL" && f.code === "typed_empty"));
  const chip = waitingChip(p.waiting.filter((w) => !left.has(w.payslip_id)));
  const shown = flags.slice(0, 2);
  // What can be put right from here, with one tap, without opening anybody.
  const days = p.flags.find((f) => f.code === "no_clock_out" || f.code === "no_hours");
  const marked = p.flags.find((f) => f.code === "marked_off");
  const noRate =
    (p.flags.some((f) => f.code === "no_rate") || pick.rate != null) && p.basis !== "SALARY" && p.minutes + p.days > 0;
  const about = (more: DayPick[], dates: string[]) =>
    onSay(
      { ...pick, days: [...(pick.days ?? []).filter((d) => !dates.includes(d.date)), ...more] },
      false,
    );
  const fix = "mise-btn-flat mise-press min-h-[34px] px-2.5 text-[11px] font-semibold text-fg-soft";
  const different = p.basis !== (runBasis === "AUTO" ? "ATTENDANCE" : runBasis);
  const extras = p.adjustments.length > 0 || p.advance !== "0.00";
  const byHand = p.basis === "MANUAL";
  return (
    <li className={`px-1.5 ${on || byHand || noRate ? "" : "opacity-70"}`}>
      <div className="flex items-center gap-1">
      <Tick on={on} onChange={onTick} label={`${on ? "Leave out" : "Pay"} ${p.name}`} />
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 rounded-xl py-1.5 pl-1 pr-2 text-left transition hover:bg-glass/5"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-fg">
            {p.name}
            {p.job_title && <span className="ml-1.5 text-xs font-normal text-fg-faint">{p.job_title}</span>}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-fg-faint">
            <span className="whitespace-nowrap">
              {p.pay_type === "HOURLY" || p.minutes
                ? `${sayDays(p.days, p.half_days)} · ${sayMinutes(p.minutes)}`
                : sayDays(p.days, p.half_days)}
            </span>
            <span className="whitespace-nowrap">
              {`· ${p.rate ? `${format(p.rate)} ${rateWord(p.rate, p.pay_type)}` : "no rate"}${p.rate_typed ? " (this run)" : ""}`}
            </span>
            {chip && <span className="mise-chip !text-[10px]" data-tone={chip.tone}>{chip.text}</span>}
            {different && <span className="mise-chip !text-[10px]" data-tone="sky">{basisWord(p.basis)}</span>}
            {extras && <span className="mise-chip !text-[10px]" data-tone="slate">extras</span>}
            {p.hold && <span className="mise-chip !text-[10px]" data-tone="amber">on hold</span>}
            {shown.map((f) => (
              <span key={f.code} className="mise-chip !text-[10px]" data-tone={f.blocking ? "red" : "amber"}>
                {f.text}
              </span>
            ))}
            {flags.length > shown.length && <span>{`+${flags.length - shown.length}`}</span>}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-display text-base font-semibold tabular-nums text-fg">{format(p.net)}</span>
        </span>
        <span aria-hidden className="text-fg-faint">›</span>
      </button>
      {byHand && (
        // Beside the name on a laptop; under it on a phone, where beside it
        // squeezes the name down to nothing.
        <span className="hidden sm:block">
          <MoneyInput
            label={`Amount for ${p.name}`}
            value={pick.amount ?? null}
            className="mr-1 w-24 shrink-0"
            onMoney={(amount) => onSay({ ...pick, amount }, amount !== null)}
          />
        </span>
      )}
      </div>
      {byHand && (
        <label className="flex items-center gap-2 pb-2 pl-12 text-[11px] text-fg-faint sm:hidden">
          The amount
          <MoneyInput
            label={`Amount for ${p.name}`}
            value={pick.amount ?? null}
            className="w-28"
            onMoney={(amount) => onSay({ ...pick, amount }, amount !== null)}
          />
        </label>
      )}
      {(days || marked || noRate) && (
        <div className="flex flex-wrap items-center gap-1.5 pb-2 pl-12">
          {days && days.rota.length > 0 && days.rota.every((m) => m > 0) && (
            <button
              type="button"
              className={fix}
              onClick={() =>
                about(
                  days.dates.map((date, i) => ({ date, minutes: days.rota[i] })),
                  days.dates,
                )
              }
            >
              {`Use the rota, ${sayMinutes(days.rota.reduce((t, m) => t + m, 0))}`}
            </button>
          )}
          {days && (
            <button
              type="button"
              className={fix}
              onClick={() => about(days.dates.map((date) => ({ date, include: false })), days.dates)}
            >
              {days.dates.length === 1 ? "Skip that day" : "Skip those days"}
            </button>
          )}
          {marked && (
            <>
              <button
                type="button"
                className={fix}
                onClick={() => about(marked.dates.map((date) => ({ date, include: true })), marked.dates)}
              >
                They worked, put it in
              </button>
              <button
                type="button"
                className={fix}
                onClick={() => about(marked.dates.map((date) => ({ date, include: false })), marked.dates)}
              >
                Leave it out
              </button>
            </>
          )}
          {noRate && (
            <label className="flex items-center gap-1.5 text-[11px] text-fg-faint">
              Rate for this run
              <MoneyInput
                label={`Rate for ${p.name}, this run only`}
                value={pick.rate ?? null}
                className="w-20"
                onMoney={(rate) => onSay({ ...pick, rate }, rate !== null)}
              />
              {p.salary_type === "HOURLY" ? "an hour" : "a month"}
            </label>
          )}
        </div>
      )}
    </li>
  );
}
