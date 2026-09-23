"use client";

// Putting a restaurant's data back.
//
//     "even if they accidnlty deleted by clickng if they need there datas back
//      we need a feature in control center to revert back they datas to old"
//
// THIS IS WHAT MAKES THE WIPE ALLOWABLE. An owner can empty their own
// restaurant from Settings; only the Control Room can fill it again. Without
// this screen that button is a trap with a confirmation dialog in front of it,
// which is why the two shipped together.
//
// It lists what we actually hold rather than asking anyone to remember a key,
// because the person using this is on the phone to somebody whose restaurant
// just went blank.

import { useState } from "react";
import { api, ApiError } from "@/lib/api";

type Snapshot = {
  key: string;
  taken_at: string;
  bytes: number;
  /** "wipe" — they emptied it themselves. "delete" — we removed the whole thing. */
  kind: string;
};

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function RestoreHotel({
  hotelId,
  hotelName,
  handle,
}: {
  hotelId: string;
  hotelName: string;
  handle: string | null;
}) {
  const [list, setList] = useState<Snapshot[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, number> | null>(null);

  const expected = (handle || hotelId).trim().toLowerCase();

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.get<{ snapshots: Snapshot[] }>(
        `/platform/hotels/${hotelId}/snapshots`,
      );
      setList(r.snapshots);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not list the snapshots.");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ restored: Record<string, number> }>(
        `/platform/hotels/${hotelId}/restore`,
        { key: picked, confirm_handle: typed },
      );
      setDone(r.restored);
      setPicked(null);
      setTyped("");
    } catch (e) {
      // A refused restore changed nothing, which is the point — so the message
      // is the whole story and there is nothing to clean up.
      setError(e instanceof ApiError ? e.message : "Nothing was restored.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const total = Object.values(done).reduce((a, b) => a + b, 0);
    return (
      <div className="mise-feel rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] p-5">
        <h3 className="font-semibold text-fg">{hotelName} is back</h3>
        <p className="mt-1 text-sm text-fg-soft">
          {total.toLocaleString()} records restored across {Object.keys(done).length} tables.
        </p>
        <ul className="mt-3 grid gap-1 text-xs text-fg-faint sm:grid-cols-2">
          {Object.entries(done)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([table, n]) => (
              <li key={table} className="flex justify-between gap-3">
                <span className="truncate">{table}</span>
                <span className="tabular-nums">{n.toLocaleString()}</span>
              </li>
            ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="mise-feel rounded-2xl border border-line bg-paper-2/40 p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span aria-hidden className="text-lg">
          ⏪
        </span>
        <h3 className="font-semibold text-fg">Put their data back</h3>
        <span className="text-xs text-fg-faint">from a snapshot taken before a delete</span>
      </div>

      <p className="mt-2 max-w-prose text-sm leading-relaxed text-fg-soft">
        A copy is saved automatically before anything is deleted. This restores one of
        those copies into {hotelName}.
      </p>
      {/* Said up front rather than discovered as an error, because the operator
          is usually on the phone while they read this. */}
      <p className="mt-2 max-w-prose rounded-xl border border-line bg-paper-2/60 px-3 py-2 text-xs leading-relaxed text-fg-soft">
        The restaurant has to be <b className="text-fg">empty</b> first. Restoring on top of
        live data would give them two of everything with no way to tell them apart, so it
        is refused rather than merged.
      </p>

      {list === null ? (
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="mise-press mt-4 rounded-xl border border-line-2 px-4 py-2.5 text-sm font-medium text-fg-soft disabled:opacity-40"
        >
          {busy ? "Looking…" : "Show what we have"}
        </button>
      ) : list.length === 0 ? (
        <p className="mt-4 text-sm text-fg-faint">
          No snapshots for this restaurant. Nothing has been deleted from it.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          {list.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                setPicked(s.key === picked ? null : s.key);
                setError(null);
              }}
              className={`mise-press flex w-full flex-wrap items-baseline justify-between gap-2 rounded-xl border px-3 py-2.5 text-left ${
                picked === s.key ? "border-brand-400 bg-brand-400/[0.07]" : "border-line"
              }`}
            >
              <span className="text-sm font-medium text-fg">{when(s.taken_at)}</span>
              <span className="text-xs text-fg-faint">
                {s.kind === "wipe" ? "they emptied it" : "we deleted it"} · {size(s.bytes)}
              </span>
            </button>
          ))}
        </div>
      )}

      {picked && (
        <div className="mise-pop mt-4 max-w-sm space-y-3 rounded-xl border border-line bg-paper-2/60 p-4">
          <div>
            <label className="block text-xs font-medium text-fg-soft">
              Type <b className="text-fg">{expected}</b> to confirm
            </label>
            {/* Restoring into the WRONG restaurant is the worst thing this
                screen could do. The server checks the snapshot's own hotel_id
                too — this is the half that catches picking the wrong row. */}
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoFocus
              placeholder={expected}
              className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            />
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={restore}
              disabled={busy || typed.trim().toLowerCase() !== expected}
              className="mise-press flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Restoring…" : "Restore this snapshot"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setTyped("");
                setError(null);
              }}
              className="rounded-xl px-4 py-2.5 text-sm text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && !picked && <p className="mt-3 text-xs text-rose-400">{error}</p>}
    </div>
  );
}
