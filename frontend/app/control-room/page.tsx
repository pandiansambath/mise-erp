"use client";

// /control-room — Overview. The pulse: one screen, no scroll, the fleet's
// health ranked so the first thing an operator reads is what needs them.
//
// Coverage matrix: 4 StatCards -> TotalsStrip · signups sparkline / plan donut
// / signup funnel -> the charts card (funnel folded to one line — H4, a
// two-bar 100% chart is not a chart) · NEW 33.5.A attention queue.

import Link from "next/link";
import { useMemo } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { Sparkline, Donut } from "@/components/charts";
import { TotalsStrip } from "@/components/PageKit";
import { STRIPE, type StripeTone } from "@/components/TileCard";
import { useFleet } from "@/components/controlroom/FleetProvider";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { attention } from "@/components/controlroom/health";
import { usd, n } from "@/components/controlroom/format";

type Pulse = {
  window_days: number;
  ai: {
    calls: number;
    cost_usd: number;
    cost_usd_24h: number;
    tokens: number;
    avg_latency_ms: number;
    failures: number;
    failure_rate: number;
  };
  tenants: { total: number; active: number; trialing: number; past_due: number; trials_ending: unknown[] };
  activity: { actions: number; users_seen: number };
};

const TONE_RAIL: Record<"bad" | "warn" | "plain", StripeTone> = {
  bad: "overdue",
  warn: "soon",
  plain: "none",
};

function ErrorCard({ title, error, retry }: { title: string; error: ApiError; retry: () => void }) {
  return (
    <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-rose-400" />
      <span className="font-mono text-2xl font-bold leading-none text-danger">{error.status || "!"}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-soft">{errorCopy(error)}</p>
      </div>
      <button
        type="button"
        onClick={retry}
        className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

export default function ControlRoomOverviewPage() {
  const { user } = useAuth();
  const { hotels, loading: fleetLoading, error: fleetError, reload: reloadFleet } = useFleet();
  const pulseQ = useOperatorQuery<Pulse>("/platform/pulse?days=30");

  const items = useMemo(
    () => attention(hotels, pulseQ.data?.tenants.trials_ending ?? []),
    [hotels, pulseQ.data],
  );

  const signupSeries = useMemo(() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return { months, counts: months.map((m) => hotels.filter((h) => h.created_at.slice(0, 7) === m).length) };
  }, [hotels]);

  if (!user?.is_platform_owner) return null; // layout redirects; flash-guard only

  if (fleetLoading && hotels.length === 0) return <Spinner />;
  if (fleetError) return <ErrorCard title="Could not load the fleet" error={fleetError} retry={reloadFleet} />;

  const active = hotels.filter((h) => h.is_active).length;
  const traded = hotels.filter((h) => h.has_traded).length;
  const p = pulseQ.data;

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader title="Overview" subtitle="The platform's pulse — every hotel, one screen." />

      {pulseQ.error && (
        <ErrorCard title="Could not load platform metrics" error={pulseQ.error} retry={pulseQ.reload} />
      )}

      {/* C2 — the headline figures are ONE bordered object with hairline
          cells, never four separate cards. */}
      <TotalsStrip
        items={[
          { label: "Hotels", value: n(hotels.length), hint: `${active} active` },
          { label: "AI calls · 30d", value: p ? n(p.ai.calls) : "—", hint: p ? `${p.ai.failures} failed` : undefined },
          { label: "AI spend · 30d", value: p ? usd(p.ai.cost_usd) : "—", hint: "USD" },
          {
            label: "Trialing",
            value: p ? n(p.tenants.trialing) : "—",
            hint: p ? `${p.tenants.past_due} past due` : undefined,
            tone: p && p.tenants.past_due > 0 ? "warn" : "plain",
          },
        ]}
      />

      {/* B4 — two columns at 1920. Left: what needs a human. Right: the
          platform's shape. Each card owns its own internal scroll so the
          PAGE never does (rubric A1). */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <section className="mise-card-inset flex min-h-0 flex-col p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">Needs you</h3>
            <span className="font-mono text-[11px] tabular-nums text-fg-faint">{items.length} of {items.length}</span>
          </div>
          {items.length === 0 ? (
            <EmptyState chef={false} icon="✓" title="Nothing needs you right now" body="Every hotel is active, trading, and inside its plan." />
          ) : (
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {items.map((it, i) => (
                <li key={`${it.hotelId}-${i}`}>
                  <Link
                    href={`/control-room/hotels/${it.hotelId}`}
                    className="mise-well mise-press relative flex items-center gap-3 overflow-hidden rounded-xl py-2.5 pl-4 pr-3 text-sm transition hover:brightness-110"
                  >
                    <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${STRIPE[TONE_RAIL[it.tone]]}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-fg">{it.hotelName}</span>
                      <span className="block truncate text-xs text-fg-faint">{it.reason}</span>
                    </span>
                    <span aria-hidden className="shrink-0 text-fg-faint">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mise-card-inset flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
          <div className="mise-well rounded-xl p-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">Signups · 12 months</p>
            <Sparkline data={signupSeries.counts} height={56} className="mt-2 w-full" />
            <div className="mt-1.5 flex justify-between text-[10px] text-fg-faint">
              <span>{signupSeries.months[0]}</span>
              <span>{signupSeries.counts.reduce((s, x) => s + x, 0)} total</span>
              <span>{signupSeries.months[11]}</span>
            </div>
          </div>
          <div className="mise-well rounded-xl p-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">Fleet by plan</p>
            {hotels.length === 0 ? (
              <p className="mt-2 text-xs text-fg-faint">No hotels yet.</p>
            ) : (
              <Donut
                className="mt-2"
                size={112}
                thickness={11}
                centerLabel="hotels"
                centerValue={String(hotels.length)}
                segments={["starter", "pro", "enterprise"].map((k) => ({
                  label: k[0].toUpperCase() + k.slice(1),
                  value: hotels.filter((h) => h.plan === k).length,
                }))}
              />
            )}
            <p className="mt-2 text-[11px] text-fg-faint">
              <b className="text-fg-soft">{traded}</b> of {hotels.length} hotel{hotels.length === 1 ? "" : "s"} have recorded a sale.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
