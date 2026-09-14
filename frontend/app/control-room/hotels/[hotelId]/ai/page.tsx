"use client";

// hotels/[hotelId]/ai — thread list. Titles only, and reading this list is
// NOT audited (only opening a transcript is) — the permanent notice below
// says both things plainly, per 33.4 privacy #1 and #3.

import { use } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { PageHeader, Spinner, EmptyState } from "@/components/ui";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { n } from "@/components/controlroom/format";

type Thread = { id: string; title: string; started: string; last: string; messages: number };

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

export default function HotelAiThreadsPage({ params }: { params: Promise<{ hotelId: string }> }) {
  const { hotelId } = use(params);
  const { user } = useAuth();
  const q = useOperatorQuery<{ threads: Thread[] }>(`/platform/hotels/${hotelId}/ai-threads`);

  if (!user?.is_platform_owner) return null;
  if (q.loading && !q.data) return <Spinner />;
  if (q.error) return <ErrorCard title="Could not load AI conversations" error={q.error} retry={q.reload} />;

  const threads = q.data?.threads ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="AI conversations" subtitle="This hotel's threads with their assistant." />

      {/* J1 — permanent, not a tooltip, not dismissible, visible without
          scrolling this list. */}
      <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-amber-400/70" />
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-fg-soft">
          <p className="font-semibold text-fg">These are this restaurant&apos;s private conversations with their assistant.</p>
          <p className="mt-1">
            Opening one is recorded in the operator trail under your name, with the conversation&apos;s id, before it is shown to
            you. Open one only when you are handling a support request from this restaurant.
          </p>
          <p className="mt-1 text-fg-faint">Titles only until you open one — this list itself is not audited; opening a transcript is.</p>
        </div>
      </div>

      {threads.length === 0 ? (
        <EmptyState chef={false} icon="—" title="No AI conversations yet" body="Nothing has been asked of the assistant at this hotel." />
      ) : (
        <ul className="mise-card-inset divide-y divide-line/60 p-0">
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                href={`/control-room/hotels/${hotelId}/ai/${t.id}`}
                className="mise-press flex items-center gap-3 px-4 py-3 transition hover:bg-glass/[0.04]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{t.title || "(untitled)"}</span>
                  <span className="block truncate font-mono text-[11px] text-fg-faint">
                    started {new Date(t.started).toLocaleDateString()} · last {new Date(t.last).toLocaleDateString()}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-fg-faint">
                  {n(t.messages)} msg{t.messages === 1 ? "" : "s"}
                </span>
                <span aria-hidden className="shrink-0 text-fg-faint">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
