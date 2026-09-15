"use client";

// /control-room/ai — platform AI spend. Nothing rendered `/ai/by-hotel` or
// `/ai/daily` before this page existed (ARCHITECTURE.md). Every money figure
// here is USD (Bedrock's own currency) — usd(), never useCurrency().

import { useMemo, useState } from "react";
import Link from "next/link";

import { ApiError } from "@/lib/api";
import { useFleet } from "@/components/controlroom/FleetProvider";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { n, usd } from "@/components/controlroom/format";
import { STRIPE } from "@/components/TileCard";
import { Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { TotalsStrip } from "@/components/PageKit";
import { AreaChart, Meter } from "@/components/charts";
import { Pager, applyFilter, pageOf, useListFilter } from "@/components/ListControls";

type AiHotelRow = {
  hotel_id: string;
  name: string;
  handle: string | null;
  calls: number;
  cost_usd: number;
  tokens: number;
  avg_latency_ms: number;
  failures: number;
  last_used: string | null;
};

type DailyPoint = { day: string; calls: number; cost_usd: number };

type PulseAi = {
  calls: number;
  cost_usd: number;
  tokens: number;
  avg_latency_ms: number;
  failures: number;
  failure_rate: number;
};

type PlanFull = {
  key: string;
  label: string;
  ai_daily_requests: number;
  ai_monthly_tokens: number;
};

/** Error state — opposite of empty on every axis (DESIGN-STANDARD §5 F2):
 *  solid, rose-railed, a large mono HTTP status, Retry that is never disabled. */
function ErrorCard({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-rose-400" />
      <span className="font-mono text-2xl font-bold leading-none text-danger">
        {error.status || "!"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">This did not load</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-soft">{errorCopy(error)}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

/** Zero-fill the sparse daily series — /ai/daily only returns days WITH
 *  activity, so charting it raw would draw a false trend line across gaps.
 *  `today` is passed in rather than read here: reading the clock during
 *  render is impure (see health.ts's healthOf for the same rule). */
function fillDays(rows: DailyPoint[], days: number, today: Date): { date: string; cost: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: { date: string; cost: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date: iso, cost: byDay.get(iso)?.cost_usd ?? 0 });
  }
  return out;
}

export default function AiSpendPage() {
  const { hotels } = useFleet();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const daysNum = Number(days);

  const pulseQ = useOperatorQuery<{ ai: PulseAi }>(`/platform/pulse?days=${daysNum}`);
  const byHotelQ = useOperatorQuery<{ hotels: AiHotelRow[] }>(`/platform/ai/by-hotel?days=${daysNum}`);
  const dailyQ = useOperatorQuery<{ days: DailyPoint[] }>(`/platform/ai/daily?days=${daysNum}`);
  const plansQ = useOperatorQuery<{ plans: PlanFull[] }>("/platform/plans");

  const [f, setF] = useListFilter("cr.ai.byhotel", 50);
  // Frozen at mount — the same lazy-initialiser idiom fleet/page.tsx uses for
  // "days ago" math, so the React Compiler does not see a bare `new Date()`
  // read during render.
  const [today] = useState(() => new Date());

  const planByKey = useMemo(
    () => Object.fromEntries((plansQ.data?.plans ?? []).map((p) => [p.key, p])),
    [plansQ.data],
  );

  const rows = useMemo(() => byHotelQ.data?.hotels ?? [], [byHotelQ.data]);
  const filtered = useMemo(
    () =>
      applyFilter(rows, f, (h) => ({
        text: `${h.name} ${h.handle ?? ""}`,
        status: "all",
        date: h.last_used ?? "",
        value: h.cost_usd,
      })),
    [rows, f],
  );
  const shown = pageOf(filtered, f);

  const filled = useMemo(
    () => (dailyQ.data ? fillDays(dailyQ.data.days, daysNum, today) : []),
    [dailyQ.data, daysNum, today],
  );
  const platformFailureRate = pulseQ.data?.ai.failure_rate ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI spend"
        subtitle="Platform-wide Bedrock usage, by day and by restaurant. Every figure here is USD."
        actions={
          <Segmented
            value={days}
            onChange={(v) => {
              setF({ ...f, page: 1 });
              setDays(v);
            }}
            options={[
              { value: "7", label: "7d" },
              { value: "30", label: "30d" },
              { value: "90", label: "90d" },
            ]}
          />
        }
      />

      {pulseQ.error ? (
        <ErrorCard error={pulseQ.error} onRetry={pulseQ.reload} />
      ) : pulseQ.loading || !pulseQ.data ? (
        <Spinner />
      ) : (
        <TotalsStrip
          items={[
            { label: `Cost · ${days}d`, value: usd(pulseQ.data.ai.cost_usd), strong: true },
            { label: "Calls", value: n(pulseQ.data.ai.calls), hint: "AI requests" },
            { label: "Avg latency", value: `${n(pulseQ.data.ai.avg_latency_ms)}ms` },
            {
              label: "Failure rate",
              value: `${(pulseQ.data.ai.failure_rate * 100).toFixed(1)}%`,
              tone: pulseQ.data.ai.failure_rate > 0.02 ? "warn" : "good",
              hint: `${n(pulseQ.data.ai.failures)} failed calls`,
            },
          ]}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
              Daily spend — {days}d · USD
            </h3>
          </div>
          {dailyQ.error ? (
            <ErrorCard error={dailyQ.error} onRetry={dailyQ.reload} />
          ) : dailyQ.loading ? (
            <Spinner />
          ) : (
            <div className="max-w-[45rem]">
              <AreaChart
                data={filled.map((d) => d.cost)}
                labels={filled.map((d) => d.date.slice(5))}
                height={160}
                formatValue={(v) => usd(v)}
              />
            </div>
          )}
        </Card>

        <Card>
          <h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
            What this covers
          </h3>
          <ul className="space-y-2 text-sm text-fg-soft">
            <li>
              This is <b className="text-fg">tenant and AI</b> observability only — model
              calls, cost, tokens and per-hotel spend, all read from usage the platform
              already records.
            </li>
            <li>
              It does <b className="text-fg">not</b> cover infrastructure — uptime, HTTP
              error rates or deploy history live in CloudWatch, not here.
            </li>
            <li>
              The allowance meters below only show at the <b className="text-fg">30-day</b>{" "}
              window, because a 7- or 90-day total against a monthly cap would draw a ratio
              that means nothing.
            </li>
          </ul>
        </Card>
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
            Spend by restaurant — {days}d
          </h3>
          <span className="font-mono text-[11px] tabular-nums text-fg-faint">
            {filtered.length} of {rows.length}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-y border-line px-4 py-2.5">
          <input
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })}
            placeholder="Search by hotel name or handle…"
            className="mise-well w-full max-w-sm rounded-xl px-3 py-2 text-sm outline-none"
          />
        </div>

        {byHotelQ.error ? (
          <div className="p-4">
            <ErrorCard error={byHotelQ.error} onRetry={byHotelQ.reload} />
          </div>
        ) : byHotelQ.loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center">
            <p className="font-display text-lg font-semibold text-fg">No AI calls yet</p>
            <p className="mt-1.5 max-w-sm text-sm text-fg-faint">
              Nobody on the fleet has used the assistant in this window.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="mise-stack w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                    <th className="px-4 py-2.5">Restaurant</th>
                    <th className="px-3 py-2.5 text-right">Calls</th>
                    <th className="px-3 py-2.5 text-right">Tokens</th>
                    <th className="px-3 py-2.5 text-right">Cost</th>
                    <th className="px-3 py-2.5 text-right">Avg latency</th>
                    <th className="px-3 py-2.5 text-right">Reliability</th>
                    <th className="px-4 py-2.5 text-right">Allowance (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((h) => {
                    const isDeleted = h.name === "(deleted restaurant)";
                    const fleetHotel = hotels.find((x) => x.id === h.hotel_id);
                    const plan = fleetHotel ? planByKey[fleetHotel.plan] : undefined;
                    const dailyLimit = fleetHotel?.ai_daily_override ?? plan?.ai_daily_requests ?? 0;
                    const monthlyLimit = fleetHotel?.ai_monthly_override ?? plan?.ai_monthly_tokens ?? 0;
                    const hotelFailRate = h.calls > 0 ? h.failures / h.calls : 0;
                    const flagged = h.calls >= 5 && hotelFailRate > platformFailureRate * 1.5 + 0.02;
                    const rail = flagged ? STRIPE.overdue : h.calls > 0 ? STRIPE.ok : STRIPE.none;
                    const nameCell = (
                      <>
                        <span className="block truncate text-sm font-semibold text-fg">{h.name}</span>
                        {h.handle && !isDeleted && (
                          <span className="block truncate font-mono text-[11px] text-fg-faint">
                            @{h.handle}
                          </span>
                        )}
                      </>
                    );
                    return (
                      <tr key={h.hotel_id} className="group border-b border-line/60 transition hover:bg-glass/[0.04]">
                        <td data-label="Restaurant" className="relative py-2.5 pl-4 pr-3">
                          <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${rail}`} />
                          {isDeleted || !fleetHotel ? (
                            nameCell
                          ) : (
                            <Link href={`/control-room/hotels/${h.hotel_id}/ai`} className="hover:underline">
                              {nameCell}
                            </Link>
                          )}
                        </td>
                        <td data-label="Calls" className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-fg-soft">
                          {n(h.calls)}
                        </td>
                        <td data-label="Tokens" className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-fg-soft">
                          {n(h.tokens)}
                        </td>
                        <td data-label="Cost" className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-fg">
                          {usd(h.cost_usd)}
                        </td>
                        <td data-label="Avg latency" className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-fg-soft">
                          {n(h.avg_latency_ms)}ms
                        </td>
                        <td data-label="Reliability" className="px-3 py-2.5 text-right">
                          {flagged ? (
                            <span className="mise-chip" data-tone="red">
                              worse than platform
                            </span>
                          ) : h.calls > 0 ? (
                            <span className="mise-chip" data-tone="green">
                              normal
                            </span>
                          ) : (
                            <span className="text-xs text-fg-faint">—</span>
                          )}
                        </td>
                        <td data-label="Allowance (30d)" className="px-4 py-2.5">
                          {daysNum !== 30 ? (
                            <span className="block text-right text-[11px] text-fg-faint">30-day view only</span>
                          ) : isDeleted || !fleetHotel ? (
                            <span className="block text-right text-[11px] text-fg-faint">—</span>
                          ) : (
                            <div className="ml-auto w-40 space-y-1.5">
                              {monthlyLimit > 0 ? (
                                <Meter
                                  value={Math.round((h.tokens / monthlyLimit) * 1000) / 10}
                                  target={100}
                                  suffix="%"
                                  label="tokens/mo"
                                />
                              ) : (
                                <p className="text-right text-[11px] text-fg-faint">no token allowance</p>
                              )}
                              {dailyLimit > 0 ? (
                                <Meter
                                  value={Math.round(((h.calls / 30) / dailyLimit) * 1000) / 10}
                                  target={100}
                                  suffix="%"
                                  label="calls/day avg"
                                />
                              ) : (
                                <p className="text-right text-[11px] text-fg-faint">no daily allowance</p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager value={f} onChange={setF} matched={filtered.length} />
          </>
        )}
      </Card>
    </div>
  );
}
