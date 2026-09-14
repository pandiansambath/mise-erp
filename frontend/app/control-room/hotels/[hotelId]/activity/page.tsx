"use client";

// hotels/[hotelId]/activity — 33.3. The hotel's own audit trail, read-only,
// cursor-paged. There is no server-side search on this endpoint (it takes
// only limit + before), so the search box here filters the WINDOW ALREADY
// LOADED and says so — inventing a query param the API does not support
// would silently only ever search the first page.

import { use, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";

type Ev = {
  id: string;
  action: string;
  summary: string;
  who: string;
  entity_type: string | null;
  entity_id: string | null;
  at: string;
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

export default function HotelActivityPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = use(params);
  const { user } = useAuth();
  const q = useOperatorQuery<{ events: Ev[] }>(`/platform/hotels/${hotelId}/activity?limit=200`);
  const [older, setOlder] = useState<Ev[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiError | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [query, setQuery] = useState("");

  const all = useMemo(() => [...(q.data?.events ?? []), ...older], [q.data, older]);

  const shown = useMemo(() => {
    const s = query.trim().toLowerCase();
    if (!s) return all;
    return all.filter((e) => e.summary.toLowerCase().includes(s) || e.action.toLowerCase().includes(s) || e.who.toLowerCase().includes(s));
  }, [all, query]);

  async function loadMore() {
    if (all.length === 0) return;
    const before = all[all.length - 1].at;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const r = await api.get<{ events: Ev[] }>(`/platform/hotels/${hotelId}/activity?limit=200&before=${encodeURIComponent(before)}`);
      if (r.events.length === 0) setExhausted(true);
      setOlder((o) => [...o, ...r.events]);
    } catch (e) {
      setMoreError(e instanceof ApiError ? e : new ApiError(0, "Could not load older activity."));
    } finally {
      setLoadingMore(false);
    }
  }

  if (!user?.is_platform_owner) return null;
  if (q.loading && !q.data) return <Spinner />;
  if (q.error) return <ErrorCard title="Could not load this hotel's activity" error={q.error} retry={q.reload} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Activity" subtitle="Everything recorded for this hotel, newest first." />

      <div className="mise-card-inset p-0">
        <div className="border-b border-line p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter the loaded window…"
            className="mise-well w-full max-w-md rounded-xl px-3 py-2 text-sm outline-none"
          />
          <p className="mt-1.5 text-[11px] text-fg-faint">
            There is no server-side search on this log — this filters only the {all.length} event{all.length === 1 ? "" : "s"} already loaded below.
          </p>
        </div>

        {shown.length === 0 ? (
          <div className="p-6">
            <EmptyState chef={false} icon="—" title={all.length === 0 ? "No activity recorded yet" : "Nothing matches"} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="mise-stack w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                  <th className="px-4 py-2.5">What</th>
                  <th className="px-3 py-2.5">Who</th>
                  <th className="px-3 py-2.5">When</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="border-b border-line/60">
                    <td className="py-2.5 pl-4 pr-3">
                      <span className="block truncate text-sm text-fg">{e.summary}</span>
                      <span className="block truncate font-mono text-[11px] text-fg-faint">{e.action}</span>
                    </td>
                    <td data-label="Who" className="px-3 py-2.5 text-right font-mono text-xs text-fg-soft sm:text-left">
                      {e.who}
                    </td>
                    <td data-label="When" className="px-3 py-2.5 text-right font-mono text-xs text-fg-soft sm:text-left">
                      {new Date(e.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {moreError && (
          <div className="border-t border-line p-3">
            <ErrorCard title="Could not load older activity" error={moreError} retry={loadMore} />
          </div>
        )}

        {!exhausted && all.length > 0 && (
          <div className="flex justify-center border-t border-line p-3">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="mise-btn-flat mise-press px-4 py-2 text-xs font-semibold text-fg-soft"
            >
              {loadingMore ? "Loading…" : "Load older activity"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
