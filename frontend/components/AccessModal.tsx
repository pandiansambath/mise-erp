"use client";

// 🪟 THE ACCESS POPUP — one shell, three callers, no scrolling.
//
//   "I said to have UI like a popup (like we have in purchase page popup)...
//    this is not popup, it's coming in right side bar. Please refer purchase
//    page UI."
//   "I should not feel the scroll... think deeply how we can restrict the
//    scroll. Instead of scroll we need to keep like CLICK AND SEE."
//
// Two instructions, and the second is the harder one. Seventeen switches do not
// fit on a phone-sized surface however they are arranged, so "all of it at
// once" and "no scrolling" cannot both be literally true. What CAN be true is
// that you never LEAVE — the popup holds everything, and moving between parts
// of it is a click rather than a drag.
//
// So: master and detail, side by side inside one modal. The five groups sit on
// the left with a live count of what is on; the group you tap fills the right.
// The biggest group has four switches, so the right pane never scrolls, and
// the left never does either. Nothing is hidden behind a scrollbar and nothing
// costs you your place.
//
// It lives in ONE file on purpose. The last round of this shipped into
// RoleBuilder and AccessSheet and missed JobSheet — the sheet he actually
// opened — because three files were doing the same job. Now they share this.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useConfirm } from "@/components/confirm";

import { LEVEL_HINT, SECTIONS, labelFor, type Area, type Level } from "@/lib/access";

export type Stat = { label: string; value: string; hint?: string };

/** The three-position control. One per area, named by the area where the
 *  generic word would be wrong ("Can use" for the assistant, not "Can change"). */
export function ThreeWay({
  value,
  options,
  onChange,
  area,
}: {
  value: Level;
  options: Level[];
  onChange: (l: Level) => void;
  area: Area;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={area.label}
      className="mise-well inline-flex shrink-0 rounded-xl p-0.5"
    >
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            title={LEVEL_HINT[o]}
            onClick={() => onChange(o)}
            className={`mise-press rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
              on ? "bg-brand-600 text-white" : "text-fg-faint hover:text-fg"
            }`}
          >
            {labelFor(area, o)}
          </button>
        );
      })}
    </div>
  );
}


export type Why = {
  /** Why it is unusual for THIS job, in one sentence. */
  why: string;
  /** What the normal arrangement is. */
  normal: string;
  /** What switching it on actually lets them do. */
  impact: string;
};

/**
 * 4.2 — "that 'unusual' is very generic. I need it as a button which will show
 * a clear explanation: why it's unusual, and what is the correct way to do it.
 * But still you are the owner, you can decide if you feel this is optimal. Also
 * show the impact. Show it in a separate popup instead of disturbing the
 * current UI."
 *
 * A word with no argument behind it is just a frown. This says what it means,
 * what the usual arrangement is, and what it lets the person actually DO — then
 * stops. The last line is deliberate: he bought the software and knows his
 * restaurant, so the job is to make the consequence visible, not to argue.
 */
function WhyPopup({ area, why, onClose }: { area: Area; why: Why; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="mise-fade-in absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="mise-pop-lg relative w-full max-w-md rounded-t-3xl border border-line bg-paper p-5 shadow-2xl shadow-black/60 sm:rounded-3xl">
        <div className="flex items-start gap-3">
          <span aria-hidden className="mise-well grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-lg">
            {area.icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-base font-semibold leading-tight text-fg">
              {area.label}
            </p>
            <p className="mise-chip-warn mt-1 inline-block">unusual for this job</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-faint hover:text-fg"
          >
            ✕
          </button>
        </div>

        <dl className="mt-4 space-y-3 text-[13px] leading-relaxed">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
              Why it is flagged
            </dt>
            <dd className="text-fg-soft">{why.why}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
              What is usual
            </dt>
            <dd className="text-fg-soft">{why.normal}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
              What it lets them do
            </dt>
            <dd className="text-fg-soft">{why.impact}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
              Opens these pages
            </dt>
            <dd className="text-fg-soft">{area.pages.join(" · ")}</dd>
          </div>
        </dl>

        <p className="mise-well mt-4 rounded-xl px-3 py-2.5 text-[11px] leading-relaxed text-fg-soft">
          It is still your call. You run this restaurant and we do not — if this is how your
          place works, switch it on and nothing here will stop you.
        </p>

        <button
          type="button"
          onClick={onClose}
          className="mise-press mt-3 w-full rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white"
        >
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function AccessModal({
  open,
  icon,
  title,
  subtitle,
  stats,
  intro,
  banner,
  lead,
  current,
  onSet,
  onBulk,
  areaExtra,
  explain,
  actions,
  onClose,
}: {
  open: boolean;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  stats: Stat[];
  intro?: ReactNode;
  /** A warning above the switches, e.g. "unusual for a Manager". */
  banner?: ReactNode;
  /** Anything that must sit above the groups — the name field, the chooser. */
  lead?: ReactNode;
  current: (a: Area) => Level;
  onSet: (a: Area, l: Level) => void;
  /** level, or a group key to limit it to. */
  onBulk: (l: Level, group?: string) => void;
  /** Per-area trimmings the caller owns: "not saved yet", etc. */
  areaExtra?: (a: Area) => ReactNode;
  /** Return a reason to flag this area as unusual, or null. */
  explain?: (a: Area) => Why | null;
  actions: ReactNode;
  onClose: () => void;
}) {
  const [group, setGroup] = useState(SECTIONS[0].key);
  const [asked, setAsked] = useState<Area | null>(null);
  const confirm = useConfirm();

  /**
   * 3 — "let's say someone changing the role read to write, or giving full
   * access, or using the consolidated button — we need to ask for confirmation,
   * else it will create confusion."
   *
   * The bulk buttons are where that bites hardest: one tap moves every switch
   * on the page, and there is no way to tell by looking what it was before.
   * A single switch is one visible thing and undoes itself by being tapped
   * again; seventeen at once does not.
   */
  async function bulkWithConfirm(l: Level, groupKey?: string) {
    const scope = groupKey
      ? (SECTIONS.find((x) => x.key === groupKey)?.label ?? "this group")
      : "every page in DineAI";
    const what =
      l === "edit"
        ? `give FULL access to ${scope}`
        : l === "view"
          ? `let them SEE all of ${scope}, without changing anything`
          : `take away ALL access to ${scope}`;
    const ok = await confirm({
      title: "Change it all at once?",
      message: `This will ${what}. Nothing is saved until you press save, but it moves every switch here in one go.`,
      confirmText: l === "none" ? "Take it away" : "Yes, do it",
      tone: l === "none" ? "danger" : "default",
    });
    if (ok) onBulk(l, groupKey);
  }
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (open) setGroup(SECTIONS[0].key);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const sec = SECTIONS.find((s) => s.key === group) ?? SECTIONS[0];

  // Portalled to <body>: any ancestor with a transform or filter makes a new
  // stacking context, and a modal trapped in one cannot rise above the page.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="mise-fade-in absolute inset-0 bg-black/60 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <div className="mise-pop-lg relative flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-paper shadow-2xl shadow-black/60 sm:max-w-5xl sm:rounded-3xl">
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-fg/15 sm:hidden" />

        <header className="flex shrink-0 items-center gap-3 border-b border-line bg-gradient-to-r from-brand-500/10 via-transparent to-transparent px-5 py-3.5">
          <span
            aria-hidden
            className="mise-neo-raised grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl"
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-semibold leading-tight text-fg">
              {title || "…"}
            </p>
            {subtitle && <p className="truncate text-[11px] text-fg-faint">{subtitle}</p>}
          </div>
          <div className="hidden shrink-0 items-center gap-4 sm:flex">
            {stats.map((s) => (
              <div key={s.label} className="text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-fg-faint">
                  {s.label}
                </p>
                <p className="font-display text-base font-semibold leading-tight text-fg">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-xl text-fg-faint transition hover:bg-paper-2 hover:text-fg"
          >
            ✕
          </button>
        </header>

        {/* The only part that may ever scroll is what the CALLER puts here —
            a name field, the who-is-this chooser. The switches below never do. */}
        {(lead || intro || banner) && (
          <div className="max-h-[34dvh] shrink-0 overflow-y-auto border-b border-line px-5 py-3">
            {lead}
            {intro && (
              <p className="rounded-xl border border-line bg-paper-2/50 px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-soft">
                {intro}
              </p>
            )}
            {banner}
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-5 py-2.5">
          <span className="text-[11px] text-fg-faint">Every page in DineAI:</span>
          {(["edit", "view", "none"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => bulkWithConfirm(l)}
              className="mise-press mise-well rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-fg-soft hover:text-fg"
            >
              {l === "edit" ? "Give everything" : l === "view" ? "See everything" : "Take it all away"}
            </button>
          ))}
        </div>

        {/* MASTER AND DETAIL. Click a group, see its switches — no scrolling
            in either pane, because the biggest group holds four. */}
        {/* 4.4 — "left bottom corner of the popup, that Their own button is
            hidden under some white overlay which restricted me clicking it."
            It was not an overlay: this row had no overflow of its own, so when
            the content was taller than the space the flex box gave it, it spilled
            straight through the footer instead of being contained. The footer is
            opaque, so it read as something laid on top. Each pane is bounded now,
            and the rail can never be covered. */}
        <div className="grid min-h-0 flex-1 overflow-hidden sm:grid-cols-[13.5rem_1fr]">
          <nav className="flex min-h-0 gap-1 overflow-x-auto border-b border-line p-2 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r">
            {SECTIONS.map((s) => {
              const on = s.key === group;
              const live = s.areas.filter((a) => current(a) !== "none").length;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setGroup(s.key)}
                  className={`mise-press flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left transition sm:shrink ${
                    on ? "bg-brand-600 text-white" : "text-fg-soft hover:bg-paper-2"
                  }`}
                >
                  <span aria-hidden className="text-base">
                    {s.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{s.label}</span>
                    <span
                      className={`block text-[10px] ${on ? "text-white/70" : "text-fg-faint"}`}
                    >
                      {live} of {s.areas.length} on
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 overflow-y-auto p-3">
            <div className="mb-2 flex items-center gap-2 px-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                {sec.label}
              </p>
              <button
                type="button"
                onClick={() => bulkWithConfirm("edit", sec.key)}
                className="mise-press ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-medium text-brand-300 hover:underline"
              >
                give all
              </button>
              <button
                type="button"
                onClick={() => bulkWithConfirm("none", sec.key)}
                className="mise-press rounded-md px-1.5 py-0.5 text-[10px] font-medium text-fg-faint hover:underline"
              >
                none
              </button>
            </div>
            <ul className="grid gap-1.5 lg:grid-cols-2">
              {sec.areas.map((a) => {
                const opts: Level[] =
                  a.read.length && a.write.length
                    ? ["none", "view", "edit"]
                    : ["none", a.write.length ? "edit" : "view"];
                return (
                  <li key={a.key} className="mise-well rounded-xl px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span aria-hidden className="shrink-0 text-base">
                        {a.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-medium leading-tight text-fg">
                            {a.label}
                          </span>
                          {explain?.(a) && (
                            <button
                              type="button"
                              onClick={() => setAsked(a)}
                              className="mise-press mise-chip-warn shrink-0"
                              title="Why is this unusual?"
                            >
                              unusual — why?
                            </button>
                          )}
                          {areaExtra?.(a)}
                        </span>
                        <span className="block truncate text-[10px] leading-tight text-fg-faint">
                          {a.pages.join(" · ")}
                        </span>
                      </span>
                    </span>
                    <span className="mt-2 flex justify-end">
                      <ThreeWay
                        area={a}
                        value={current(a)}
                        options={opts}
                        onChange={(l) => onSet(a, l)}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-paper-2/40 px-5 py-3">
          {actions}
        </footer>
      </div>
      {asked && explain?.(asked) && (
        <WhyPopup area={asked} why={explain(asked)!} onClose={() => setAsked(null)} />
      )}
    </div>,
    document.body,
  );
}
