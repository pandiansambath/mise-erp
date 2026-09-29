"use client";

// /control-room/graph — the whole platform as one picture.
//
//     "litrelly like a human brain sumilation neural netork UI view we need...
//      under proejct how mamy hotels are ther..unders hotel what are all ther..
//      what using..what aws bill they consufe..what ai they using..hw muhc
//      time..how many token"
//     "i dont like the UI UX of map feature in controlroom.... IM expecting
//      something super cool GUI....but current one is not reaching my
//      expectations (its clumsy tight and not ordered arranged etc)"
//
// WHAT AN OPERATOR ANSWERS HERE AT A GLANCE: which restaurants are alive and
// how hard each one is using the platform, who signed up and never started,
// and what the platform cost this period — the same figure the bill page
// shows. One click to see what a restaurant uses; one more to reach the page.
//
// ⚠️ THE STAGE IS THE PAGE. The previous version said "every pixel of the
// window is map" in a comment while putting the map in a FIXED 68vh card,
// under a view switch and above a legend strip, with a 180px white band below
// it holding only a footnote. Now: one top bar, the stage, the bill strip.
// Nothing else — the view switch, the shape legend (which described hexagons
// and diamonds from the OTHER view), the instruction pill and the footnote are
// gone. The footnote survives as an ⓘ on the period control.
//
// ⚠️ DARK ON PURPOSE, and pinned here. A theme's palette lives on `:root`, so a
// `data-mode` on a div alone does nothing — the variables themselves are
// pinned on this element with `themeVars`, the way the kiosk and print
// screens do it. Tokens only; no literal page colours.

import { useState } from "react";

import { errorCopy, useOperatorQuery } from "@/components/controlroom/useOperatorQuery";
import { Segmented, Spinner } from "@/components/ui";
import { themeVars } from "@/lib/theme";

import { BillStrip } from "./BillStrip";
import type { GraphEdge, GraphNode } from "./geometry";
import { OrbitMap } from "./OrbitMap";

type Payload = {
  period: { from: string; to: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    measured_from: string | null;
    totals: {
      requests: number;
      aws_usd: number;
      /** Credits and the window travel with the figure, so the strip cannot
       *  contradict /control-room/money about what the platform cost. */
      aws_credits_usd?: number | null;
      aws_net_usd?: number | null;
      aws_available?: boolean;
      period_start?: string;
      period_end?: string;
      ai_calls: number;
      ai_tokens: number;
    };
    generated_at: string;
  };
};

const WINDOWS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

export default function GraphPage() {
  const [days, setDays] = useState("30");
  const q = useOperatorQuery<Payload>(`/platform/graph?days=${days}`);
  const d = q.data;
  const totals = d?.meta.totals;

  return (
    <div
      className="relative flex min-h-[calc(100dvh-57px)] flex-1 flex-col bg-shell text-fg"
      data-mode="dark"
      style={themeVars("dark")}
    >
      {q.loading && !d && (
        <div className="grid flex-1 place-items-center">
          <Spinner />
        </div>
      )}

      {q.error && (
        <div className="m-4 rounded-xl border border-line bg-paper p-4">
          <p className="text-sm text-rose-400">{errorCopy(q.error)}</p>
          <button type="button" onClick={q.reload} className="mise-press mt-2 rounded-lg border border-line px-3 py-1.5 text-xs">
            Retry
          </button>
        </div>
      )}

      {d && (
        <>
          <OrbitMap
            nodes={d.nodes}
            right={
              <>
                {totals && (
                  // THE HEADLINE, as figures in the display face — not the
                  // five-clause run-on sentence it used to be.
                  <p className="hidden items-baseline gap-3 text-xs text-fg-faint lg:flex">
                    <span>
                      <b className="font-display text-sm text-fg">{totals.requests.toLocaleString("en-GB")}</b> requests
                    </span>
                    <span>
                      <b className="font-display text-sm text-fg">{totals.ai_calls.toLocaleString("en-GB")}</b> AI calls
                    </span>
                    <span>
                      <b className="font-display text-sm text-fg">{totals.ai_tokens.toLocaleString("en-GB")}</b> tokens
                    </span>
                  </p>
                )}
                <span className="rounded-lg bg-paper/80">
                  <Segmented value={days} onChange={setDays} options={WINDOWS} />
                </span>
                {d.meta.measured_from && (
                  <span
                    className="grid h-8 w-8 cursor-help place-items-center rounded-lg border border-line text-xs text-fg-faint"
                    title={`Our counters start ${d.meta.measured_from}. Anything before that is not zero — it is unmeasured, and the map says so rather than drawing a nought.`}
                    aria-label={`Counters start ${d.meta.measured_from}`}
                  >
                    ⓘ
                  </span>
                )}
              </>
            }
          />
          {totals && (
            <BillStrip
              lines={d.nodes
                .filter((n) => n.kind === "service")
                .map((n) => ({
                  service: n.id,
                  label: n.label,
                  usd: Number(n.metrics?.usd ?? 0),
                  pool: String(n.detail?.pool ?? "shared"),
                }))}
              totalUsd={totals.aws_usd ?? 0}
              creditsUsd={totals.aws_credits_usd ?? 0}
              period={
                totals.period_start && totals.period_end
                  ? `${totals.period_start} → ${totals.period_end}`
                  : undefined
              }
            />
          )}
        </>
      )}
    </div>
  );
}
