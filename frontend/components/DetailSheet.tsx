"use client";

// Click a row → everything about it opens in place. No hunting, no scrolling to a
// panel three screens down. A side sheet on desktop (wide, room for real detail) and
// a bottom sheet on phones, which is where thumbs already are.
//
// The header is the point. The recipe costing stage works because the number you
// opened the row FOR - the margin - sits in the header and never moves; the body
// scrolls underneath it. This sheet used to put its stats inside the scroll area,
// so you opened a vendor and still had to scroll before learning anything. That is
// the same complaint as having no sheet at all.
//
// So the icon tile, the headline gauge and the stat band all sit OUTSIDE the
// scrolling region. Whatever you came to find is on screen the moment it opens.
//
// Still deliberately dumb about content: it owns presentation (backdrop, focus trap,
// escape, scroll lock) and nothing else, so every section pours its own content in.

import { useEffect, useRef, type ReactNode } from "react";

import { useBackToClose } from "./useBackToClose";

export function DetailSheet({
  open,
  onClose,
  title,
  subtitle,
  badge,
  icon,
  ring,
  stats,
  actions,
  children,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Small status chip beside the title. */
  badge?: ReactNode;
  /** Emoji or glyph in a raised tile - makes the row identifiable at a glance. */
  icon?: ReactNode;
  /** The headline metric, pinned in the header. Usually <SheetRing/>. */
  ring?: ReactNode;
  /** Key figures, pinned under the header and never scrolled away. */
  stats?: { label: string; value: ReactNode; hint?: ReactNode; tone?: "good" | "warn" | "bad" | "plain" }[];
  /** Sticky footer actions (buttons). */
  actions?: ReactNode;
  children: ReactNode;
  width?: "md" | "lg";
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Back closes the overlay rather than leaving the page.
  useBackToClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // move focus into the sheet so keyboard + screen readers follow the click
    const t = setTimeout(() => panel.current?.focus(), 40);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="mise-fade-in absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={`mise-sheet-in absolute inset-x-0 bottom-0 flex max-h-[92svh] flex-col rounded-t-3xl border border-line bg-paper shadow-2xl outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:rounded-l-3xl sm:rounded-tr-none sm:border-y-0 sm:border-r-0 ${
          width === "lg" ? "sm:w-[min(720px,96vw)]" : "sm:w-[min(540px,94vw)]"
        }`}
      >
        {/* grab handle (phones) */}
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-fg/15 sm:hidden" />

        <header className="flex shrink-0 items-center gap-3 border-b border-line bg-gradient-to-r from-brand-500/10 via-transparent to-transparent px-5 py-4">
          {icon !== undefined && (
            <span aria-hidden className="mise-neo-raised grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-2xl">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-display text-xl font-semibold text-fg">{title}</h2>
              {badge}
            </div>
            {subtitle && <p className="mt-0.5 truncate text-xs text-fg-faint">{subtitle}</p>}
          </div>
          {ring}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press -mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-fg-faint transition hover:bg-paper-2 hover:text-fg"
          >
            ✕
          </button>
        </header>

        {/* Pinned outside the scroll area on purpose - see the note at the top. */}
        {stats && stats.length > 0 && (
          <div
            className="mise-stagger grid shrink-0 gap-2 border-b border-line bg-paper-2/40 px-5 py-3"
            style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}
          >
            {stats.map((s) => (
              <div key={s.label} className="mise-neo-raised rounded-xl px-3 py-2">
                <p className="truncate text-[10px] font-medium uppercase tracking-wide text-fg-faint">{s.label}</p>
                <p
                  className={`mt-0.5 truncate font-display text-lg font-semibold tabular-nums ${
                    s.tone === "good"
                      ? "text-emerald-400"
                      : s.tone === "bad"
                        ? "text-rose-400"
                        : s.tone === "warn"
                          ? "text-amber-400"
                          : "text-fg"
                  }`}
                >
                  {s.value}
                </p>
                {s.hint && <p className="truncate text-[10px] text-fg-faint">{s.hint}</p>}
              </div>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

        {actions && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-paper-2/50 px-5 py-3">
            {actions}
          </footer>
        )}
      </div>
    </div>
  );
}

/** A percentage wearing its ring - the headline metric, small enough for a header.
 *  Lifted from the recipe costing stage, which is the interaction this sheet is
 *  modelled on. `invert` flips the colour scale: for a margin, high is good; for
 *  "share of your spend with one supplier", high is a concentration risk. */
export function SheetRing({
  pct, label, invert = false,
}: { pct: number; label?: string; invert?: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const good = invert ? clamped <= 30 : clamped >= 70;
  const mid = invert ? clamped <= 60 : clamped >= 40;
  const tone = good ? "#34d399" : mid ? "#f59e0b" : "#f43f5e";
  return (
    <span className="relative grid h-11 w-11 shrink-0 place-items-center" title={label ?? `${Math.round(pct)}%`}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="3.5" />
        <circle
          cx="18" cy="18" r="15.5" fill="none"
          stroke={tone} strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * 97.4} 97.4`}
        />
      </svg>
      <span className="text-[9px] font-bold tabular-nums" style={{ color: tone }}>
        {Math.round(pct)}%
      </span>
    </span>
  );
}

/** A labelled value row — the workhorse inside a sheet. */
export function DetailRow({
  label, value, hint,
}: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 last:border-0">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="min-w-0 text-right">
        <span className="block break-words text-sm font-semibold text-fg">{value}</span>
        {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
      </span>
    </div>
  );
}

/** A titled block inside a sheet. */
export function DetailSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-400">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Big numbers at the top of a sheet. */
export function DetailStats({
  stats,
}: { stats: { label: string; value: ReactNode; tone?: "good" | "bad" | "plain" }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {stats.map((s) => (
        <div key={s.label} className="mise-well rounded-xl px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-fg-faint">{s.label}</p>
          <p
            className={`mt-0.5 text-lg font-bold tabular-nums ${
              s.tone === "good" ? "text-emerald-400" : s.tone === "bad" ? "text-rose-400" : "text-fg"
            }`}
          >
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}
