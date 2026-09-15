"use client";

/** Where a number came from, and how old it is.
 *
 *  Two very different kinds of figure sit on the money page:
 *
 *    LIVE      what WE record — requests, DB reads and writes, AI calls with
 *              their real cost. Current to the second.
 *    BILLED    what AWS says. Hours behind, and $0.01 a call to refresh.
 *    ESTIMATE  a model — a share of a shared box that AWS has never heard of.
 *
 *  He asked for "live". Half of it cannot be. The honest version is not a
 *  disclaimer at the top of the page — he would stop reading that by the third
 *  morning — it is a mark ON EACH NUMBER, so the difference is visible every
 *  time without ever being explained again.
 *
 *  THREE RULES THIS EXISTS TO ENFORCE
 *
 *  1. Freshness belongs to the NUMBER, not to the page. A page-level banner
 *     saying "some of this is delayed" tells you nothing about which.
 *  2. Every figure carries one. A figure without one is a bug, which is why
 *     the money cells take `source` as a required prop.
 *  3. Badly-aged billed data ESCALATES. Past 26 hours — a missed scheduled
 *     read — it stops being a neutral note and turns amber.
 *
 *  No exotic glyphs. Each chip is distinguishable by its TEXT in greyscale;
 *  font coverage for symbols like ◷ fails silently on some platforms, and a
 *  freshness mark that renders as a box is worse than none.
 */

import { useState } from "react";

export type SourceKind = "live" | "billed" | "estimate" | "entered_by_hand";

/** "11h ago", "2 days old". Never a raw timestamp — this is read at a glance. */
function age(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const m = Math.max(0, Math.round(seconds / 60));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)} days old`;
}

const COPY: Record<SourceKind, string> = {
  live: "Recorded by DineAI as it happens — current to the second.",
  billed:
    "From AWS Cost Explorer, read on a schedule. AWS publishes yesterday's usage in the morning and today's is incomplete by design. Refreshing costs $0.01 a call, so it is not polled.",
  estimate:
    "A model, not a measurement. AWS has never heard of a restaurant — this is a share of one shared box, split by measured usage. The formula and its inputs are one click away.",
  entered_by_hand:
    "Typed in by a person from the AWS console. AWS publishes no API for this, so it is only as current as the last time somebody looked.",
};

export function Source({
  kind,
  staleSeconds,
  note,
  className = "",
}: {
  kind: SourceKind;
  staleSeconds?: number | null;
  note?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // Past a missed scheduled read, "billed" stops being neutral.
  const overdue = kind === "billed" && (staleSeconds ?? 0) > 26 * 3600;

  const label =
    kind === "live"
      ? "live"
      : kind === "billed"
        ? `AWS · ${age(staleSeconds) || "cached"}`
        : kind === "estimate"
          ? "estimate"
          : "entered by hand";

  const tone =
    kind === "live" ? "green" : overdue ? "amber" : kind === "billed" ? "sky" : "slate";

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mise-chip mise-press"
        data-tone={tone}
        title="Where this number comes from"
      >
        {kind === "live" && (
          <span aria-hidden className="mise-bg-good mr-1 h-1.5 w-1.5 animate-pulse rounded-full" />
        )}
        {label}
      </button>
      {open && (
        <span
          role="note"
          className="mise-glass-panel absolute left-0 top-full z-30 mt-1 w-64 rounded-xl p-3 text-[11px] leading-relaxed text-fg-soft"
        >
          {COPY[kind]}
          {note && <span className="mt-1 block text-fg-faint">{note}</span>}
        </span>
      )}
    </span>
  );
}
