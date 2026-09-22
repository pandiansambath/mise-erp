"use client";

/** The five sections, as one instrument.
 *
 *     "litrelly it need to collect all the needed datas section by seciotn"
 *
 *  NOT A PROGRESS BAR, AND NOT A CONNECTED TRACK. A track exists to be partly
 *  full, and a track 40% full is a shaming device for a restaurant that did
 *  suppliers and stock in March and came back in June. Three lit keys and two
 *  unlit keys reads as *three things done*; a bar 60% full reads as *40%
 *  failed*. Same data, opposite feeling.
 *
 *  So state lives in each segment on its own — a 2px rule across the top of
 *  that segment, a mark, and a count. There is no percentage anywhere in this
 *  section, no ring, no fill.
 *
 *  ONE TRAY, HAIRLINE DIVIDERS, NOT FIVE CARDS. The design pass measured why
 *  the old page felt "splitted": six sibling objects, none containing another.
 *  `divide-x` makes this one object with five parts.
 */

import { useState } from "react";

import { SheetPopup } from "@/components/SheetPopup";

export type StepState = "current" | "done" | "todo" | "draft" | "skipped" | "blocked";

export type Step = {
  key: string;
  title: string;
  /** The count line, with its noun — "6 suppliers", never a bare "6". */
  hint: string;
  state: StepState;
};

/** Background per state. Deliberately almost nothing: on this product the
 *  shell-to-paper contrast is 1.078–1.132 across every theme and exactly
 *  1.000 on chalk, so a fill difference is not available. Structure comes
 *  from the rule, the mark and the weight. */
const SEG: Record<StepState, string> = {
  current: "bg-glass/[0.05]",
  done: "hover:bg-glass/[0.03]",
  todo: "hover:bg-glass/[0.03]",
  draft: "hover:bg-glass/[0.03]",
  skipped: "opacity-70 hover:bg-glass/[0.03] hover:opacity-100",
  blocked: "hover:bg-glass/[0.03]",
};

const RULE: Record<StepState, string> = {
  current: "bg-brand-500",
  done: "mise-bg-good",
  draft: "mise-bg-warn",
  todo: "bg-transparent",
  skipped: "bg-transparent",
  blocked: "bg-transparent",
};

/** Always 22px, whatever it shows, so nothing reflows when a step completes. */
function StepMark({ state, n }: { state: StepState; n: number }) {
  const box = "grid h-[1.375rem] w-[1.375rem] shrink-0 place-items-center rounded-full";

  if (state === "done") {
    return (
      <span
        className={`${box} border`}
        style={{
          background: "color-mix(in srgb, var(--tone-good) 18%, transparent)",
          borderColor: "color-mix(in srgb, var(--tone-good) 45%, transparent)",
        }}
      >
        <svg viewBox="0 0 12 12" className="mise-tone-good h-3 w-3" aria-hidden>
          <path
            d="M2.5 6.2 4.8 8.5 9.5 3.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  if (state === "current") {
    return (
      <span
        className={`${box} bg-brand-600 text-[0.6875rem] font-bold text-white ring-2 ring-brand-500/25`}
      >
        {n}
      </span>
    );
  }
  if (state === "draft") {
    return (
      <span className={`${box} border border-line`}>
        <i className="mise-bg-warn block h-[7px] w-[7px] rounded-full" />
      </span>
    );
  }
  if (state === "skipped") {
    return (
      <span className={`${box} border border-dashed border-line text-[0.6875rem] text-fg-faint`}>
        –
      </span>
    );
  }
  // todo AND blocked. A blocked step is NEVER greyed out and never a padlock —
  // it is clickable and explains itself when you get there. A disabled
  // control on arrival is a dead end you cannot ask a question about.
  return (
    <span className={`${box} border border-line text-[0.6875rem] font-semibold text-fg-faint`}>
      {n}
    </span>
  );
}

export function StepBar({
  steps,
  onGo,
}: {
  steps: Step[];
  onGo: (key: string) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const currentIndex = Math.max(0, steps.findIndex((s) => s.state === "current"));
  const current = steps[currentIndex];

  return (
    <>
      {/* ── ≥640px: five keys on one tray ───────────────────────────── */}
      <nav
        aria-label="Setup steps"
        className="mise-card-inset hidden grid-cols-5 divide-x divide-line overflow-hidden rounded-2xl sm:grid"
      >
        {steps.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onGo(s.key)}
            aria-current={s.state === "current" ? "step" : undefined}
            className={`mise-press relative flex min-h-[4.5rem] flex-col justify-center gap-1 px-4 py-3 text-left transition-colors ${SEG[s.state]}`}
          >
            <span aria-hidden className={`absolute inset-x-0 top-0 h-[2px] ${RULE[s.state]}`} />
            <span className="flex items-center gap-2">
              <StepMark state={s.state} n={i + 1} />
              <span
                className={`truncate text-[0.875rem] ${
                  s.state === "current" ? "font-semibold text-fg" : "font-medium text-fg-soft"
                }`}
              >
                {s.title}
              </span>
            </span>
            <span className="truncate pl-[1.875rem] text-[0.75rem] tabular-nums text-fg-faint">
              {s.hint}
            </span>
          </button>
        ))}
      </nav>

      {/* ── 390px: one row, five pips, click not scroll ─────────────── */}
      <button
        type="button"
        onClick={() => setSheet(true)}
        className="mise-card-inset mise-press flex min-h-[3.5rem] w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left sm:hidden"
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-fg-faint">
            Step {currentIndex + 1} of {steps.length}
          </span>
          <span className="truncate text-[0.9375rem] font-semibold text-fg">
            {current?.title ?? "Setting up"}
          </span>
        </span>
        <span aria-hidden className="flex shrink-0 items-center gap-1.5">
          {steps.map((s) => (
            <i
              key={s.key}
              className={
                s.state === "current"
                  ? "block h-2 w-[1.125rem] rounded-full bg-brand-500"
                  : s.state === "done"
                    ? "mise-bg-good block h-2 w-2 rounded-full"
                    : s.state === "draft"
                      ? "mise-bg-warn block h-2 w-2 rounded-full"
                      : s.state === "skipped"
                        ? "block h-2 w-2 rounded-full border border-line"
                        : "block h-2 w-2 rounded-full bg-glass/25"
              }
            />
          ))}
        </span>
      </button>

      {/* The current pip is a STADIUM, not a bigger dot — width is the cue, so
          the row's rhythm does not jump as he moves between steps. */}
      {sheet && (
        <SheetPopup onClose={() => setSheet(false)} title="Setting up">
          <ul className="space-y-1.5">
            {steps.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => {
                    onGo(s.key);
                    setSheet(false);
                  }}
                  className={`mise-press flex min-h-[3.5rem] w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${
                    s.state === "current" ? "bg-glass/[0.05]" : ""
                  }`}
                >
                  <StepMark state={s.state} n={i + 1} />
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={`truncate text-[0.9375rem] ${
                        s.state === "current"
                          ? "font-semibold text-fg"
                          : "font-medium text-fg-soft"
                      }`}
                    >
                      {s.title}
                    </span>
                    <span className="truncate text-[0.75rem] tabular-nums text-fg-faint">
                      {s.hint}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </SheetPopup>
      )}
    </>
  );
}
