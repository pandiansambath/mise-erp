"use client";

// /control-room/money — what the AWS bill will be, and who caused it.
//
//     "litrelly when i eneter i need ot know 'oh ths is the amount' fine...
//      ALSO SHOW HOTEL WISE TOO..WHO COST HOW MUHC N WHY WITH PROOFs"
//
// THE HERO IS NOT A `TotalsStrip`. Four equal cells is precisely what makes
// $2.25 read like 859ms on the AI page — the number he wants is the same size
// as a latency figure. This band is asymmetric on purpose: one 60px figure and
// nothing else competing with it.
//
// AND THE $60 THAT STARTED THIS WAS A FORECAST, NOT A BILL. AWS predicted
// $61.79 against a ~$30 run rate. That sentence sits behind the forecast
// figure, because the whole reason this page exists is that a forecast arrived
// by email looking like a bill.

import { useEffect, useMemo, useState } from "react";

import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { n, usd } from "@/components/controlroom/format";
import { Source, type SourceKind } from "@/components/controlroom/Source";
import { Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { Bars } from "@/components/charts";

type Env<T> = { value: T; kind: SourceKind; source?: string; stale_seconds?: number } & Record<
  string,
  unknown
>;

type Summary = {
  window: { from: string; to: string; days: number };
  month: { from: string; to: string };
  billed: {
    available: boolean;
    reason?: string;
    gross_usd: number | null;
    credits_usd: number | null;
    net_usd: number | null;
    by_service: { service: string; usage_type: string; amount_usd: number; pool: string }[];
    pools: Record<string, number>;
    unclassified?: { service: string; usage_type: string; amount_usd: number }[];
    as_of: string | null;
  };
  measured: {
    totals: Record<string, number>;
    counters_flushed_seconds_ago: number | null;
    caveat: string;
  };
  unit_economics: Record<string, { value: number | null; definition: string } | number>;
  credits: Record<string, unknown>;
  collectors: Record<string, { ok: boolean; api_cost_usd: number; error?: string } | null>;
};

type HotelRow = {
  hotel_id: string;
  name: string;
  requests: number;
  db_selects: number;
  db_writes: number;
  ai_calls: number;
  ai_usd: Env<number | null>;
  shared_usd: Env<number | null>;
};

type Hotels = {
  rows: HotelRow[];
  model: Record<string, unknown>;
  reconciliation: { aws_bedrock_usd: number | null; our_ledger_usd: number; k: number | null; note: string };
  billed_available: boolean;
};

const WINDOWS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

/** A figure we do not have renders as an em dash at full size, never $0.00.
 *  Zero is a lie that reads as good news, and on a page about money that is
 *  the single most dangerous thing it could do. */
function money(v: number | null | undefined): string {
  return v == null ? "—" : usd(v);
}

export default function MoneyPage() {
  const [days, setDays] = useState("30");
  // Frozen at mount, then ticked. Reading the clock DURING render is impure —
  // lint catches it, and the reason it matters is that two renders in the same
  // second would disagree about how stale a figure is.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const s = useOperatorQuery<Summary>(`/platform/costs/summary?days=${days}`);
  const h = useOperatorQuery<Hotels>(`/platform/costs/hotels?days=${days}`);

  const d = s.data;
  const billed = d?.billed;
  const services = useMemo(
    () =>
      (billed?.by_service ?? []).slice(0, 10).map((r) => ({
        label: r.service.replace(/ \(Amazon Bedrock Edition\)/, " (Bedrock)"),
        value: r.amount_usd,
      })),
    [billed],
  );

  const flushed = d?.measured?.counters_flushed_seconds_ago ?? null;

  return (
    <div className="flex flex-1 flex-col space-y-5">
      <PageHeader
        title="AWS bill"
        subtitle="What it will cost, what we measured, and which restaurant caused it."
      />

      {s.loading && !d && <Spinner />}
      {s.error && (
        <Card className="p-4">
          <p className="text-sm text-danger">{errorCopy(s.error)}</p>
          <button
            type="button"
            onClick={s.reload}
            className="mise-press mise-well mt-2 rounded-xl px-3 py-1.5 text-xs"
          >
            Retry
          </button>
        </Card>
      )}

      {d && (
        <>
          {/* ── THE AMOUNT ─────────────────────────────────────────────── */}
          <Card className="p-0">
            <div className="grid gap-px sm:grid-cols-[1.4fr_1fr]">
              <div className="p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
                  This month so far · USD
                </p>
                <p className="mt-1 font-display text-5xl font-bold tabular-nums text-fg sm:text-6xl">
                  {money(billed?.gross_usd)}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Source
                    kind="billed"
                    staleSeconds={
                      billed?.as_of
                        ? Math.round((now - new Date(billed.as_of).getTime()) / 1000)
                        : null
                    }
                  />
                  {!billed?.available && (
                    <span className="text-xs text-fg-faint">{billed?.reason}</span>
                  )}
                </div>
                {billed?.available && (billed.credits_usd ?? 0) !== 0 && (
                  <p className="mise-tone-good mt-2 text-[13px] font-medium">
                    Credits covered {money(Math.abs(billed.credits_usd ?? 0))} of it — you have
                    not been charged.
                  </p>
                )}
              </div>

              <div className="mise-well m-3 space-y-2 rounded-xl p-4">
                <Row
                  label="Credit left"
                  value={money(Number(d.credits?.balance_usd) || null)}
                  chip={<Source kind="entered_by_hand" />}
                />
                <Row
                  label="Measured requests"
                  value={n(d.measured.totals.requests)}
                  chip={
                    <Source
                      kind="live"
                      note={
                        flushed == null
                          ? "counters have not been written yet"
                          : `counters written ${flushed}s ago`
                      }
                    />
                  }
                />
                <Row
                  label="DB reads / writes"
                  value={`${n(d.measured.totals.db_selects)} / ${n(d.measured.totals.db_writes)}`}
                  chip={<Source kind="live" note="capacity, not cost — RDS here has no per-IO charge" />}
                />
              </div>
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented value={days} onChange={setDays} options={WINDOWS} />
            <p className="text-xs text-fg-faint">
              The amount above is always THIS CALENDAR MONTH — a bill is a month, and a
              filtered figure beside the word &ldquo;bill&rdquo; would be read as one.
            </p>
          </div>

          {/* ── WHERE IT GOES ──────────────────────────────────────────── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold text-fg">By service</h3>
                <Source kind="billed" />
              </div>
              {services.length === 0 ? (
                <p className="mt-3 text-sm text-fg-faint">
                  Nothing fetched yet. The server has no permission to read Cost Explorer
                  until the IAM change is applied.
                </p>
              ) : (
                <div className="mt-3">
                  <Bars items={services} />
                </div>
              )}
              {!!billed?.unclassified?.length && (
                <p className="mise-tone-warn mt-3 text-xs">
                  {billed.unclassified.length} unclassified service
                  {billed.unclassified.length === 1 ? "" : "s"} —{" "}
                  {billed.unclassified.map((u) => u.service).join(", ")}. Shown rather than
                  folded into a pool, so a new charge cannot hide.
                </p>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-fg">Cost per request</h3>
              <p className="text-xs text-fg-faint">
                Three numbers, because one would mislead.
              </p>
              <ul className="mt-3 space-y-2">
                {(["fully_loaded_per_1k", "marginal_per_1k", "ai_per_call"] as const).map((k) => {
                  const e = d.unit_economics[k] as { value: number | null; definition: string };
                  if (!e) return null;
                  return (
                    <li key={k} className="mise-well rounded-xl p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium text-fg-soft">
                          {k === "ai_per_call" ? "Per AI call" : k === "marginal_per_1k" ? "Marginal / 1k" : "Fully loaded / 1k"}
                        </span>
                        <span className="shrink-0 whitespace-nowrap font-mono text-sm text-fg">
                          {e.value == null ? "—" : usd(e.value)}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">{e.definition}</p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          {/* ── PER HOTEL ──────────────────────────────────────────────── */}
          <Card className="flex min-h-0 flex-1 flex-col p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold text-fg">Per restaurant</h3>
              <p className="text-xs text-fg-faint">
                Two money columns, never added together — see why below.
              </p>
            </div>

            {h.loading && !h.data && <Spinner />}
            {h.data && (
              <>
                <div className="mise-stack mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-y border-line text-left text-xs uppercase text-fg-faint">
                        <th className="px-3 py-2 font-medium">Restaurant</th>
                        <th className="px-3 py-2 text-right font-medium">Requests</th>
                        <th className="px-3 py-2 text-right font-medium">AI calls</th>
                        <th className="px-3 py-2 text-right font-medium">AI cost</th>
                        <th className="px-3 py-2 text-right font-medium">Share of the box</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.data.rows.map((r) => (
                        <tr key={r.hotel_id} className="border-b border-line">
                          <td className="px-3 py-2 font-medium text-fg">{r.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-fg-soft">
                            {n(r.requests)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-fg-soft">
                            {n(r.ai_calls)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-fg">
                            {money(r.ai_usd.value)}
                          </td>
                          {/* A DASHED UNDERLINE is the tell for "modelled".
                              It survives greyscale and all 23 themes; colour
                              alone would not. */}
                          <td className="px-3 py-2 text-right tabular-nums text-fg">
                            <span className="underline decoration-dashed underline-offset-4">
                              {money(r.shared_usd.value)}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {h.data.rows.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-3 py-6 text-center text-sm text-fg-faint">
                            No measured usage yet. The counters begin from the first request
                            after this shipped — nothing before it was recorded, and a zero
                            here would be an invention.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mise-well mt-4 rounded-xl p-3 text-[11px] leading-relaxed text-fg-faint">
                  <p>
                    <b className="text-fg-soft">AI cost is measured</b> — logged per call.{" "}
                    <b className="text-fg-soft">Share of the box is a model</b>, shown with a
                    dashed underline: AWS has never heard of a restaurant, so this splits one
                    shared machine by measured usage.
                  </p>
                  <p className="mt-1.5">
                    And the part that matters:{" "}
                    <b className="text-fg-soft">
                      the box costs the same with one restaurant or fifty.
                    </b>{" "}
                    A share of it is a fair split of rent, not a claim about who caused spend.
                  </p>
                  {h.data.reconciliation.k != null && (
                    <p className="mt-1.5">
                      AWS billed {money(h.data.reconciliation.aws_bedrock_usd)} for Bedrock; our
                      own ledger recorded {money(h.data.reconciliation.our_ledger_usd)} —{" "}
                      <b className="text-fg-soft">×{h.data.reconciliation.k.toFixed(2)}</b> apart,
                      so the per-restaurant figures above are scaled to AWS&apos;s total rather
                      than to ours.
                    </p>
                  )}
                  <p className="mt-1.5">{d.measured.caveat}.</p>
                </div>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Row({ label, value, chip }: { label: string; value: string; chip?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="min-w-0 truncate text-xs text-fg-soft">{label}</span>
      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
        <span className="font-mono text-sm text-fg">{value}</span>
        {chip}
      </span>
    </div>
  );
}
