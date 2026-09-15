"use client";

// /control-room/health — the SOFTWARE's vitals, as opposed to the business's.
//
//     "we need observability feature too, like monitoring dashboard for entire
//      project — I don't know how to say but yeah we need."
//
// The Control Room had AI and tenant observability — spend, calls, latency,
// failure rate — and nothing at all about the app itself. A qa pass on
// production put it plainly: the AI page told the operator, in its own copy,
// that uptime and HTTP error rates "live in CloudWatch, not here". Pointing at
// another console is not a monitoring dashboard, it is homework.
//
// Everything here comes from an in-process ring buffer (backend
// `app/core/pulse.py`), which costs one deque append per request and no query.
// The limits of that are stated ON THE PAGE rather than hidden, because a
// number whose scope you cannot see is worse than no number.

import { useMemo, useState } from "react";

import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { n } from "@/components/controlroom/format";
import { Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { TotalsStrip } from "@/components/PageKit";
import { AreaChart } from "@/components/charts";

type SlowRow = { path: string; calls: number; avg_ms: number; max_ms: number };
type Minute = { minutes_ago: number; requests: number; errors: number };

type HttpPulse = {
  uptime_seconds: number;
  started_at: string;
  version: string;
  window_seconds: number;
  requests: number;
  scope: string;
  error_rate: number | null;
  client_error_rate?: number;
  server_errors?: number;
  client_errors?: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  slow_calls?: number;
  slow_threshold_ms?: number;
  slowest: SlowRow[];
  by_status: Record<string, number>;
  per_minute: Minute[];
};

/** "3 days, 4 hours" — never a raw second count, and never "3.16 days". */
function humanUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d} day${d > 1 ? "s" : ""}, ${h} hr${h === 1 ? "" : "s"}`;
  if (h) return `${h} hr${h === 1 ? "" : "s"}, ${m} min`;
  if (m) return `${m} min`;
  return `${s}s`;
}

const WINDOWS = [
  { id: "60", label: "1 hour" },
  { id: "180", label: "3 hours" },
  { id: "720", label: "12 hours" },
];

export default function HealthPage() {
  const [mins, setMins] = useState("60");
  const q = useOperatorQuery<HttpPulse>(`/platform/pulse/http?minutes=${mins}`);
  const p = q.data;

  const spark = useMemo(
    () => (p?.per_minute ?? []).map((m) => m.requests),
    [p],
  );

  // A rate is only meaningful against a denominator. With a handful of requests
  // in the window, "33% errors" means one request failed — so say the count.
  const thin = (p?.requests ?? 0) < 30;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Health"
        subtitle="The software itself — is it up, is it fast, is it erroring."
      />

      {q.loading && !p && <Spinner />}
      {q.error && (
        <Card className="p-4">
          <p className="text-sm text-danger">{errorCopy(q.error)}</p>
          <button type="button" onClick={q.reload} className="mise-press mise-well mt-2 rounded-xl px-3 py-1.5 text-xs">
            Retry
          </button>
        </Card>
      )}

      {p && (
        <>
          <TotalsStrip
            items={[
              {
                label: "Up for",
                value: humanUptime(p.uptime_seconds),
                hint: `version ${p.version.slice(0, 7)}`,
              },
              {
                label: "Requests",
                value: n(p.requests),
                hint: `last ${WINDOWS.find((w) => w.id === mins)?.label ?? ""}`,
              },
              {
                label: "Server errors",
                value: p.error_rate === null ? "—" : `${p.error_rate}%`,
                hint: `${n(p.server_errors ?? 0)} of ${n(p.requests)}`,
                tone: (p.server_errors ?? 0) === 0 ? "good" : "bad",
              },
              {
                label: "p95 latency",
                value: p.p95_ms === null ? "—" : `${n(p.p95_ms)}ms`,
                hint: p.p50_ms === null ? "" : `p50 ${n(p.p50_ms)}ms · p99 ${n(p.p99_ms ?? 0)}ms`,
                tone: (p.p95_ms ?? 0) > 1500 ? "warn" : "good",
              },
            ]}
          />

          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              value={mins}
              onChange={setMins}
              options={WINDOWS.map((w) => ({ value: w.id, label: w.label }))}
            />
            {thin && (
              <p className="text-xs text-fg-faint">
                Quiet window — percentages are read from {n(p.requests)} requests, so
                treat them as counts rather than rates.
              </p>
            )}
          </div>

          {spark.length > 1 && (
            <Card className="p-4">
              <h3 className="font-semibold text-fg">Traffic</h3>
              <p className="text-xs text-fg-faint">Requests per minute, oldest on the left.</p>
              <AreaChart data={spark} height={110} className="mt-3" />
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h3 className="font-semibold text-fg">Slowest endpoints</h3>
              <p className="text-xs text-fg-faint">
                By AVERAGE, not worst case — one cold start should not convict a route
                that is fine the other four hundred times. Ids are collapsed to{" "}
                <code className="text-fg-soft">{"{id}"}</code>.
              </p>
              {p.slowest.length === 0 ? (
                <p className="mt-3 text-sm text-fg-faint">Nothing recorded yet.</p>
              ) : (
                <ul className="mt-3 space-y-1.5">
                  {p.slowest.map((r) => (
                    <li key={r.path} className="mise-well flex items-center gap-3 rounded-xl px-3 py-2">
                      <code className="min-w-0 flex-1 truncate text-xs text-fg-soft">{r.path}</code>
                      <span className="shrink-0 whitespace-nowrap text-xs text-fg-faint">
                        {n(r.calls)}×
                      </span>
                      <span
                        className={`shrink-0 whitespace-nowrap font-mono text-sm ${
                          r.avg_ms >= (p.slow_threshold_ms ?? 800) ? "mise-tone-warn" : "text-fg"
                        }`}
                      >
                        {n(r.avg_ms)}ms
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="font-semibold text-fg">Responses</h3>
              <p className="text-xs text-fg-faint">Every reply this container has sent, by class.</p>
              <ul className="mt-3 space-y-1.5">
                {Object.entries(p.by_status)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([cls, count]) => (
                    <li key={cls} className="mise-well flex items-center gap-3 rounded-xl px-3 py-2">
                      <span
                        aria-hidden
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                          cls.startsWith("5") ? "mise-bg-bad" : cls.startsWith("4") ? "mise-bg-warn" : "mise-bg-good"
                        }`}
                      />
                      <span className="min-w-0 flex-1 font-mono text-xs text-fg-soft">{cls}</span>
                      <span className="shrink-0 font-mono text-sm text-fg">{n(count)}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-3 text-xs text-fg-faint">
                4xx is usually somebody mistyping a password, not a fault —{" "}
                {n(p.client_errors ?? 0)} of {n(p.requests)} here. 5xx is ours.
              </p>
            </Card>
          </div>

          {/* The limits, on the page rather than in a comment nobody reads.
              A number whose scope you cannot see is worse than no number. */}
          <Card className="p-4">
            <h3 className="font-semibold text-fg">What this does and does not cover</h3>
            <ul className="mt-2 space-y-1 text-xs leading-relaxed text-fg-faint">
              <li>
                <b className="text-fg-soft">Scope:</b> {p.scope}. One box, one process — so
                today that is the whole app, but it is not a fleet-wide figure and will stop
                being the whole picture the moment there are two containers.
              </li>
              <li>
                <b className="text-fg-soft">It resets on deploy.</b> Running since{" "}
                {new Date(p.started_at).toLocaleString()}. That is the window you actually
                want when asking whether what you just shipped is healthy.
              </li>
              <li>
                <b className="text-fg-soft">Long-range history is CloudWatch</b> (
                <code>/dineai/app</code>, eu-west-2). This is the live view; it holds the
                most recent requests, not all of them.
              </li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
