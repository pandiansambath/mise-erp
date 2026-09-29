"use client";

// The AWS bill, as a labelled strip along the bottom of the map.
//
// It used to be a 12px sky-blue ring round the bubbles with two orange arcs
// and no words: a first-time viewer could not tell it was a bill at all, the
// figures lived in a hover-only tooltip a phone cannot reach, and when you
// zoomed, the bubbles grew straight through it. A strip reads left to right,
// names every line in the money page's own words, and never moves.

import Link from "next/link";
import { serviceLabel } from "./areas";

export type BillLine = { service: string; label: string; usd: number; pool: string };

/** The money page's three pools, so the colours mean the same thing on both. */
const POOL: Record<string, { fill: string; name: string }> = {
  shared: { fill: "var(--color-brand-500)", name: "shared by everyone" },
  platform: { fill: "#38bdf8", name: "the platform itself" },
  direct: { fill: "#a78bfa", name: "used per restaurant" },
};

export function BillStrip({
  lines,
  totalUsd,
  creditsUsd,
  period,
}: {
  lines: BillLine[];
  totalUsd: number;
  creditsUsd: number;
  period?: string;
}) {
  const sorted = [...lines].filter((l) => l.usd > 0).sort((a, b) => b.usd - a.usd);
  const sum = sorted.reduce((t, l) => t + l.usd, 0) || 1;
  // Anything under 7% of the bill is too thin to label; it folds into one
  // "+N more" segment rather than becoming a sliver nobody can read.
  const big = sorted.filter((l) => l.usd / sum >= 0.07);
  const small = sorted.filter((l) => l.usd / sum < 0.07);
  const smallUsd = small.reduce((t, l) => t + l.usd, 0);
  const covered = creditsUsd < 0;

  return (
    <div className="relative z-10 shrink-0 border-t border-line/60 bg-paper/70 px-3 py-2 backdrop-blur-md">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-faint">
          What the platform cost{period ? ` · ${period}` : ""}
        </p>
        <p className="text-sm text-fg">
          <b className="font-display text-base">${totalUsd.toFixed(2)}</b> of AWS
          {covered && (
            <span
              className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              // Literal colours, deliberately. The utility classes rendered
              // dark green on the dark strip; this chip is the good news on
              // the page and has to be the most legible thing on it.
              style={{ background: "rgba(16,185,129,0.22)", color: "#d1fae5", boxShadow: "inset 0 0 0 1px rgba(110,231,183,0.45)" }}
            >
              credits covered it — nothing charged
            </span>
          )}
        </p>
      </div>

      <Link
        href="/control-room/money"
        title="Open the bill, line by line"
        className="mise-press mt-1.5 flex h-9 w-full overflow-hidden rounded-lg ring-1 ring-line/60"
      >
        {big.map((l) => (
          <span
            key={l.service}
            className="flex min-w-0 items-center justify-center gap-1 border-r border-shell/60 px-1.5 text-[11px] font-medium text-white"
            style={{ width: `${(l.usd / sum) * 100}%`, background: POOL[l.pool]?.fill ?? POOL.shared.fill }}
            title={`${serviceLabel(l.label)} — $${l.usd.toFixed(2)} (${POOL[l.pool]?.name ?? "shared"})`}
          >
            <span className="truncate">{serviceLabel(l.label)}</span>
            <span className="shrink-0 font-mono opacity-85">${l.usd.toFixed(2)}</span>
          </span>
        ))}
        {small.length > 0 && (
          <span
            className="flex min-w-0 items-center justify-center gap-1 bg-slate-500/70 px-1.5 text-[11px] font-medium text-white"
            style={{ width: `${(smallUsd / sum) * 100}%` }}
            title={small.map((l) => `${serviceLabel(l.label)} $${l.usd.toFixed(2)}`).join(" · ")}
          >
            <span className="truncate">+{small.length} more</span>
          </span>
        )}
      </Link>

      <div className="mt-1 hidden flex-wrap gap-x-4 text-[10.5px] text-fg-faint sm:flex">
        {Object.entries(POOL).map(([k, p]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: p.fill }} />
            {p.name}
          </span>
        ))}
        <span className="ml-auto">tap the strip for the bill, line by line ↗</span>
      </div>
    </div>
  );
}
