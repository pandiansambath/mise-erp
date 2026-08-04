"use client";

// The one time-range control for every screen that asks "what period am I looking at?"
// CloudWatch-style: a single compact trigger that opens a popover with QUICK ranges,
// RELATIVE time ("the last N days/weeks/months") and ABSOLUTE from/to — instead of two
// bare date boxes buried in a toolbar.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { localISODate } from "@/lib/date";

export type Range = { from: string; to: string };

/** Today, local. The ceiling for any "what happened" date input. */
const TODAY = localISODate();

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


/** Shift a range backwards or forwards by its own length.
 *
 *  This is what "move to previous dates" actually needs. The Quick presets stop
 *  at "Last month", so reaching June meant opening Absolute and typing two dates
 *  by hand — for the commonest action on the page. One tap now steps a day back
 *  from a day, a week from a week, a month from a month.
 *
 *  Whole CALENDAR months are stepped as months, not as "30 days": stepping back
 *  from 1–31 August by 30 days lands on 2–31 July, which is not what anybody
 *  means by "last month".
 */
export function shiftRange(range: Range, direction: -1 | 1): Range {
  const from = new Date(range.from + "T00:00:00");
  const to = new Date(range.to + "T00:00:00");

  const isMonth =
    from.getDate() === 1 &&
    to.getDate() === new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate() &&
    from.getMonth() === to.getMonth() &&
    from.getFullYear() === to.getFullYear();

  if (isMonth) {
    const m = new Date(from.getFullYear(), from.getMonth() + direction, 1);
    return {
      from: localISODate(m),
      to: localISODate(new Date(m.getFullYear(), m.getMonth() + 1, 0)),
    };
  }

  // Otherwise slide by the span, inclusive of both ends.
  const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
  const shift = days * direction;
  from.setDate(from.getDate() + shift);
  to.setDate(to.getDate() + shift);
  return { from: localISODate(from), to: localISODate(to) };
}


/** "3 Aug" for one day, "1 – 31 Jul" within a month, "28 Jul – 3 Aug" across.
 *  Short on purpose: this sits under a preset label in a narrow tile. */
function shortSpan(r: Range): string {
  const f = new Date(r.from + "T00:00:00");
  const t = new Date(r.to + "T00:00:00");
  const d = (x: Date) => x.getDate();
  const m = (x: Date) => x.toLocaleDateString(undefined, { month: "short" });
  if (r.from === r.to) return `${d(f)} ${m(f)}`;
  if (f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear()) {
    return `${d(f)} – ${d(t)} ${m(t)}`;
  }
  return `${d(f)} ${m(f)} – ${d(t)} ${m(t)}`;
}

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
  // Portals need the DOM, so nothing renders on the server pass.
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 420 });

  useEffect(() => setMounted(true), []);

  // Measure when opening: place it under the trigger, and pull it back on-screen
  // if it would run off the right edge (which it did on the attendance page).
  useEffect(() => {
    if (!open || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    const width = Math.min(420, window.innerWidth - 24);
    const left =
      align === "right"
        ? Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12))
        : Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    setPos({ top: r.bottom + 8, left, width });
  }, [open, align]);
  const [n, setN] = useState(7);
  const [unit, setUnit] = useState<Unit>("days");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const wrap = useRef<HTMLDivElement>(null);
  // The portalled panel, so the outside-click check can see it.
  const panel = useRef<HTMLDivElement>(null);

  // Seed the draft dates from the page's current range — but ONLY on the
  // transition into open.
  //
  // This used to run on every render while open, because `range` is passed as an
  // inline {from, to} literal, so it is a NEW OBJECT on each parent render and
  // never equal by identity. The effect therefore re-fired constantly and wrote
  // the page's existing range back over whatever the user had just typed: pick
  // an earlier "From", it snapped straight back. That is the "can't move to
  // previous dates" bug, and it hit expenses, reports and attendance alike.
  //
  // Tracking the previous open state makes the seed happen once per opening, so
  // the draft is the user's to edit while the panel stays up.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setFrom(range.from);
      setTo(range.to);
      setN(spanDays(range));
    }
    wasOpen.current = open;
  }, [open, range]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      // The panel is PORTALLED to <body>, so it is not inside `wrap` — testing
      // only `wrap` meant every click inside the panel counted as "outside".
      // mousedown closed it, the button unmounted, and the click never landed:
      // presets did nothing while the arrows (which ARE inside wrap) worked
      // fine. Both containers have to count as inside.
      const t = e.target as Node;
      if (wrap.current?.contains(t)) return;
      if (panel.current?.contains(t)) return;
      setOpen(false);
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

  // Stepping forward must not walk into the future: these ranges report on what
  // already happened, and an empty future period looks like lost data.
  const nextRange = shiftRange(range, 1);
  const canGoForward = nextRange.from <= TODAY;

  return (
    <div ref={wrap} className={`relative inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => onChange(shiftRange(range, -1))}
        aria-label="Previous period"
        title="Previous period"
        className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-paper-2/60 text-fg-soft transition hover:bg-paper-2 hover:text-fg"
      >
        ‹
      </button>
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
      <button
        type="button"
        onClick={() => canGoForward && onChange(nextRange)}
        disabled={!canGoForward}
        aria-label="Next period"
        title={canGoForward ? "Next period" : "That would be in the future"}
        className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-paper-2/60 text-fg-soft transition hover:bg-paper-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-paper-2/60"
      >
        ›
      </button>

      {open && mounted && createPortal(
        <div
          ref={panel}
          role="dialog"
          // Portalled to <body> and FIXED. An absolute panel is trapped inside
          // any ancestor with a stacking context (a transform, filter or
          // opacity anywhere up the tree), which is why bumping z-index alone
          // never lifted it above the toast — the toast was in a different
          // context entirely. Position is measured from the trigger below.
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          className="mise-pop fixed z-[100] overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl shadow-black/60 ring-1 ring-black/5"
        >
          <div className="flex items-center gap-1 border-b border-line bg-paper-2/40 p-1.5">
            {([
              ["quick", "Quick", "⚡"],
              ["relative", "Relative", "↻"],
              ["absolute", "Absolute", "📅"],
            ] as const).map(([k, label, icon]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`mise-press flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  tab === k
                    ? "bg-paper text-fg shadow-sm"
                    : "text-fg-faint hover:bg-paper/60 hover:text-fg-soft"
                }`}
              >
                <span aria-hidden className="text-[11px] opacity-70">{icon}</span>
                {label}
              </button>
            ))}
          </div>

          <div className="p-3">
            {tab === "quick" && (
              <div className="grid grid-cols-2 gap-1.5">
                {RANGE_PRESETS.map((p) => {
                  const on = active === p.key;
                  // Show the dates each preset resolves to. "Last month" is a
                  // guess until you see "1 Jul - 31 Jul"; with the dates there
                  // is nothing to work out and nothing to get wrong.
                  const r = p.make();
                  const span = spanDays(r);
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => apply(r)}
                      className={`mise-press rounded-xl border px-3 py-2 text-left transition ${
                        on
                          ? "border-transparent bg-brand-600 text-white shadow-sm"
                          : "border-transparent text-fg-soft hover:border-line hover:bg-paper-2"
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">{p.label}</span>
                        {span > 1 && (
                          <span className={`text-[9px] tabular-nums ${on ? "text-white/70" : "text-fg-faint"}`}>
                            {span}d
                          </span>
                        )}
                      </span>
                      <span className={`mt-0.5 block truncate text-[10px] tabular-nums ${
                        on ? "text-white/80" : "text-fg-faint"
                      }`}>
                        {shortSpan(r)}
                      </span>
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
                      // Never past today: every range this picker drives reports
                      // on what already happened, and a future "from" silently
                      // returns an empty period that looks like lost data.
                      max={to < TODAY ? to : TODAY}
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
                      max={TODAY}
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

          {/* What is selected right now. The trigger button is often covered by
              this panel, so without it you lose track of what you are changing. */}
          <div className="flex items-center justify-between gap-2 border-t border-line bg-paper-2/40 px-3 py-2">
            <span className="truncate text-[11px] text-fg-faint">
              Showing <b className="text-fg-soft">{rangeCaption(range)}</b>
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mise-press shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium text-fg-faint transition hover:bg-paper hover:text-fg"
            >
              Close
            </button>
          </div>
        </div>,
        document.body,
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
