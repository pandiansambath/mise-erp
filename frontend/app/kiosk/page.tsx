"use client";

// The attendance tablet.
//
// A screen on the wall by the door. Staff walk up, find their name, tap it,
// and walk away. It is the only thing this login can reach.
//
// Everything here is shaped by the fact that it is a SHARED, UNATTENDED
// screen in a working kitchen:
//
// **Big targets, no chrome.** No sidebar, no menus, no settings — nothing to
// wander into. Tiles are large because they are tapped by people carrying
// things, sometimes with wet hands.
//
// **It says what happened and then forgets.** A confirmation shows for a few
// seconds and clears itself, so the next person does not walk up to somebody
// else's name still highlighted on the screen.
//
// **It shows no money.** Not wages, not sales, not hours totalled into pay.
// The permission set makes that true; the design does not tempt anyone to
// widen it.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, clearToken, type AttendanceRow, type Employee } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHotelTime } from "@/lib/time";

const today = () => new Date().toISOString().slice(0, 10);

export default function KioskPage() {
  const { user, hotel, loading } = useAuth();
  const { time: fmtTime } = useHotelTime();
  const [staff, setStaff] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Record<string, AttendanceRow>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ name: string; what: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // A clock people can read from across the room is half of why a device like
  // this earns its place on the wall.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      const [people, attendance] = await Promise.all([
        api.get<Employee[]>("/employees"),
        api.get<AttendanceRow[]>(`/attendance?on=${today()}`),
      ]);
      setStaff(people.filter((p) => p.is_active));
      setRows(Object.fromEntries(attendance.map((r) => [r.employee_id, r])));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not reach DineAI.");
    }
  }, []);

  useEffect(() => {
    if (loading || !user) return;
    load();
    // Somebody else may clock in from the office. A quiet refresh keeps the
    // wall screen honest without anyone touching it.
    const t = window.setInterval(load, 30_000);
    return () => window.clearInterval(t);
  }, [loading, user, load]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(t);
  }, [flash]);

  async function punch(emp: Employee, action: string, label: string) {
    setBusy(emp.id);
    setError(null);
    try {
      await api.post("/attendance/punch", { employee_id: emp.id, type: action });
      setFlash({ name: emp.full_name, what: label });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not go through.");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    if (loading) return;
    if (!user) window.location.assign("/login");
  }, [loading, user]);

  if (loading || !user) {
    return <div className="grid min-h-dvh place-items-center bg-shell text-fg-faint">…</div>;
  }

  return (
    <div className="mise-app min-h-dvh bg-shell text-fg" data-mode="dark">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-6 py-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-semibold">
            {hotel?.name ?? "Attendance"}
          </h1>
          <p className="text-xs text-fg-faint">Tap your name to clock in or out</p>
        </div>
        <p className="font-display text-3xl font-semibold tabular-nums">
          {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </header>

      {/* One line, large, then gone. The next person up should not be looking
          at somebody else's confirmation. */}
      {flash && (
        <p className="mise-pop mx-6 mt-4 rounded-2xl border border-brand-400/40 bg-brand-400/10 px-5 py-3 text-center text-lg font-semibold text-brand-200">
          {flash.name} — {flash.what}
        </p>
      )}
      {error && (
        <p className="mx-6 mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-3 text-center text-sm text-rose-200">
          {error}
        </p>
      )}

      <main className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-4">
        {staff.length === 0 && (
          <p className="col-span-full py-16 text-center text-sm text-fg-faint">
            No active staff yet.
          </p>
        )}
        {staff.map((emp) => {
          const r = rows[emp.id];
          const inNow = !!r?.clock_in && !r?.clock_out;
          const onBreak = !!r?.on_break;
          const done = !!r?.clock_out;
          return (
            <div
              key={emp.id}
              className={`rounded-2xl border p-4 transition ${
                onBreak
                  ? "border-amber-400/40 bg-amber-400/[0.08]"
                  : inNow
                    ? "border-brand-400/40 bg-brand-400/[0.08]"
                    : done
                      ? "border-line bg-glass/[0.03] opacity-70"
                      : "border-line bg-glass/5"
              }`}
            >
              <p className="truncate font-display text-base font-semibold">{emp.full_name}</p>
              <p className="mt-0.5 text-[11px] text-fg-faint">
                {done
                  ? `finished ${fmtTime(r?.clock_out ?? null)}`
                  : onBreak
                    ? "on break"
                    : inNow
                      ? `in since ${fmtTime(r?.clock_in ?? null)}`
                      : "not in yet"}
              </p>

              {/* One obvious action, sized for a thumb. Anything cleverer is a
                  thing to get wrong while somebody waits behind you. */}
              <div className="mt-3 grid gap-2">
                {!inNow && !onBreak && !done && (
                  <button
                    type="button"
                    disabled={busy === emp.id}
                    onClick={() => punch(emp, "CLOCK_IN", "clocked in")}
                    className="mise-press rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    Clock in
                  </button>
                )}
                {inNow && !onBreak && (
                  <>
                    <button
                      type="button"
                      disabled={busy === emp.id}
                      onClick={() => punch(emp, "BREAK_START", "on break")}
                      className="mise-press rounded-xl border border-amber-400/40 bg-amber-400/10 py-2.5 text-sm font-medium text-amber-200 disabled:opacity-50"
                    >
                      Start break
                    </button>
                    <button
                      type="button"
                      disabled={busy === emp.id}
                      onClick={() => punch(emp, "CLOCK_OUT", "clocked out")}
                      className="mise-press rounded-xl border border-line-2 py-2.5 text-sm font-medium text-fg-soft disabled:opacity-50"
                    >
                      Clock out
                    </button>
                  </>
                )}
                {onBreak && (
                  <button
                    type="button"
                    disabled={busy === emp.id}
                    onClick={() => punch(emp, "BREAK_END", "back from break")}
                    className="mise-press rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    End break
                  </button>
                )}
                {done && (
                  <p className="py-2 text-center text-xs text-fg-faint">done for today</p>
                )}
              </div>
            </div>
          );
        })}
      </main>

      {/* Deliberately small and at the very bottom. Signing the tablet out is
          something a manager does at closing, not something anyone should find
          by accident mid-service. */}
      <footer className="border-t border-line px-6 py-4 text-center">
        <button
          type="button"
          onClick={() => {
            clearToken();
            window.location.assign("/login");
          }}
          className="text-[11px] text-fg-faint underline-offset-4 hover:underline"
        >
          Sign this tablet out
        </button>
      </footer>
    </div>
  );
}
