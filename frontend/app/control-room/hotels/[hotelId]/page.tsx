"use client";

// hotels/[hotelId] — Vitals. The hotel's own name and plan already live in
// the layout above; this page is metrics only, and two links onward to the
// Activity and AI tabs so a number is never a dead end.

import { use, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { PageHeader, Spinner } from "@/components/ui";
import { TotalsStrip } from "@/components/PageKit";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { usd, n, agoDays } from "@/components/controlroom/format";

type Health = {
  window_days: number;
  ai_calls: number;
  ai_cost_usd: number;
  ai_failures: number;
  actions: number;
  ai_threads: number;
  last_seen: string | null;
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
      <button type="button" onClick={retry} className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold">
        Retry
      </button>
    </div>
  );
}

export default function HotelVitalsPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = use(params);
  const { user } = useAuth();
  const q = useOperatorQuery<Health>(`/platform/hotels/${hotelId}/health?days=30`);
  const [nowTs] = useState(() => Date.now());

  if (!user?.is_platform_owner) return null;
  if (q.loading && !q.data) return <Spinner />;
  if (q.error) return <ErrorCard title="Could not load this hotel's vitals" error={q.error} retry={q.reload} />;

  const h = q.data;

  return (
    <div className="space-y-4">
      <PageHeader title="Vitals" subtitle={`Last ${h?.window_days ?? 30} days.`} />

      <TotalsStrip
        items={[
          { label: "AI calls · 30d", value: h ? n(h.ai_calls) : "—" },
          { label: "AI spend · 30d", value: h ? usd(h.ai_cost_usd) : "—", hint: "USD" },
          {
            label: "AI failures · 30d",
            value: h ? n(h.ai_failures) : "—",
            tone: h && h.ai_failures > 0 ? "bad" : "plain",
          },
          { label: "Last seen", value: h ? agoDays(h.last_seen, nowTs) : "—" },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href={`/control-room/hotels/${hotelId}/activity`}
          className="mise-card-inset mise-press flex items-center justify-between gap-3 p-4 transition hover:brightness-110"
        >
          <span>
            <span className="block text-xs font-medium uppercase tracking-wide text-fg-faint">Activity · 30d</span>
            <span className="mt-1 block font-mono text-2xl font-semibold tabular-nums text-fg">{h ? n(h.actions) : "—"}</span>
            <span className="mt-0.5 block text-xs text-fg-faint">recorded actions — open the log</span>
          </span>
          <span aria-hidden className="shrink-0 text-fg-faint">›</span>
        </Link>
        <Link
          href={`/control-room/hotels/${hotelId}/ai`}
          className="mise-card-inset mise-press flex items-center justify-between gap-3 p-4 transition hover:brightness-110"
        >
          <span>
            <span className="block text-xs font-medium uppercase tracking-wide text-fg-faint">AI conversations</span>
            <span className="mt-1 block font-mono text-2xl font-semibold tabular-nums text-fg">{h ? n(h.ai_threads) : "—"}</span>
            <span className="mt-0.5 block text-xs text-fg-faint">threads — open the list</span>
          </span>
          <span aria-hidden className="shrink-0 text-fg-faint">›</span>
        </Link>
      </div>
    </div>
  );
}
