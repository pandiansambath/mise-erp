"use client";

// /control-room/audit — three tabs: Operator actions, Support access, Deleted
// restaurants. "Support access" (33.4 §D) is a pure client-side filter of the
// SAME /platform/audit data to the two privacy-sensitive actions — opening a
// support view and reading a hotel's AI transcripts.

import { useMemo, useState } from "react";

import { ApiError } from "@/lib/api";
import { useFleet } from "@/components/controlroom/FleetProvider";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { DeletedHotels } from "@/components/DeletedHotels";
import { Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { Pager, applyFilter, pageOf, useListFilter } from "@/components/ListControls";

type Ev = {
  id: string;
  hotel_id: string;
  user_email: string;
  action: string;
  summary: string;
  created_at: string | null;
};

const SUPPORT_ACTIONS = new Set(["platform.impersonate", "platform.read_ai_chat"]);

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

function EventTable({
  rows,
  hotelName,
  filterKey,
  emptyTitle,
  emptyBody,
}: {
  rows: Ev[];
  hotelName: (id: string) => string;
  filterKey: string;
  emptyTitle: string;
  emptyBody: string;
}) {
  const [f, setF] = useListFilter(filterKey);
  const filtered = useMemo(
    () =>
      applyFilter(rows, f, (e) => ({
        text: `${e.summary} ${e.user_email} ${e.action}`,
        status: "all",
        date: e.created_at ?? "",
        value: 0,
      })),
    [rows, f],
  );
  const shown = pageOf(filtered, f);

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center">
        <p className="font-display text-lg font-semibold text-fg">{emptyTitle}</p>
        <p className="mt-1.5 max-w-sm text-sm text-fg-faint">{emptyBody}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <input
          value={f.q}
          onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })}
          placeholder="Search by action, operator or summary…"
          className="mise-well w-full max-w-sm rounded-xl px-3 py-2 text-sm outline-none"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="mise-stack w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
              <th className="px-4 py-2.5">Action</th>
              <th className="px-3 py-2.5">Restaurant</th>
              <th className="px-3 py-2.5">Operator</th>
              <th className="px-3 py-2.5">When</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className="border-b border-line/60 transition hover:bg-glass/[0.04]">
                <td data-label="Action" className="px-4 py-2.5">
                  <span className="block truncate font-mono text-[11px] text-fg-faint">{e.action}</span>
                  <span className="block truncate text-sm text-fg">{e.summary}</span>
                </td>
                <td data-label="Restaurant" className="px-3 py-2.5 text-xs text-fg-soft">
                  {hotelName(e.hotel_id)}
                </td>
                <td data-label="Operator" className="px-3 py-2.5 text-xs text-fg-soft">{e.user_email}</td>
                <td data-label="When" className="px-3 py-2.5 font-mono text-xs text-fg-faint">
                  {e.created_at
                    ? new Date(e.created_at).toLocaleString(undefined, {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager value={f} onChange={setF} matched={filtered.length} />
    </>
  );
}

export default function AuditPage() {
  const { hotels } = useFleet();
  const auditQ = useOperatorQuery<{ events: Ev[] }>("/platform/audit");
  const [tab, setTab] = useState<"operator" | "support" | "deleted">("operator");

  const nameOf = (id: string) => hotels.find((h) => h.id === id)?.name ?? "—";
  const events = useMemo(() => auditQ.data?.events ?? [], [auditQ.data]);
  const supportEvents = useMemo(
    () => events.filter((e) => SUPPORT_ACTIONS.has(e.action)),
    [events],
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Trail"
        subtitle="Every operator action, who opened whose support view, and every restaurant that has ever been deleted."
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "operator", label: "Operator actions" },
              { value: "support", label: "Support access" },
              { value: "deleted", label: "Deleted restaurants" },
            ]}
          />
        }
      />

      {tab === "operator" && (
        <Card className="p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
              Operator actions
            </h3>
            <span className="text-[11px] text-fg-faint">
              the most recent 100 operator actions — the server hard-limits this list
            </span>
          </div>
          <div className="mt-3">
            {auditQ.error ? (
              <div className="p-4">
                <ErrorCard error={auditQ.error} onRetry={auditQ.reload} />
              </div>
            ) : auditQ.loading ? (
              <Spinner />
            ) : (
              <EventTable
                rows={events}
                hotelName={nameOf}
                filterKey="cr.audit.operator"
                emptyTitle="No operator actions yet"
                emptyBody="Every platform.* action any operator takes shows up here."
              />
            )}
          </div>
        </Card>
      )}

      {tab === "support" && (
        <Card className="p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
              Support access
            </h3>
            <span className="text-[11px] text-fg-faint">
              every time an operator opened a support view or read a restaurant&apos;s AI chat
            </span>
          </div>
          <div className="mt-3">
            {auditQ.error ? (
              <div className="p-4">
                <ErrorCard error={auditQ.error} onRetry={auditQ.reload} />
              </div>
            ) : auditQ.loading ? (
              <Spinner />
            ) : (
              <EventTable
                rows={supportEvents}
                hotelName={nameOf}
                filterKey="cr.audit.support"
                emptyTitle="No support access recorded"
                emptyBody="Opening “View as” or a restaurant's AI transcript will appear here, under the operator's name."
              />
            )}
          </div>
        </Card>
      )}

      {tab === "deleted" && <DeletedHotels />}
    </div>
  );
}
