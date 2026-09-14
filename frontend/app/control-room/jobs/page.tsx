"use client";

// /control-room/jobs — the job board, moderated. Fixes: the remove action
// used to fire straight from the button; it now goes through useConfirm like
// every other destructive action in this area.

import { useMemo, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { useConfirm } from "@/components/confirm";
import { Card, PageHeader, Spinner } from "@/components/ui";
import { Pager, applyFilter, pageOf, useListFilter } from "@/components/ListControls";

type Row = {
  id: string;
  hotel_name: string;
  title: string;
  status: string;
  employment_type: string;
  location: string | null;
  created_at: string;
  applications: number;
};

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

export default function JobBoardPage() {
  const listQ = useOperatorQuery<{ postings: Row[] }>("/platform/jobs");
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actErr, setActErr] = useState<string | null>(null);
  const [f, setF] = useListFilter("cr.jobs");

  const rows = useMemo(() => listQ.data?.postings ?? [], [listQ.data]);
  const filtered = useMemo(
    () =>
      applyFilter(rows, f, (r) => ({
        text: `${r.title} ${r.hotel_name} ${r.location ?? ""}`,
        status: r.status === "OPEN" ? "open" : "closed",
        date: r.created_at,
        value: r.applications,
      })),
    [rows, f],
  );
  const shown = pageOf(filtered, f);
  const openCount = rows.filter((r) => r.status === "OPEN").length;

  async function setStatus(row: Row, status: string) {
    setBusyId(row.id);
    setActErr(null);
    try {
      await api.patch(`/platform/jobs/${row.id}`, { status });
      listQ.reload();
    } catch (err) {
      setActErr(err instanceof ApiError ? err.message : "Could not update that posting.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: Row) {
    const ok = await confirm({
      title: `Remove "${row.title}"?`,
      message: `This takes it off the public careers board at ${row.hotel_name} immediately. It cannot be undone.`,
      confirmText: "Remove posting",
      tone: "danger",
    });
    if (!ok) return;
    setBusyId(row.id);
    setActErr(null);
    try {
      await api.delete(`/platform/jobs/${row.id}`);
      listQ.reload();
    } catch (err) {
      setActErr(err instanceof ApiError ? err.message : "Could not remove that posting.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Job board"
        subtitle="Every vacancy on the public /careers board across the fleet — close or remove anything, all audited."
      />

      <Card className="p-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
            Postings
          </h3>
          <span className="font-mono text-[11px] tabular-nums text-fg-faint">
            {openCount} open · {rows.length - openCount} closed
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-y border-line px-4 py-2.5">
          <input
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value, page: 1 })}
            placeholder="Search by title, restaurant or location…"
            className="mise-well w-full max-w-sm rounded-xl px-3 py-2 text-sm outline-none"
          />
          {(["all", "open", "closed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setF({ ...f, status: s, page: 1 })}
              className={`mise-press rounded-full px-3 py-1.5 text-xs font-medium transition ${
                f.status === s ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {actErr && (
          <p className="px-4 pt-2 text-xs font-medium text-danger">{actErr}</p>
        )}

        {listQ.error ? (
          <div className="p-4">
            <ErrorCard error={listQ.error} onRetry={listQ.reload} />
          </div>
        ) : listQ.loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center">
            <p className="font-display text-lg font-semibold text-fg">No postings anywhere yet</p>
            <p className="mt-1.5 max-w-sm text-sm text-fg-faint">
              Vacancies posted from any restaurant&apos;s hiring page show up here.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="mise-stack w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                    <th className="px-4 py-2.5">Posting</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Applicants</th>
                    <th className="px-3 py-2.5">Posted</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="group border-b border-line/60 transition hover:bg-glass/[0.04]">
                      <td data-label="Posting" className="relative py-2.5 pl-4 pr-3">
                        <span
                          aria-hidden
                          className={`absolute inset-y-0 left-0 w-1 ${r.status === "OPEN" ? "bg-emerald-400/60" : "bg-fg-faint/25"}`}
                        />
                        <span className="block truncate text-sm font-semibold text-fg">{r.title}</span>
                        <span className="block truncate font-mono text-[11px] text-fg-faint">
                          {r.hotel_name}
                          {r.location ? ` · ${r.location}` : ""}
                        </span>
                      </td>
                      <td data-label="Status" className="px-3 py-2.5">
                        <span className="mise-chip" data-tone={r.status === "OPEN" ? "green" : "slate"}>
                          {r.status.toLowerCase()}
                        </span>
                      </td>
                      <td data-label="Applicants" className="px-3 py-2.5 text-right font-mono text-xs tabular-nums text-fg-soft">
                        {r.applications}
                      </td>
                      <td data-label="Posted" className="px-3 py-2.5 font-mono text-xs text-fg-soft">
                        {new Date(r.created_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => setStatus(r, r.status === "OPEN" ? "CLOSED" : "OPEN")}
                            className="mise-btn-flat mise-press px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                          >
                            {r.status === "OPEN" ? "Close" : "Reopen"}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => remove(r)}
                            data-tone="danger"
                            className="mise-btn-flat mise-press px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
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
