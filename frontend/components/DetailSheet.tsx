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

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";

import { useBackToClose } from "./useBackToClose";
import { overlayOpened } from "@/lib/overlay";

// ── Sheets on top of sheets ───────────────────────────────────────────────
// "Popup inside popup" is the whole point: from a vendor you open one of its
// prices, from that price you open the item. Each has to sit ABOVE the one
// that opened it, or the click lands on a sheet you can no longer see.
//
// Depth comes down through context rather than being passed by hand, so a
// sheet does not need to know whether it was opened from a page or from
// another sheet — it just works either way.
const SheetDepth = createContext(0);

/** How deep the sheet you are inside is. 0 means "not in a sheet". */
export function useSheetDepth() {
  return useContext(SheetDepth);
}

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
  sections,
  active,
  onSection,
  children,
  width = "md",
  variant = "side",
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
  /** Turns the body into SECTIONS instead of one long scroll.
   *
   *  His rule: "sections instead of scrolling". A sheet with five topics
   *  stacked vertically is the same buried-content problem as the page it
   *  replaced — the fifth one is three flicks away and nobody finds it. With
   *  a rail, every topic is one tap and starts at the top of the view. */
  sections?: { key: string; label: ReactNode; icon?: ReactNode; count?: number }[];
  active?: string;
  onSection?: (key: string) => void;
  children: ReactNode;
  width?: "md" | "lg";
  /** "side" is the drawer this has always been. "center" is the purchasing
   *  popup shape — centred on both axes, rounded all round, clear of every
   *  edge.
   *
   *  "instead of sidebar i said like popup inside popup." A drawer welded to
   *  the right edge reads as a different screen; a centred panel reads as
   *  something opened ON the page you are still looking at, which is what makes
   *  the purchasing flow feel the way he keeps asking for. */
  variant?: "side" | "center";
}) {
  const panel = useRef<HTMLDivElement>(null);
  // 1 for a sheet opened from a page, 2 for one opened from a sheet, and so on.
  const depth = useContext(SheetDepth) + 1;

  // Back closes the overlay rather than leaving the page.
  useBackToClose(open, onClose);

  // THE CARET BUG. This effect used to depend on [open, onClose], and every
  // caller passes an inline arrow for onClose — `onClose={() => setSelected("")}`
  // — which is a NEW function identity on every render. So the effect tore down
  // and re-ran on EVERY render of the parent, and each run scheduled
  // `panel.focus()` 40ms later.
  //
  // Type one character into any field inside a sheet: the parent re-renders,
  // the effect re-runs, and 40ms afterwards the caret is yanked out of the box
  // and onto the panel. Type one more, same again. He reported it twice —
  // "i can only click and type 1 number, for next number i need to click the
  // input field again" — and it was every sheet in the app, which is why it
  // showed up on vendors and purchasing alike.
  //
  // The handler goes in a ref so the listener always calls the CURRENT onClose,
  // and the effect depends only on `open` — which is what "focus the sheet when
  // it opens" actually means.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", onKey);
    // Locks the page AND tells the floating launcher to stand down — it used
    // to sit on top of this sheet's own buttons on a phone.
    const release = overlayOpened();
    // move focus into the sheet so keyboard + screen readers follow the click
    const t = setTimeout(() => panel.current?.focus(), 40);
    return () => {
      window.removeEventListener("keydown", onKey);
      release();
      clearTimeout(t);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0" // Above the app header (z-40), which had to be raised so its own
      // menus could escape it.
      style={{ zIndex: 50 + depth * 10 }} role="dialog" aria-modal="true">
      <div
        // A second full-strength backdrop over the first turns the parent
        // sheet to mud; a lighter one keeps it legible behind, which is what
        // says "you are one level deeper" rather than "you changed screens".
        className={`mise-fade-in absolute inset-0 backdrop-blur-[3px] ${
          depth > 1 ? "bg-black/35" : "bg-black/55"
        }`}
        onClick={onClose}
      />
      <div
        ref={panel}
        tabIndex={-1}
        className={
          variant === "center"
            ? // CENTRED. Still a bottom sheet on a phone, because that is where
              // thumbs are and a centred dialog on a 390px screen is just a
              // sheet with wasted corners — but from `sm` up it floats in the
              // middle with room on every side.
              `mise-sheet-in absolute inset-x-0 bottom-0 flex max-h-[92svh] flex-col rounded-t-3xl border border-line bg-paper shadow-2xl outline-none sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[88svh] sm:rounded-3xl ${
                width === "lg" ? "sm:w-[min(860px,94vw)]" : "sm:w-[min(620px,92vw)]"
              }`
            : `mise-sheet-in absolute inset-x-0 bottom-0 flex max-h-[92svh] flex-col rounded-t-3xl border border-line bg-paper shadow-2xl outline-none sm:left-auto sm:right-0 sm:max-h-none sm:border-y-0 sm:border-r-0 ${
                // Nested sheets float clear of the edges so the sheet underneath
                // stays visible at the rim — you can see what you came from.
                depth > 1
                  ? "sm:inset-y-4 sm:mr-4 sm:rounded-3xl sm:border"
                  : "sm:inset-y-0 sm:rounded-l-3xl sm:rounded-tr-none"
              } ${width === "lg" ? "sm:w-[min(720px,96vw)]" : "sm:w-[min(540px,94vw)]"}`
        }
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

        {/* The rail. Horizontally scrollable rather than wrapped, so adding a
            seventh section never steals a row of height from the content. */}
        {sections && sections.length > 0 && (
          <nav
            aria-label="Sections"
            className="mise-noscrollbar flex shrink-0 gap-1.5 overflow-x-auto border-b border-line bg-paper-2/30 px-4 py-2"
          >
            {sections.map((s) => {
              const on = s.key === active;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onSection?.(s.key)}
                  aria-current={on ? "page" : undefined}
                  className={`mise-press flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
                    on
                      ? "mise-neo-raised bg-brand-400/12 text-brand-200"
                      : "text-fg-faint hover:bg-paper-2 hover:text-fg"
                  }`}
                >
                  {s.icon && <span aria-hidden>{s.icon}</span>}
                  <span className="whitespace-nowrap">{s.label}</span>
                  {s.count !== undefined && (
                    <span
                      className={`rounded-md px-1.5 py-px text-[10px] tabular-nums ${
                        on ? "bg-brand-400/20 text-brand-100" : "bg-fg/10 text-fg-faint"
                      }`}
                    >
                      {s.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        )}

        {/* Anything opened from in here is a level deeper, not a sibling. */}
        <SheetDepth.Provider value={depth}>
          <div
            // Keyed on the section so switching starts at the top rather than
            // inheriting the last one's scroll position — landing mid-content
            // is the thing that made the old panels feel bottomless.
            key={active}
            className="mise-fade-in min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4"
          >
            {children}
          </div>
        </SheetDepth.Provider>

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

/** The things you can DO, as tap targets rather than buried buttons.
 *
 *  Sits at the top of a sheet's first section. The old pages hid their verbs
 *  at the bottom of a scroll, which is why he could not find "add a price"
 *  without being told where it was. */
export function SheetTiles({
  tiles,
}: {
  tiles: { key: string; label: string; icon: ReactNode; hint?: string; onClick: () => void; tone?: "brand" | "plain" }[];
}) {
  return (
    <div className="mise-stagger mb-4 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr))]">
      {tiles.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={t.onClick}
          className={`mise-press mise-neo-raised flex min-h-[3.25rem] items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition hover:-translate-y-px ${
            t.tone === "brand" ? "bg-brand-400/10 hover:bg-brand-400/15" : "hover:bg-paper-2"
          }`}
        >
          <span aria-hidden className="text-lg leading-none">{t.icon}</span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-fg">{t.label}</span>
            {t.hint && <span className="block truncate text-[10px] text-fg-faint">{t.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Nothing here yet — and the way to change that, in the same breath. */
export function SheetEmpty({
  icon = "◦", line, action,
}: { icon?: ReactNode; line: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 py-10 text-center">
      <span aria-hidden className="text-3xl opacity-40">{icon}</span>
      <p className="max-w-[22rem] text-xs leading-relaxed text-fg-faint">{line}</p>
      {action}
    </div>
  );
}

/** A labelled value row — the workhorse inside a sheet.
 *
 *  Give it `onClick` and it becomes a door: the value grows a chevron and
 *  acting on it happens right there. That is the rule for these screens —
 *  **click anything, do anything** — so a row that shows a number you are
 *  allowed to change should never make you go and find the form for it. */
export function DetailRow({
  label, value, hint, onClick, cta,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  onClick?: () => void;
  /** What clicking does, e.g. "change". Shown small beside the chevron. */
  cta?: string;
}) {
  const body = (
    <>
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="min-w-0 text-right">
        <span className="block break-words text-sm font-semibold text-fg">{value}</span>
        {hint && <span className="block text-[11px] text-fg-faint">{hint}</span>}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div className="flex items-baseline justify-between gap-4 border-b border-line/60 py-2.5 last:border-0">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="group mise-press -mx-2 flex w-[calc(100%+1rem)] items-baseline justify-between gap-3 rounded-lg border-b border-line/60 px-2 py-2.5 text-left transition last:border-0 hover:bg-paper-2"
    >
      {body}
      <span
        aria-hidden
        className="shrink-0 self-center text-[10px] text-fg-faint transition group-hover:text-brand-300"
      >
        {cta && <span className="mr-1 opacity-0 transition group-hover:opacity-100">{cta}</span>}›
      </span>
    </button>
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
}: {
  stats: {
    label: string;
    value: ReactNode;
    tone?: "good" | "bad" | "plain";
    /** A line under the number saying what it is FROM — a figure without its
     *  provenance is a figure nobody can check. */
    hint?: ReactNode;
  }[];
}) {
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
          {s.hint && (
            <p className="mt-0.5 truncate text-[10px] leading-tight text-fg-faint">{s.hint}</p>
          )}
        </div>
      ))}
    </div>
  );
}
