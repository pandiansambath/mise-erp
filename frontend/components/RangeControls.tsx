"use client";

// The one time-range control for every screen that asks "what period am I looking at?"
// CloudWatch-style: a single compact trigger that opens a popover with QUICK ranges,
// RELATIVE time ("the last N days/weeks/months") and ABSOLUTE from/to — instead of two
// bare date boxes buried in a toolbar.
import { useEffect, useRef, useState } from "react";
import { localISODate } from "@/lib/date";

export type Range = { from: string; to: string };

const shift = (n: number) => {
  const x = new Date();
  x.setDate(x.getDate() + n);
  return x;
};
const monthStartDate = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), 1);
};
const weekStartOffset = () => (new Date().getDay() + 6) % 7; // 0 = Monday

export const RANGE_PRESETS: { key: string; label: string; make: () => Range }[] = [
  { key: "today", label: "Today", make: () => ({ from: localISODate(), to: localISODate() }) },
  { key: "yday", label: "Yesterday", make: () => ({ from: localISODate(shift(-1)), to: localISODate(shift(-1)) }) },
  { key: "wtd", label: "This week", make: () => ({ from: localISODate(shift(-weekStartOffset())), to: localISODate() }) },
  { key: "7d", label: "Last 7 days", make: () => ({ from: localISODate(shift(-6)), to: localISODate() }) },
  { key: "mtd", label: "This month", make: () => ({ from: localISODate(monthStartDate()), to: localISODate() }) },
  { key: "30d", label: "Last 30 days", make: () => ({ from: localISODate(shift(-29)), to: localISODate() }) },
  { key: "90d", label: "Last 90 days", make: () => ({ from: localISODate(shift(-89)), to: localISODate() }) },
  {
    key: "lastmonth",
    label: "Last month",
    make: () => {
      const t = new Date();
      return {
        from: localISODate(new Date(t.getFullYear(), t.getMonth() - 1, 1)),
        to: localISODate(new Date(t.getFullYear(), t.getMonth(), 0)),
      };
    },
  },
  {
    key: "ytd",
    label: "This year",
    make: () => ({ from: localISODate(new Date(new Date().getFullYear(), 0, 1)), to: localISODate() }),
  },
];

/** Which preset (if any) exactly matches the current range — so we can highlight it. */
export function activePreset(range: Range): string | null {
  for (const p of RANGE_PRESETS) {
    const r = p.make();
    if (r.from === range.from && r.to === range.to) return p.key;
  }
  return null;
}

/** Human caption: "Today", "This month (1 Jul – 2 Jul)", or "12 Jun – 30 Jun". */
export function rangeCaption(range: Range): string {
  const fmt = (s: string) => {
    const d = new Date(s + "T00:00:00");
    return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
  };
  const key = activePreset(range);
  const label = RANGE_PRESETS.find((p) => p.key === key)?.label;
  const span = range.from === range.to ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`;
  if (label && label !== "Today" && label !== "Yesterday") return `${label} (${span})`;
  return label ?? span;
}

/** Inclusive day count of a range — seeds the Relative tab from what's on screen. */
function spanDays(r: Range): number {
  const a = new Date(r.from + "T00:00:00").getTime();
  const b = new Date(r.to + "T00:00:00").getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 7;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

type Unit = "days" | "weeks" | "months";

function relativeRange(n: number, unit: Unit): Range {
  const to = new Date();
  const from = new Date();
  if (unit === "days") from.setDate(to.getDate() - (n - 1));
  if (unit === "weeks") from.setDate(to.getDate() - (n * 7 - 1));
  if (unit === "months") from.setMonth(to.getMonth() - n);
  return { from: localISODate(from), to: localISODate(to) };
}

/**
 * One button, one popover: Quick / Relative / Absolute.
 * Drop it anywhere a screen filters by period.
 */
export function TimeRangePicker({
  range,
  onChange,
  className = "",
  align = "left",
}: {
  range: Range;
  onChange: (r: Range) => void;
  className?: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"quick" | "relative" | "absolute">("quick");
  const [n, setN] = useState(7);
  const [unit, setUnit] = useState<Unit>("days");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const wrap = useRef<HTMLDivElement>(null);

  // Whenever it opens, start from whatever the page is currently showing.
  useEffect(() => {
    if (open) {
      setFrom(range.from);
      setTo(range.to);
      setN(spanDays(range));
    }
  }, [open, range]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (r: Range) => { onChange(r); setOpen(false); };
  const active = activePreset(range);

  return (
    <div ref={wrap} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="mise-press inline-flex items-center gap-2 rounded-xl border border-line-2 bg-paper-2/60 px-3.5 py-2 text-sm font-medium text-fg transition hover:bg-paper-2"
      >
        <span aria-hidden>🗓</span>
        <span>{rangeCaption(range)}</span>
        <span aria-hidden className={`text-fg-faint transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open && (
        <div
          role="dialog"
          // z-[60] and a SOLID background: at z-40 the toast and the Copilot
          // launcher (both z-50) rendered over it, and a translucent panel let
          // them bleed through — a date picker you can read another element
          // through is unusable.
          className={`mise-pop absolute z-[60] mt-2 w-[min(92vw,420px)] overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl shadow-black/50 backdrop-blur-xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div className="flex border-b border-line">
            {([["quick", "Quick"], ["relative", "Relative"], ["absolute", "Absolute"]] as const).map(
              ([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`flex-1 px-3 py-2.5 text-xs font-semibold transition ${
                    tab === k ? "border-b-2 border-brand-500 text-fg" : "text-fg-faint hover:text-fg-soft"
                  }`}
                >
                  {label}
                </button>
              ),
            )}
          </div>

          <div className="p-3">
            {tab === "quick" && (
              <div className="grid grid-cols-2 gap-1.5">
                {RANGE_PRESETS.map((p) => {
                  const on = active === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => apply(p.make())}
                      className={`rounded-lg px-3 py-2 text-left text-xs font-medium transition ${
                        on ? "bg-brand-600 text-white" : "text-fg-soft hover:bg-paper-2"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}

            {tab === "relative" && (
              <div>
                <p className="text-[11px] text-fg-faint">Show the most recent…</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={999}
                    value={n}
                    onChange={(e) => setN(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
                    className="mise-well w-20 rounded-lg px-3 py-2 text-sm text-fg outline-none"
                  />
                  <div className="flex gap-1">
                    {(["days", "weeks", "months"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setUnit(u)}
                        className={`rounded-lg px-3 py-2 text-xs font-medium capitalize transition ${
                          unit === u
                            ? "bg-brand-600 text-white"
                            : "border border-line-2 text-fg-soft hover:bg-paper-2"
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-fg-faint">{rangeCaption(relativeRange(n, unit))}</p>
                <button
                  type="button"
                  onClick={() => apply(relativeRange(n, unit))}
                  className="mise-press mt-3 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Apply
                </button>
              </div>
            )}

            {tab === "absolute" && (
              <div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-fg-faint">From</span>
                    <input
                      type="date"
                      value={from}
                      max={to}
                      onChange={(e) => setFrom(e.target.value)}
                      className="mise-well mt-1 w-full rounded-lg px-2.5 py-2 text-sm text-fg outline-none"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] font-semibold uppercase tracking-wide text-fg-faint">To</span>
                    <input
                      type="date"
                      value={to}
                      min={from}
                      onChange={(e) => setTo(e.target.value)}
                      className="mise-well mt-1 w-full rounded-lg px-2.5 py-2 text-sm text-fg outline-none"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  disabled={!from || !to || from > to}
                  onClick={() => apply({ from, to })}
                  className="mise-press mt-3 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Back-compat: existing callers keep their API and get the new picker for free. */
export function RangeControls({
  range,
  onChange,
  className = "",
}: {
  range: Range;
  onChange: (r: Range) => void;
  className?: string;
}) {
  return <TimeRangePicker range={range} onChange={onChange} className={className} />;
}
