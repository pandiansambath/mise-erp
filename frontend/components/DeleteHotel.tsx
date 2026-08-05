"use client";

// Permanently deleting a restaurant.
//
// The most destructive button in the product, so the flow is built to slow the
// operator down at exactly the moment they are least likely to be thinking:
//
//   1. It is not on the page. You open it deliberately.
//   2. It counts what will be destroyed FIRST. "Delete Milagu?" is a question
//      nobody can answer well; "delete 61 items, 1,204 sales lines and 38
//      payslips?" is.
//   3. You type the handle. Not a checkbox — a checkbox is muscle memory,
//      typing a name is a decision.
//   4. The server archives everything to S3 before removing a row, and refuses
//      to delete at all if that archive fails.

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type Preview = {
  hotel_name: string;
  handle: string | null;
  counts: Record<string, number>;
  total_rows: number;
};

export function DeleteHotel({
  hotelId,
  hotelName,
  handle,
  onDeleted,
}: {
  hotelId: string;
  hotelName: string;
  handle: string | null;
  onDeleted: () => void;
}) {
  const [stage, setStage] = useState<"idle" | "preview" | "typing">("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expected = (handle ?? hotelId).toLowerCase();

  async function openPreview() {
    // Open the panel FIRST, then fetch into it.
    //
    // It used to wait for the round trip before anything on screen changed, so
    // a slow reply looked exactly like a dead button — "I clicked, nothing
    // happened, clicked again, nothing" until one of them appeared to work.
    // Nothing was wrong with the click; the interface simply said nothing for
    // a second or two.
    setStage("preview");
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.get<Preview>(`/platform/hotels/${hotelId}/deletion-preview`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not read this hotel.");
      setStage("idle");
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/platform/hotels/${hotelId}/delete`, {
        confirm_handle: typed,
        reason: reason.trim() || null,
      });
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not delete this hotel.");
      setBusy(false);
    }
  }

  if (stage === "idle") {
    return (
      <div className="mt-4 border-t border-line pt-3">
        <button
          type="button"
          onClick={openPreview}
          disabled={busy}
          className="mise-press w-full rounded-xl border border-rose-500/30 px-3 py-2.5 text-sm font-medium text-rose-300 transition hover:border-rose-500/60 hover:bg-rose-500/10 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Permanently delete this restaurant"}
        </button>
        {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
      </div>
    );
  }

  const rows = Object.entries(preview?.counts ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mise-pop mt-4 rounded-xl border border-rose-500/40 bg-rose-500/[0.06] p-4">
      <h4 className="text-sm font-semibold text-rose-300">
        Permanently delete {hotelName}
      </h4>

      {stage === "preview" && busy && (
        <p className="mt-2 text-xs text-fg-soft">Counting what would be destroyed…</p>
      )}

      {stage === "preview" && !busy && (
        <>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-soft">
            This removes <b className="text-fg">{preview?.total_rows ?? 0}</b> records and cannot
            be undone from the app. Everything is archived to S3 first — if that archive fails,
            nothing is deleted.
          </p>
          {rows.length > 0 && (
            <div className="mt-3 max-h-40 overflow-y-auto rounded-lg border border-line bg-paper-2/40 p-2">
              <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                {rows.map(([table, n]) => (
                  <li key={table} className="flex justify-between gap-2">
                    <span className="truncate text-fg-faint">{table.replace(/_/g, " ")}</span>
                    <span className="tabular-nums text-fg-soft">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setStage("typing")}
              className="mise-press rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300"
            >
              I understand — continue
            </button>
            <button
              type="button"
              onClick={() => { setStage("idle"); setPreview(null); }}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {stage === "typing" && (
        <>
          <p className="mt-1.5 text-xs leading-relaxed text-fg-soft">
            Type <b className="font-mono text-rose-300">{expected}</b> to confirm. This destroys{" "}
            <b className="text-fg">{preview?.total_rows ?? 0}</b> records belonging to a real
            business.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus
            spellCheck={false}
            placeholder={expected}
            className="mise-well mt-2 w-full rounded-lg px-3 py-2 font-mono text-sm outline-none"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why (recorded in the log)"
            className="mise-well mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
          />
          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={destroy}
              // Only when it matches EXACTLY. Anything looser and a stray Enter
              // could delete a restaurant.
              disabled={busy || typed.trim().toLowerCase() !== expected}
              className="mise-press rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Deleting…" : `Delete ${hotelName} for ever`}
            </button>
            <button
              type="button"
              onClick={() => { setStage("idle"); setTyped(""); setError(null); }}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
