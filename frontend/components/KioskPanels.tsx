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
import { api } from "@/lib/api";

type Shift = {
  id: string;
  employee_id: string;
  starts_at?: string | null;
  ends_at?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  role?: string | null;
};
type LeaveRow = {
  employee_name?: string;
  employee?: { full_name?: string };
  full_name?: string;
  leave_type?: string;
  type?: string;
  starts_on?: string;
  ends_on?: string;
};

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Trim a stored time to something readable from ten feet away. */
function hhmm(v?: string | null): string {
  if (!v) return "";
  const m = /(\d{1,2}):(\d{2})/.exec(v);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

export function KioskPanel({
  kind,
  names,
  onClose,
}: {
  kind: "rota" | "leave";
  /** employee id → name, so the rota does not have to fetch people again. */
  names: Record<string, string>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<{ who: string; detail: string }[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const on = todayISO();
    try {
      if (kind === "rota") {
        const shifts = await api.get<Shift[]>(`/rota/shifts?date_from=${on}&date_to=${on}`);
        setRows(
          shifts.map((s) => {
            const from = hhmm(s.start_time ?? s.starts_at);
            const to = hhmm(s.end_time ?? s.ends_at);
            return {
              who: names[s.employee_id] ?? "—",
              detail: from && to ? `${from} – ${to}` : from || "on today",
            };
          }),
        );
      } else {
        const leave = await api.get<LeaveRow[]>(`/employees/leave/list?date_from=${on}&date_to=${on}`);
        setRows(
          leave.map((l) => ({
            who: l.employee_name ?? l.employee?.full_name ?? l.full_name ?? "—",
            detail: (l.leave_type ?? l.type ?? "off").toLowerCase(),
          })),
        );
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [kind, names]);

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
          <p className="py-20 text-center text-2xl text-fg-faint">Could not reach DineAI.</p>
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
