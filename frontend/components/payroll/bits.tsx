"use client";

// The small pieces every payroll popup uses, once each.

import { useEffect, useState, type ReactNode } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import {
  addMonths,
  daysBetween,
  monthEnd,
  monthName,
  monthStart,
  pence,
  sayMinutes,
  today,
  typedMoney,
  weekday,
  WEEKDAYS,
} from "@/components/payroll/lib";
import { numeric } from "@/lib/sanitize";

/** A phone, where a page of a list holds fewer things before it scrolls. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 639px)");
    const tell = () => setNarrow(q.matches);
    tell();
    q.addEventListener("change", tell);
    return () => q.removeEventListener("change", tell);
  }, []);
  return narrow;
}

/** A tick that is big enough for a thumb. */
export function Tick({
  on,
  onChange,
  label,
  disabled = false,
}: {
  on: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="mise-press grid h-10 w-10 shrink-0 place-items-center rounded-xl disabled:opacity-40"
    >
      <span
        aria-hidden
        className={`grid h-6 w-6 place-items-center rounded-lg text-sm font-bold transition ${
          on ? "bg-brand-600 text-white" : "mise-well text-transparent"
        }`}
      >
        ✓
      </span>
    </button>
  );
}

/** One figure in a row of them. */
export function Figure({
  label,
  value,
  tone = "text-fg",
  strong = false,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div className="mise-well min-w-0 rounded-xl px-3 py-2">
      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-fg-faint">
        {label}
      </p>
      <p
        className={`truncate font-display font-semibold tabular-nums ${
          strong ? "text-sm sm:text-lg" : "text-sm"
        } ${tone}`}
      >
        {value}
      </p>
    </div>
  );
}

/** A choice among a few, each a button: no list to open. */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  columns = "grid-cols-3",
  small = false,
}: {
  value: T | null;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  columns?: string;
  small?: boolean;
}) {
  return (
    <div className={`grid gap-1.5 ${columns}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`mise-press rounded-xl px-2 py-1.5 leading-tight ${
            small ? "min-h-[34px] text-xs" : "min-h-[40px] text-[13px]"
          } ${value === o.value ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pages of a list, clicked and not scrolled. */
export function Pager({
  page,
  size,
  total,
  onPage,
}: {
  page: number;
  size: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (total <= size) return null;
  const last = Math.ceil(total / size) - 1;
  const step = "mise-btn-flat mise-press grid h-9 w-9 place-items-center text-fg-soft";
  return (
    <div className="flex items-center gap-2 text-xs text-fg-faint">
      <button
        type="button"
        aria-label="Earlier in the list"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
        className={step}
      >
        ‹
      </button>
      <span className="whitespace-nowrap tabular-nums">
        {`${page * size + 1} to ${Math.min(total, (page + 1) * size)} of ${total}`}
      </span>
      <button
        type="button"
        aria-label="Later in the list"
        disabled={page >= last}
        onClick={() => onPage(page + 1)}
        className={step}
      >
        ›
      </button>
    </div>
  );
}

/** Hours and minutes, typed apart. "7.5" and "7.30" are the same five keys and
 *  half an hour's pay different, so there is no one box to type them in. */
export function HoursInput({
  minutes,
  onChange,
  max = 24 * 60,
  label,
}: {
  minutes: number | null;
  onChange: (m: number | null) => void;
  max?: number;
  label: string;
}) {
  const [h, setH] = useState(minutes === null ? "" : String(Math.floor(minutes / 60)));
  const [m, setM] = useState(minutes === null ? "" : String(minutes % 60));
  const tell = (hh: string, mm: string) => {
    if (hh === "" && mm === "") return onChange(null);
    const total = (parseInt(hh || "0", 10) || 0) * 60 + Math.min(59, parseInt(mm || "0", 10) || 0);
    onChange(Math.min(max, total));
  };
  const box = "mise-well w-16 rounded-lg px-2.5 py-2 text-center text-sm tabular-nums outline-none";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-fg-soft">
      <input
        aria-label={`${label}, hours`}
        inputMode="numeric"
        value={h}
        placeholder="0"
        onChange={(e) => {
          const v = numeric(e.target.value, { decimal: false }).slice(0, 4);
          setH(v);
          tell(v, m);
        }}
        className={box}
      />
      h
      <input
        aria-label={`${label}, minutes`}
        inputMode="numeric"
        value={m}
        placeholder="0"
        onChange={(e) => {
          const v = numeric(e.target.value, { decimal: false }).slice(0, 2);
          setM(v);
          tell(h, v);
        }}
        className={box}
      />
      m
    </span>
  );
}

/** Money, typed. What is half typed ("12.") stays on the screen and goes
 *  nowhere: only an amount is told, or that there is none. */
export function MoneyInput({
  value,
  onMoney,
  label,
  placeholder = "0.00",
  className = "w-28",
  zero = false,
}: {
  value: string | null;
  onMoney: (v: string | null) => void;
  label: string;
  placeholder?: string;
  className?: string;
  /** Nothing at all is an answer of its own, and not the same as 0. */
  zero?: boolean;
}) {
  const [raw, setRaw] = useState(value ?? "");
  return (
    <input
      value={raw}
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = numeric(e.target.value);
        const money = typedMoney(v);
        if (v !== "" && !money) return;
        setRaw(v);
        onMoney(money && (zero || pence(money) > 0) ? money : null);
      }}
      className={`mise-well min-w-0 rounded-lg px-2.5 py-2 text-right text-sm tabular-nums text-fg outline-none ${className}`}
    />
  );
}

/** A month of days, each one a tap: in or out. */
export function DayPickerPopup({
  chosen,
  onChange,
  onClose,
  depth = 2,
}: {
  chosen: string[];
  onChange: (days: string[]) => void;
  onClose: () => void;
  depth?: 2 | 3;
}) {
  const [month, setMonth] = useState(monthStart(chosen[chosen.length - 1] ?? today()));
  const set = new Set(chosen);
  const days = daysBetween(month, monthEnd(month));
  const toggle = (d: string) => {
    const next = new Set(set);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    onChange([...next].sort());
  };
  const step = "mise-btn-flat mise-press grid h-10 w-10 place-items-center text-fg-soft";
  return (
    <SheetPopup
      depth={depth}
      onClose={onClose}
      title="Pick the days"
      subtitle={`${chosen.length} picked`}
      footer={
        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => onChange([])}
            className="mise-btn-flat mise-press px-4 py-2 text-sm text-fg-soft"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mise-btn-key mise-press px-5 py-2 text-sm font-semibold"
          >
            Done
          </button>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label="Month before" className={step} onClick={() => setMonth(addMonths(month, -1))}>
          ‹
        </button>
        <p className="font-display text-base font-semibold text-fg">{monthName(month)}</p>
        <button type="button" aria-label="Month after" className={step} onClick={() => setMonth(addMonths(month, 1))}>
          ›
        </button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="text-[10px] font-medium uppercase text-fg-faint">
            {w}
          </span>
        ))}
        {Array.from({ length: weekday(month) }, (_, i) => (
          <span key={`gap-${i}`} aria-hidden />
        ))}
        {days.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={set.has(d)}
            onClick={() => toggle(d)}
            className={`mise-press h-10 rounded-xl text-sm tabular-nums ${
              set.has(d) ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"
            }`}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </SheetPopup>
  );
}

/** A line of a payslip: what, and how much, with dots between. */
export function MoneyLine({
  label,
  value,
  tone = "text-fg-soft",
  strong = false,
}: {
  label: ReactNode;
  value: string;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-baseline gap-2 text-sm ${strong ? "font-semibold" : ""}`}>
      <span className={strong ? "text-fg" : "text-fg-faint"}>{label}</span>
      <span className="mb-1 flex-1 border-b border-dotted border-line" />
      <span className={`tabular-nums ${strong ? "text-lg" : ""} ${tone}`}>{value}</span>
    </div>
  );
}

export const hoursOr = (minutes: number, none = "no hours"): string =>
  minutes ? sayMinutes(minutes) : none;

/** Something went wrong, or something to know, where the person is looking. */
export function Said({ error, note }: { error?: string | null; note?: string | null }) {
  if (!error && !note) return null;
  return error ? (
    <p role="alert" className="mise-shake rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-400">
      {error}
    </p>
  ) : (
    <p className="mise-well rounded-xl px-3 py-2 text-sm text-fg-soft">{note}</p>
  );
}
