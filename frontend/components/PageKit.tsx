"use client";

// The three bits of furniture every money page kept re-inventing.
//
//   "please be consistent in UI (staff, purchase page ui ux, buttons styles —
//    follow those). our whole app needs to follow same kinda style, don't miss
//    and spoil the beauty."
//
// Sales, Expenses, Money and P&L each grew their own date control, their own
// row of export buttons and their own band of four big stat cards. Same three
// jobs, four sets of code, four slightly different results — the sales page had
// `mise-raised` buttons while everything else had moved to `mise-btn-flat`, and
// that difference is visible on the screen even when you cannot name it.
//
// The other half of the problem is SPACE. Four StatCards is roughly 230px of
// figures nobody came to read, sitting directly on top of the thing the page is
// actually for. His words: "so many unwanted are taking so many space rather
// than core". These primitives keep the same information and give the core
// about 300px of its height back.

import { useEffect, useRef, useState, type ReactNode } from "react";

import { SheetPopup } from "@/components/SheetPopup";

/* ── Totals, on one line ──────────────────────────────────────────────────
 *
 * The same four figures as the StatCard band, in a fifth of the height.
 *
 * A StatCard earns its size on a dashboard, where the figure IS the content.
 * On Sales the figures are a consequence of the work, so they sit as a quiet
 * strip and the entry sheet gets the room. Two columns on a phone, one row
 * from `sm` up, hairlines between rather than four separate cards — one object
 * reads as a summary, four read as four things to look at.
 */
export function TotalsStrip({
  items,
  className = "",
}: {
  items: {
    label: string;
    value: ReactNode;
    hint?: ReactNode;
    tone?: "plain" | "good" | "bad" | "warn";
    /** The figure the page is really about — rendered a size larger. */
    strong?: boolean;
  }[];
  className?: string;
}) {
  const tones: Record<string, string> = {
    plain: "text-fg",
    good: "text-brand-300",
    bad: "text-rose-300",
    warn: "text-amber-300",
  };
  return (
    <div
      className={`mise-card-inset grid grid-cols-2 gap-px overflow-hidden p-0 sm:grid-cols-4 ${className}`}
    >
      {items.map((it, i) => (
        <div
          key={i}
          className={`px-4 py-3 ${
            // Hairlines, not gaps: the strip is one object.
            i % 2 === 1 ? "border-l border-line/60" : ""
          } ${i >= 2 ? "border-t border-line/60 sm:border-t-0" : ""} ${
            i > 0 ? "sm:border-l sm:border-line/60" : "sm:border-l-0"
          }`}
        >
          <p className="truncate text-[10px] font-medium uppercase tracking-wide text-fg-faint">
            {it.label}
          </p>
          <p
            className={`mt-0.5 font-display font-semibold tabular-nums ${
              it.strong ? "text-xl" : "text-lg"
            } ${tones[it.tone ?? "plain"]}`}
          >
            {it.value}
          </p>
          {it.hint && (
            <p className="mt-0.5 truncate text-[10px] text-fg-faint">{it.hint}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── The overflow, as a popup of tiles ────────────────────────────────────
 *
 * Import, Template, CSV, PDF — four buttons in a row, on every money page,
 * above the work. They are used perhaps once a month each.
 *
 * This is the purchasing idiom he keeps pointing at: one small control opens a
 * popup of big obvious tiles. The row costs 40px instead of a wrapped line of
 * four, the tiles inside are 64px tall and actually thumb-sized, and every page
 * that has secondary actions now presents them the same way.
 */
export type PageAction = {
  key: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  tone?: "plain" | "brand" | "danger";
  onSelect: () => void;
};

export function PageMore({
  actions,
  title = "More",
  subtitle,
  label = "More actions",
  className = "",
}: {
  actions: PageAction[];
  title?: string;
  subtitle?: string;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        // min-h-[40px]: the mobile audit found the app full of 24–30px controls,
        // and a control you miss with a thumb is a control that does not exist.
        className={`mise-btn-flat mise-press grid min-h-[40px] w-10 place-items-center text-lg leading-none text-fg-soft ${className}`}
      >
        ⋯
      </button>
      {open && (
        <SheetPopup
          onClose={() => setOpen(false)}
          title={title}
          subtitle={subtitle}
          columns={2}
        >
          <div className="mise-stagger grid gap-2 sm:grid-cols-2">
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => {
                  setOpen(false);
                  a.onSelect();
                }}
                data-tone={a.tone === "plain" ? undefined : a.tone}
                className="mise-btn-flat mise-press flex min-h-[64px] items-center gap-3 px-4 py-3 text-left"
              >
                {a.icon && (
                  <span aria-hidden className="shrink-0 text-xl leading-none">
                    {a.icon}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-fg">
                    {a.label}
                  </span>
                  {a.hint && (
                    <span className="block truncate text-[11px] text-fg-faint">
                      {a.hint}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </SheetPopup>
      )}
    </>
  );
}

/* ── One day, stepped ─────────────────────────────────────────────────────
 *
 * Sales is a per-DAY page, so it never wanted the from/to range picker — but it
 * had a bare `<input type="date">` next to a "Date" label, which looks like
 * nothing else in the app. This matches TimeRangePicker's shape (‹ pill ›) so a
 * day page and a range page feel like the same family, and the pill itself
 * opens the native date picker rather than being a second control beside it.
 */
export function DayStepper({
  value,
  onChange,
  max,
  className = "",
}: {
  value: string;
  onChange: (d: string) => void;
  /** Usually today — takings cannot be recorded for a day that has not been. */
  max?: string;
  className?: string;
}) {
  const dateRef = useRef<HTMLInputElement>(null);
  const shift = (days: number) => {
    const d = new Date(value + "T00:00:00");
    d.setDate(d.getDate() + days);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    if (max && iso > max) return;
    onChange(iso);
  };
  const atMax = Boolean(max && value >= max);
  const label = (() => {
    if (max && value === max) return "Today";
    const d = new Date(value + "T00:00:00");
    return d.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  })();

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => shift(-1)}
        aria-label="Previous day"
        className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-paper-2/60 text-fg-soft transition hover:bg-paper-2 hover:text-fg"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={() => {
          // showPicker() is the only way to open the native calendar from a
          // button; where it is missing (older Safari) focusing the input at
          // least puts the keyboard on the field.
          const el = dateRef.current;
          if (!el) return;
          try {
            (el as HTMLInputElement & { showPicker?: () => void }).showPicker?.();
          } catch {
            el.focus();
          }
        }}
        className="mise-press relative inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-line-2 bg-paper-2/60 px-3.5 py-2 text-sm font-medium text-fg transition hover:bg-paper-2"
      >
        <span aria-hidden>📅</span>
        {label}
        <input
          ref={dateRef}
          type="date"
          value={value}
          max={max}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          // Present for the picker and for keyboard users, invisible so the
          // pill stays a pill. Not `display:none` — showPicker() refuses on a
          // hidden input.
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Pick a date"
        />
      </button>
      <button
        type="button"
        onClick={() => shift(1)}
        disabled={atMax}
        aria-label="Next day"
        className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-paper-2/60 text-fg-soft transition hover:bg-paper-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
      >
        ›
      </button>
    </div>
  );
}

/* ── The save that is always in reach ─────────────────────────────────────
 *
 * A `position: sticky; bottom` bar inside a tall container does not do what it
 * looks like it does: when the container runs past the bottom of the viewport
 * the bar is lifted UP out of its slot and drawn OVER the rows above it. That
 * is the sales page in his screenshot — a CARD/CASH/ONLINE/BANK bar sitting on
 * top of the channel list, hiding the row behind it. It was my fix for the save
 * button being off-screen, and it traded one fault for a worse one.
 *
 * This is the honest version. The real button stays in the card footer, in
 * normal flow, where it can never cover anything. This watches that button, and
 * only while it is off-screen does a small fixed pill appear at the bottom of
 * the WINDOW — fixed, so it has no container to overlap and no way to land in
 * the middle of a list. Different words on it too ("Save 3 takings" vs the
 * footer's own label), so there are never two identical buttons for a test —
 * or a person — to confuse.
 */
export function ReachBar({
  watch,
  show,
  children,
}: {
  /** The in-flow element this stands in for. */
  watch: React.RefObject<HTMLElement | null>;
  /** Whether there is anything worth saving at all. */
  show: boolean;
  children: ReactNode;
}) {
  const [away, setAway] = useState(false);

  useEffect(() => {
    const el = watch.current;
    if (!el || !show) {
      setAway(false);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => setAway(!e.isIntersecting),
      { rootMargin: "0px 0px -8px 0px", threshold: 0.9 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [watch, show]);

  if (!show || !away) return null;
  return (
    <div
      // Centred, and nudged left of centre on large screens so it never meets
      // the voice bubble in the bottom-right corner.
      className="mise-pop pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-line-2 bg-paper/95 px-3 py-2 shadow-2xl shadow-black/30 backdrop-blur">
        {children}
      </div>
    </div>
  );
}
