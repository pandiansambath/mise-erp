"use client";

// What was deleted, by whom, and why.
//
// The one record that has to outlive the restaurant. It cannot live in the
// hotel's own audit log, because deleting a hotel empties that log — the note
// would be destroyed by the act it was recording. So it has its own table with
// no foreign key to anything that can disappear.
//
// It carries the questions somebody actually asks three months later: what was
// it called, where was it, who removed it, why, how much went, and where the
// archive lives. That last one matters most: "everything is archived first" is
// only a promise if the key is written down.

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Row = {
  id: string;
  hotel_name: string;
  handle: string | null;
  where: string;
  plan: string | null;
  deleted_by: string;
  reason: string | null;
  archive_key: string | null;
  total_rows: number;
  removed: Record<string, number>;
  deleted_at: string | null;
};

export function DeletedHotels() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Row[]>("/platform/deleted-hotels")
      .then(setRows)
      .catch(() => setRows([]));
  }, []);

  if (!rows) return null;

  return (
    <section
      id="cr-deleted"
      className="mise-feel mb-6 scroll-mt-24 rounded-2xl border border-rose-500/25 bg-rose-500/[0.04] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-fg">🗑 Deleted restaurants</h3>
        <span className="text-xs text-fg-faint">
          {rows.length === 0 ? "none yet" : `${rows.length} on record · kept for ever`}
        </span>
      </div>
      <p className="mt-1 text-xs text-fg-faint">
        The only surviving trace once the rows are gone — including where the S3 archive
        went, so the &ldquo;archived first&rdquo; promise can still be checked.
      </p>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-faint">
          No restaurant has ever been permanently deleted.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map((r) => {
            const open = openId === r.id;
            const counts = Object.entries(r.removed ?? {}).sort((a, b) => b[1] - a[1]);
            return (
              <li key={r.id} className="rounded-xl border border-line bg-paper-2/50 p-3">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 text-left"
                >
                  <span className="font-medium text-fg">{r.hotel_name}</span>
                  {r.handle && (
                    <span className="font-mono text-[11px] text-fg-faint">@{r.handle}</span>
                  )}
                  {r.where && <span className="text-xs text-fg-faint">· {r.where}</span>}
                  {r.plan && (
                    <span className="rounded-full bg-glass/10 px-2 py-0.5 text-[10px] uppercase text-fg-soft">
                      {r.plan}
                    </span>
                  )}
                  <span className="flex-1" />
                  <span className="text-xs tabular-nums text-rose-300">
                    {r.total_rows} records
                  </span>
                  <span aria-hidden className={`text-fg-faint transition ${open ? "rotate-90" : ""}`}>
                    ›
                  </span>
                </button>

                <p className="mt-1 text-[11px] text-fg-faint">
                  {r.deleted_at ? new Date(r.deleted_at).toLocaleString() : "—"} · by{" "}
                  <b className="text-fg-soft">{r.deleted_by || "unknown"}</b>
                </p>
                {r.reason && (
                  <p className="mt-1 text-xs italic text-fg-soft">&ldquo;{r.reason}&rdquo;</p>
                )}

                {open && (
                  <div className="mise-pop mt-3 border-t border-line pt-3">
                    {r.archive_key ? (
                      <p className="break-all font-mono text-[10px] text-fg-faint">
                        archive · {r.archive_key}
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-300">
                        No archive key recorded for this one.
                      </p>
                    )}
                    {counts.length > 0 && (
                      <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-3">
                        {counts.map(([table, n]) => (
                          <li key={table} className="flex justify-between gap-2">
                            <span className="truncate text-fg-faint">
                              {table.replace(/_/g, " ")}
                            </span>
                            <span className="tabular-nums text-fg-soft">{n}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** How long a "View as" key should live. The operator's call, within limits. */
export function SupportWindowPicker() {
  const [mins, setMins] = useState(15);

  useEffect(() => {
    const raw = Number(localStorage.getItem("mise.imp.minutes") || 15);
    setMins(Number.isFinite(raw) ? raw : 15);
  }, []);

  return (
    <label className="flex items-center gap-2 text-xs text-fg-faint">
      <span>View-as key lasts</span>
      <select
        value={mins}
        onChange={(e) => {
          const v = Number(e.target.value);
          setMins(v);
          try {
            localStorage.setItem("mise.imp.minutes", String(v));
          } catch {
            /* private mode */
          }
        }}
        className="mise-well rounded-lg px-2 py-1 text-xs text-fg outline-none"
      >
        {[5, 15, 30, 60, 120].map((m) => (
          <option key={m} value={m}>
            {m < 60 ? `${m} min` : `${m / 60} hour${m > 60 ? "s" : ""}`}
          </option>
        ))}
      </select>
      {/* The ceiling is enforced on the server too: a read-only key into
          somebody's business should not outlive an afternoon, however the
          operator feels about it. */}
    </label>
  );
}
