"use client";

// Time in the chain, drawn as a chain: one block per month since he started.
//
// Each finished month is a mined block; the months he was recognised are lit
// in their own colour (★ recognition, ↑ promotion), and the current block is
// still filling — live, by the day. The blocks light one after another when
// the page opens, the same chain reaction as the spine beside the cards.
//
// Rendered only in the browser (it reads the clock), and the milestones come
// from the same list as the Recognition card, so the two cannot disagree.

import { RECOGNITION, type Milestone } from "@/dev/profile";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MARKS: Record<string, Milestone> = Object.fromEntries(RECOGNITION.map((m) => [m.when, m]));
const DAY = 86_400_000;

function addYears(d: Date, n: number) {
  return new Date(Date.UTC(d.getUTCFullYear() + n, d.getUTCMonth(), d.getUTCDate()));
}

export function MonthChain({ start, now, play }: { start: Date; now: Date; play: boolean }) {
  const sy = start.getUTCFullYear();
  const sm = start.getUTCMonth();
  const current = (now.getUTCFullYear() - sy) * 12 + now.getUTCMonth() - sm;
  const years: number[] = [];
  for (let y = sy; y <= now.getUTCFullYear(); y++) years.push(y);

  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const filled = (now.getUTCDate() - 1 + now.getUTCHours() / 24) / daysInMonth;

  // The next whole year, counted down.
  let done = 0;
  while (addYears(start, done + 1) <= now) done += 1;
  const nextAt = addYears(start, done + 1);
  const daysLeft = Math.max(0, Math.ceil((nextAt.getTime() - now.getTime()) / DAY));

  return (
    <div className="mt-4">
      <div className="space-y-1.5">
        {years.map((y) => (
          <div key={y} className="flex items-center gap-2">
            <span className="w-8 shrink-0 font-mono text-[9px] tabular-nums tracking-[0.1em] text-[#4a5c70]">{y}</span>
            <div className="relative grid flex-1 grid-cols-12 gap-[3px] sm:gap-1">
              {/* The thread the blocks hang on. */}
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/[0.06]" />
              {MONTHS.map((name, mi) => {
                const idx = (y - sy) * 12 + mi - sm;
                const mark = MARKS[`${name} ${y}`];
                const state = idx < 0 || idx > current ? "future" : idx === current ? "now" : "past";
                const label =
                  `${name} ${y}` +
                  (mark ? ` · ${mark.title}${mark.promoted ? ` (promoted ${mark.promoted})` : ""}` : "") +
                  (state === "now" ? " · this month" : "");
                const gold = mark && !mark.promoted;
                return (
                  <span
                    key={name}
                    title={label}
                    aria-label={state === "future" ? undefined : label}
                    className={`relative grid aspect-square place-items-center overflow-hidden rounded-[3px] border text-[8px] leading-none sm:rounded ${
                      state === "future"
                        ? "border-white/[0.05]"
                        : gold
                          ? "border-[#f0bd6a]/70 text-[#3a2410] shadow-[0_0_10px_rgba(240,189,106,.45)]"
                          : mark
                            ? "border-[#7df0dc]/80 text-[#06231f] shadow-[0_0_10px_rgba(45,212,191,.5)]"
                            : state === "now"
                              ? "border-[#2dd4bf]/60"
                              : "border-[#2dd4bf]/25"
                    }`}
                    style={{
                      background:
                        state === "future"
                          ? "transparent"
                          : gold
                            ? "linear-gradient(135deg, #ffe2a3, #d08a3a)"
                            : mark
                              ? "linear-gradient(135deg, #a7fff0, #2dd4bf)"
                              : state === "past"
                                ? "linear-gradient(135deg, rgba(45,212,191,.42), rgba(45,212,191,.14))"
                                : "transparent",
                      ...(play
                        ? { animation: `devBlockOn .45s ${Math.max(0, idx) * 32 + 250}ms cubic-bezier(.2,.9,.3,1.2) both` }
                        : { opacity: 0 }),
                    }}
                  >
                    {state === "now" && (
                      // The block being mined: filling by the day, breathing.
                      <span
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#2dd4bf]/70 to-[#2dd4bf]/25"
                        style={{ height: `${Math.round(filled * 100)}%`, animation: "devFill 2.4s ease-in-out infinite" }}
                      />
                    )}
                    {mark && <span className="relative font-bold">{mark.promoted ? "↑" : "★"}</span>}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 font-mono text-[9px] tracking-[0.14em] text-[#4a5c70]">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-[2px] border border-[#2dd4bf]/30 bg-[#2dd4bf]/30" /> MONTH
          </span>
          <span className="inline-flex items-center gap-1 text-[#c9a25f]">★ RECOGNITION</span>
          <span className="inline-flex items-center gap-1 text-[#5fd6c4]">↑ PROMOTION</span>
        </span>
        <span className="text-[#7d93ad]">
          {current + 1} BLOCKS · NEXT: {done + 1} YEARS IN {daysLeft} {daysLeft === 1 ? "DAY" : "DAYS"}
        </span>
      </div>
    </div>
  );
}
