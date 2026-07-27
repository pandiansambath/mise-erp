"use client";

// Click a row → everything about it opens in place. No hunting, no scrolling to a
// panel three screens down. A side sheet on desktop (wide, room for real detail) and
// a bottom sheet on phones, which is where thumbs already are.
//
// Deliberately dumb: it owns presentation (backdrop, focus trap, escape, scroll lock)
// and nothing else, so every section can pour its own content in.

import { useEffect, useRef, type ReactNode } from "react";

export function DetailSheet({
  open,
  onClose,
  title,
  subtitle,
  badge,
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
  /** Sticky footer actions (buttons). */
  actions?: ReactNode;
  children: ReactNode;
  width?: "md" | "lg";
}) {
  const panel = useRef<HTMLDivElement>(null);

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
          width === "lg" ? "sm:w-[min(620px,94vw)]" : "sm:w-[min(500px,94vw)]"
        }`}
      >
        {/* grab handle (phones) */}
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-fg/15 sm:hidden" />

        <header className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-bold text-fg">{title}</h2>
              {badge}
            </div>
            {subtitle && <p className="mt-0.5 truncate text-sm text-fg-faint">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press -mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-fg-faint transition hover:bg-paper-2 hover:text-fg"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

        {actions && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-paper-2/50 px-5 py-3">
            {actions}
          </footer>
        )}
      </div>
    </div>
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
