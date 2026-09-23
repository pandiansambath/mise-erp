"use client";

// Today's rota and today's leave, on the wall.
//
// Both are OFF unless the owner turned them on when they set the PIN — a
// screen by the door is read by everyone who walks past, and who is off today
// is more than some kitchens want on display.
//
// The type is the whole design. This is read from across a kitchen by someone
// carrying a tray, so it is set enormous and it SHRINKS to fit rather than
// wrapping into a paragraph: `clamp()` on the font size with the column count
// falling as names get longer. A wall screen that needs walking up to has
// failed at the one thing it is for.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

/** One line on the wall: a name, and the one detail beside it. */
type Row = { who: string; detail: string };
/** `null` for a section the owner switched off — decided by the server. */
type Board = { rota: Row[] | null; leave: Row[] | null };

export function KioskPanel({
  kind,
  onClose,
}: {
  kind: "rota" | "leave";
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // ⚠️ ONE ENDPOINT, AND ONE THE KIOSK MAY ACTUALLY CALL.
  //
  // This used to ask `/rota/shifts` and `/employees/leave/list` directly.
  // Both are gated on `employees:read` — which the kiosk deliberately does
  // NOT hold, because that permission carries salary, NI number and bank
  // details, and this tablet is unlocked by a door PIN. So both panels
  // answered 403 on every open, and the catch below reported it as
  // "Could not reach DineAI." Built, and unreachable by its own credential.
  const load = useCallback(async () => {
    try {
      const board = await api.get<Board>("/attendance/kiosk-board");
      setRows(board[kind] ?? []);
      setFailed(null);
    } catch (e) {
      // SAY WHAT THE SERVER SAID. A refusal told as a network failure sends
      // everybody — me included — looking at the wrong thing for an hour.
      setFailed(e instanceof ApiError ? e.message : "Could not reach DineAI.");
    }
  }, [kind]);

  useEffect(() => {
    load();
    // The office may add a shift mid-service; the wall should not be stale.
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const title = kind === "rota" ? "On today" : "Off today";
  const count = rows?.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-shell/97 backdrop-blur-xl">
      <header className="flex shrink-0 items-center justify-between gap-4 px-8 pt-8">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-fg-faint">
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h2 className="mt-1 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            {title}
            {rows && <span className="ml-3 text-2xl font-normal text-fg-faint">{count}</span>}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="mise-press grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-line-2 text-2xl text-fg-soft"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 pt-6">
        {failed ? (
          <p className="py-20 text-center text-2xl text-fg-faint">{failed}</p>
        ) : rows === null ? (
          <p className="py-20 text-center text-2xl text-fg-faint">…</p>
        ) : rows.length === 0 ? (
          <p className="py-20 text-center text-3xl text-fg-faint">
            {kind === "rota" ? "Nobody is scheduled today." : "Nobody is off today."}
          </p>
        ) : (
          // Fewer columns as the list shortens, so four people do not become
          // four postage stamps in the corner of a large screen.
          <ul
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${count <= 3 ? 1 : count <= 8 ? 2 : 3}, minmax(0, 1fr))`,
            }}
          >
            {rows.map((r, i) => (
              <li
                key={`${r.who}-${i}`}
                className="mise-neo-raised flex items-baseline justify-between gap-4 rounded-2xl px-6 py-5"
              >
                {/* clamp(): big by default, and it gives ground only when the
                    name is long enough to need it. */}
                <span
                  className="min-w-0 flex-1 truncate font-display font-semibold"
                  style={{ fontSize: "clamp(1.5rem, 3.4vw, 2.6rem)" }}
                >
                  {r.who}
                </span>
                <span
                  className="shrink-0 font-mono tabular-nums text-brand-300"
                  style={{ fontSize: "clamp(1rem, 1.9vw, 1.6rem)" }}
                >
                  {r.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Who is in, who is on break, who has finished — the counters, opened.
 *
 *  "0 in now / 0 on break / 0 finished" were labels. His law: every click must
 *  have a meaning, so a number on a wall screen that cannot tell you WHICH
 *  three people is a number doing half its job.
 *
 *  Same enormous, shrink-to-fit type as the rota, because it is read from the
 *  same distance by the same person carrying the same tray. The data is already
 *  on the page, so this opens instantly and never waits on the network.
 */
export function KioskWho({
  title,
  rows,
  onClose,
}: {
  title: string;
  rows: { who: string; detail: string }[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const longest = rows.reduce((n, r) => Math.max(n, r.who.length), 0);
  const cols = rows.length <= 3 ? 1 : longest > 14 ? 2 : 3;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-shell/97 backdrop-blur-xl">
      <header className="flex shrink-0 items-center justify-between gap-4 px-8 pt-8">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-fg-faint">
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </p>
          <h2 className="mt-1 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            {title}
            <span className="ml-3 text-2xl font-normal text-fg-faint">{rows.length}</span>
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="mise-press grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-line-2 text-2xl text-fg-soft"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8 pt-6">
        {rows.length === 0 ? (
          <p className="py-20 text-center text-3xl text-fg-faint">Nobody yet.</p>
        ) : (
          <ul
            className="grid gap-x-10 gap-y-4"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {rows.map((r) => (
              <li key={r.who} className="flex items-baseline justify-between gap-4 border-b border-line pb-3">
                <span
                  className="min-w-0 truncate font-display font-semibold tracking-tight"
                  style={{ fontSize: "clamp(1.5rem, 3.2vw, 3rem)" }}
                >
                  {r.who}
                </span>
                <span
                  className="shrink-0 tabular-nums text-fg-faint"
                  style={{ fontSize: "clamp(1rem, 1.6vw, 1.6rem)" }}
                >
                  {r.detail}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
