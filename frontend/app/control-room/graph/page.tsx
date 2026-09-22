"use client";

// /control-room/graph — the whole platform as one picture.
//
//     "litrelly like a human brain sumilation neural netork UI view we need...
//      under proejct how mamy hotels are ther..unders hotel what are all ther..
//      what using..what aws bill they consufe..what ai they using..hw muhc
//      time..how many token"
//
// Demand on the left, supply on the right, the platform between them. Every
// restaurant that exists — including the ones that have done nothing, because
// an absent row and a zero row are different answers — plus the traffic that
// belongs to nobody, the AWS services it all runs on, and the AI models
// several restaurants point at.
//
// THE THREE THINGS ON THIS PAGE THAT NO OTHER SCREEN SHOWS:
//   1. that 72% of all traffic has no tenant behind it;
//   2. that one restaurant's AI calls take six times longer than another's —
//      which you SEE, because a pulse travels at the speed of its real call;
//   3. that there is spend attached to a restaurant that no longer exists.

import { useEffect, useMemo, useState } from "react";

import { errorCopy, useOperatorQuery } from "@/components/controlroom/useOperatorQuery";
import Link from "next/link";

import { Card, Segmented, Spinner } from "@/components/ui";
import { SheetPopup } from "@/components/SheetPopup";

import { NeuralMap } from "./NeuralMap";
import type { GraphEdge, GraphNode } from "./geometry";

type Payload = {
  period: { from: string; to: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  meta: {
    measured_from: string | null;
    totals: {
      requests: number;
      aws_usd: number;
      /** Credits and the window travel with the figure, so this strip cannot
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
  const [picked, setPicked] = useState<GraphNode | null>(null);
  const q = useOperatorQuery<Payload>(`/platform/graph?days=${days}`);
  const d = q.data;

  // Keep the open sheet in step with a refetch rather than showing figures
  // from the previous window under the new one's heading.
  useEffect(() => {
    if (!picked || !d) return;
    const fresh = d.nodes.find((n) => n.id === picked.id);
    if (fresh && fresh !== picked) setPicked(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);

  const totals = d?.meta.totals;

  const edgesForPicked = useMemo(
    () =>
      !picked || !d
        ? []
        : d.edges.filter((e) => e.source === picked.id || e.target === picked.id),
    [picked, d],
  );

  return (
    /* FULL BLEED. The rail is gone on this route (see control-room/layout.tsx)
       and the chrome floats OVER the canvas rather than stacking above it, so
       every pixel of the window is map. A page header and a control row would
       have taken ~150px off the top of the one page whose value is area. */
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* THE WAY BACK. The rail is hidden here, so the map owes him a door —
          and a labelled one: five of the eleven Control Room destinations
          ("AWS bill", "AI spend", "Trail", "Plans", "Broadcast") have no
          guessable icon, and the house law is less confusion, not fewer
          pixels. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-center gap-2 p-3">
        <Link
          href="/control-room"
          className="mise-press pointer-events-auto rounded-xl bg-paper/90 px-3 py-1.5 text-xs font-semibold text-fg-soft shadow-sm backdrop-blur"
        >
          ‹ Control Room
        </Link>
        <span className="pointer-events-auto rounded-xl bg-paper/90 px-3 py-1.5 shadow-sm backdrop-blur">
          <Segmented value={days} onChange={setDays} options={WINDOWS} />
        </span>
        {totals && (
          <p className="pointer-events-auto rounded-xl bg-paper/90 px-3 py-2 text-xs text-fg-faint shadow-sm backdrop-blur">
            {totals.requests.toLocaleString()} requests ·{" "}
            {totals.ai_calls.toLocaleString()} AI calls ·{" "}
            {totals.ai_tokens.toLocaleString()} tokens ·{" "}
            {/* THE SAME SENTENCE THE MONEY PAGE TELLS. It said "$37.09 of
                AWS" while /control-room/money said "$24.53 — credits covered
                it, you have not been charged". Both were true of different
                questions, which is worse than one of them being wrong. */}
            {totals.aws_available === false ? (
              <span>AWS figures not fetched for this period</span>
            ) : (totals.aws_credits_usd ?? 0) < 0 ? (
              <span>
                ${totals.aws_usd.toFixed(2)} of AWS — credits covered $
                {Math.abs(totals.aws_credits_usd ?? 0).toFixed(2)}
              </span>
            ) : (
              <span>${totals.aws_usd.toFixed(2)} of AWS</span>
            )}
            {totals.period_start && (
              // The window, named. One unlabelled control was driving two
              // different clocks.
              <span className="opacity-70">
                {" "}
                · {totals.period_start} → {totals.period_end}
              </span>
            )}
          </p>
        )}
      </div>

      {q.loading && !d && (
        <Card className="flex min-h-[26rem] flex-1 items-center justify-center p-4">
          <Spinner />
        </Card>
      )}

      {q.error && (
        <Card className="p-4">
          <p className="text-sm text-danger">{errorCopy(q.error)}</p>
          <button
            type="button"
            onClick={q.reload}
            className="mise-press mise-well mt-2 rounded-xl px-3 py-1.5 text-xs"
          >
            Retry
          </button>
        </Card>
      )}

      {d && (
        <>
          <NeuralMap
            nodes={d.nodes}
            edges={d.edges}
            onPick={setPicked}
            selected={picked?.id ?? null}
          />

          {/* THE LEGEND IS RENDERED AS THE ACTUAL THING, not as swatches — a key
              made of coloured squares has to be translated before it can be
              used, and a legend you have to open is a legend nobody reads.
              Floating at the bottom so it costs the canvas no height. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-2 bg-paper/85 px-4 py-2 text-[11px] text-fg-faint backdrop-blur">
            <Key svg={<circle cx="9" cy="9" r="7" className="fill-none stroke-fg-soft" />}>
              restaurant
            </Key>
            <Key svg={<path d="M9 2 L15 5.5 L15 12.5 L9 16 L3 12.5 L3 5.5 Z" className="fill-none stroke-fg-soft" />}>
              AWS service
            </Key>
            <Key svg={<path d="M9 2 L16 9 L9 16 L2 9 Z" className="fill-none stroke-fg-soft" />}>
              AI model
            </Key>
            <Key svg={<path d="M2 9 h14" className="stroke-fg-soft" strokeWidth={2.5} />}>
              measured
            </Key>
            <Key svg={<path d="M2 9 h14" className="stroke-fg-soft" strokeDasharray="4 4" />}>
              modelled — a share, not a bill
            </Key>
            <span>a pulse is one call; its speed is how long that call took</span>
          </div>

          {d.meta.measured_from && (
            <p className="pointer-events-none absolute bottom-10 right-4 z-20 max-w-sm text-right text-[10px] leading-relaxed text-fg-faint">
              Our counters start {d.meta.measured_from}. Anything before that is
              not zero — it is unmeasured, and the map says so rather than
              drawing a nought.
            </p>
          )}
        </>
      )}

      {picked && (
        <SheetPopup onClose={() => setPicked(null)} title={picked.label}>
          <NodeDetail node={picked} edges={edgesForPicked} />
        </SheetPopup>
      )}
    </div>
  );
}

function Key({ svg, children }: { svg: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        {svg}
      </svg>
      {children}
    </span>
  );
}

/** URL area → the name the product uses for it.
 *
 *  `/api/purchasing/...` is "Purchasing" on every screen a restaurant sees, and
 *  showing them the path segment instead would be the same failure as printing
 *  `EUW2-InstanceUsage:db.t4g.micro` where "Database — the server" belongs.
 *  Anything unmapped falls through to its own name rather than being hidden. */
const AREA_LABEL: Record<string, string> = {
  inventory: "Inventory",
  vendors: "Vendors",
  purchasing: "Purchasing",
  recipes: "Recipes & costing",
  sales: "Sales",
  expenses: "Expenses",
  reports: "Reports (P&L)",
  payroll: "Payroll",
  employees: "Employees",
  attendance: "Attendance",
  ordering: "Ordering & tables",
  assistant: "The AI assistant",
  documents: "Documents",
  settings: "Settings",
  hotels: "Hotel profile",
  auth: "Signing in",
  platform: "Control Room",
  public: "Public pages",
  waste: "Waste log",
  audit: "Trail",
};

function NodeDetail({ node, edges }: { node: GraphNode; edges: GraphEdge[] }) {
  const m = node.metrics ?? {};
  const rows: [string, string][] = [];

  const add = (label: string, v: unknown, fmt?: (n: number) => string) => {
    if (v == null) return;
    const n = Number(v);
    rows.push([label, fmt ? fmt(n) : n.toLocaleString()]);
  };

  add("Requests", m.requests);
  add("Database reads", m.db_selects);
  add("Database writes", m.db_writes);
  add("Server errors", m.errors_5xx);
  add("Average response", m.avg_ms, (n) => `${n} ms`);
  add("AI calls", m.ai_calls);
  add("Tokens in", m.ai_tokens_in);
  add("Tokens out", m.ai_tokens_out);
  add("AI cost", m.ai_cost_usd, (n) => `$${n.toFixed(4)}`);
  add("Average AI latency", m.ai_avg_latency_ms, (n) => `${n} ms`);
  add("AWS cost", m.usd, (n) => `$${n.toFixed(2)}`);
  add("Calls", m.calls);
  add("Tokens", m.tokens);

  const what = node.detail?.what as string | undefined;
  const areas = (node.detail?.areas as { area: string; requests: number }[]) ?? [];
  const busiest = Math.max(1, ...areas.map((a) => a.requests));

  return (
    <div className="space-y-4">
      {what && <p className="text-sm leading-relaxed text-fg-soft">{what}</p>}

      {/* PER CHANNEL, spelled out. "not measured" and "nothing happened" are
          different facts and this is where the difference is stated in words
          rather than implied by an arc. */}
      {node.channels && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(node.channels).map(([name, c]) => (
            <span
              key={name}
              className={`rounded-lg px-2 py-1 text-[11px] font-medium ${
                c.fired
                  ? "bg-emerald-500/15 text-emerald-500"
                  : "mise-well text-fg-faint"
              }`}
            >
              {name}:{" "}
              {!c.measured
                ? "not measured"
                : c.fired
                  ? `${Number(c.value ?? 0).toLocaleString()}`
                  : "nothing in this period"}
            </span>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mise-well rounded-xl p-3">
          <dl className="space-y-1.5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-fg-faint">{k}</dt>
                <dd className="font-mono text-sm tabular-nums text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {areas.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
            What they actually use
          </p>
          {/* MEASURED, NOT CONFIGURED. The features map on the hotel says what
              is switched ON, which is a much weaker claim than what anybody
              opened. This is the second one. */}
          <ul className="space-y-1">
            {areas.map((a) => (
              <li
                key={a.area}
                className="mise-well relative flex items-baseline justify-between gap-3 overflow-hidden rounded-lg px-2.5 py-1.5"
              >
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-brand-600/10"
                  style={{ width: `${(a.requests / busiest) * 100}%` }}
                />
                <span className="relative text-xs capitalize text-fg-soft">
                  {AREA_LABEL[a.area] ?? a.area.replace(/[-_]/g, " ")}
                </span>
                <span className="relative font-mono text-[11px] tabular-nums text-fg-faint">
                  {a.requests.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {edges.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
            What it connects to
          </p>
          <ul className="space-y-1">
            {edges.map((e) => (
              <li key={e.id} className="mise-well rounded-lg px-2.5 py-1.5 text-xs">
                <span className="text-fg-soft">
                  {e.source === node.id ? "→ " : "← "}
                  {e.source === node.id ? e.target : e.source}
                </span>
                {e.label && <span className="ml-2 text-fg-faint">{e.label}</span>}
                {!e.measured && (
                  <span className="ml-2 text-[10px] text-fg-faint">(modelled)</span>
                )}
                {e.latency_ms ? (
                  <span className="ml-2 font-mono text-[10px] text-fg-faint">
                    {e.latency_ms} ms avg
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
