"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadFile, type AttendanceRow, type Employee } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { useHotelTime } from "@/lib/time";
import { can } from "@/lib/permissions";

const today = () => new Date().toISOString().slice(0, 10);

export default function AttendancePage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const { time: fmtTime, timeZone } = useHotelTime();
  const canWrite = can(user?.role, "attendance:write");

  const [day, setDay] = useState(today());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Record<string, AttendanceRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Manual edit / back-date (for missed punches)
  const [editEmp, setEditEmp] = useState<Employee | null>(null);
  const [ci, setCi] = useState("");
  const [co, setCo] = useState("");
  const [brk, setBrk] = useState("0");
  const [savingEdit, setSavingEdit] = useState(false);

  // UTC ISO -> "HH:MM" in the hotel's timezone (for prefilling the time inputs)
  const toHHMM = (iso: string | null | undefined): string =>
    iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }) : "";

  // Decimal hours → "12h 30m" (10.50 reads as ten-and-a-half hours, not 10:50)
  const fmtHours = (dec: string | number | null | undefined): string => {
    if (dec == null || dec === "") return "—";
    const n = typeof dec === "number" ? dec : parseFloat(dec);
    if (!isFinite(n)) return "—";
    const mins = Math.round(n * 60);
    return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
  };

  // Live preview for the edit dialog — the exact math the server will do:
  // (out − in, rolling past midnight) − break. No more surprise numbers.
  const previewMins = (() => {
    if (!ci || !co) return null;
    const [ih, im] = ci.split(":").map(Number);
    const [oh, om] = co.split(":").map(Number);
    let span = oh * 60 + om - (ih * 60 + im);
    if (span <= 0) span += 24 * 60; // clock-out after midnight
    return Math.max(0, span - (parseInt(brk || "0", 10) || 0));
  })();
  const previewOvernight = !!ci && !!co && co <= ci;

  const load = useCallback(async (d: string) => {
    const [emps, att] = await Promise.all([
      api.get<Employee[]>("/employees"),
      api.get<AttendanceRow[]>(`/attendance?on=${d}`),
    ]);
    setEmployees(emps);
    setRows(Object.fromEntries(att.map((r) => [r.employee_id, r])));
  }, []);

  useEffect(() => {
    load(day).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeDay(d: string) {
    setDay(d);
    setLoading(true);
    await load(d).finally(() => setLoading(false));
  }

  async function punch(employeeId: string, type: string) {
    setError(null);
    try {
      await api.post("/attendance/punch", { employee_id: employeeId, type });
      await load(day);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Punch failed");
    }
  }

  function openEdit(e: Employee) {
    const r = rows[e.id];
    setEditEmp(e);
    setCi(toHHMM(r?.clock_in));
    setCo(toHHMM(r?.clock_out));
    setBrk(String(r?.break_minutes ?? 0));
    setError(null);
  }

  async function saveEdit() {
    if (!editEmp) return;
    setSavingEdit(true);
    setError(null);
    try {
      await api.post("/attendance/edit", {
        employee_id: editEmp.id,
        date: day,
        clock_in: ci || null,
        clock_out: co || null,
        break_minutes: parseInt(brk || "0", 10),
      });
      setEditEmp(null);
      await load(day);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading) return <Spinner />;

  const isToday = day === today();
  const present = Object.values(rows).filter((r) => r.status === "PRESENT").length;
  const btn = "rounded border px-2 py-1 text-xs font-medium";

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Clock in → (break → resume) → clock out. Hours auto-calculate." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="date"
          value={day}
          onChange={(e) => changeDay(e.target.value)}
          className="rounded-lg border border-line-2 px-3 py-2 text-sm"
        />
        <span className="text-sm text-fg-faint">{present} present · {employees.length} staff</span>
        <span className="text-xs text-fg-faint">· times in {timeZone}</span>
        {!isToday && <span className="text-xs text-fg-faint">(punching only works for today)</span>}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => downloadFile(`/attendance/timesheet.pdf?on=${day}`, `timesheet-${day}.pdf`)}
            className="rounded-lg border border-line-2 px-3 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
          >
            ⬇ PDF
          </button>
          <button
            onClick={() => downloadFile(`/attendance/timesheet.xlsx?on=${day}`, `timesheet-${day}.xlsx`)}
            className="rounded-lg border border-line-2 px-3 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
          >
            ⬇ Excel
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                <th className="px-5 py-3 font-medium">Employee</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">In</th>
                <th className="px-5 py-3 font-medium">Out</th>
                <th className="px-5 py-3 text-right font-medium">Break</th>
                <th className="px-5 py-3 text-right font-medium">Hours</th>
                <th className="px-5 py-3 text-right font-medium">Penalty</th>
                {canWrite && <th className="px-5 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-fg-faint">No employees yet.</td></tr>
              ) : (
                employees.map((e) => {
                  const r = rows[e.id];
                  const clockedIn = !!r?.clock_in;
                  const clockedOut = !!r?.clock_out;
                  const onBreak = !!r?.on_break;
                  return (
                    <tr key={e.id} className="border-b border-line">
                      <td className="px-5 py-3 font-medium text-fg">{e.full_name}</td>
                      <td className="px-5 py-3">
                        {onBreak ? (
                          <Badge tone="amber">On break</Badge>
                        ) : clockedOut ? (
                          <Badge tone="slate">Clocked out</Badge>
                        ) : clockedIn ? (
                          <Badge tone="green">Working</Badge>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-fg-soft">{fmtTime(r?.clock_in ?? null)}</td>
                      <td className="px-5 py-3 text-fg-soft">{fmtTime(r?.clock_out ?? null)}</td>
                      <td className="px-5 py-3 text-right text-fg-soft">
                        {onBreak ? (
                          <span className="text-amber-400">on break…</span>
                        ) : r && r.break_minutes > 0 ? (
                          // always show a deducted break, even if it was set via Edit
                          `${r.break_minutes}m${r.over_break_minutes ? ` (+${r.over_break_minutes})` : ""}`
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-fg-soft" title={r?.working_hours ? `${r.working_hours} h (break already deducted)` : undefined}>
                        {fmtHours(r?.working_hours)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {r && parseFloat(r.break_penalty) > 0 ? (
                          <span className="text-rose-400">{format(r.break_penalty)}</span>
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </td>
                      {canWrite && (
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            {isToday && !clockedIn && (
                              <button onClick={() => punch(e.id, "CLOCK_IN")} className={`${btn} border-brand-400/30 bg-brand-400/10 text-brand-300`}>Clock in</button>
                            )}
                            {isToday && clockedIn && !clockedOut && !onBreak && (
                              <>
                                <button onClick={() => punch(e.id, "BREAK_START")} className={`${btn} border-amber-400/30 bg-amber-400/10 text-amber-300`}>Start break</button>
                                <button onClick={() => punch(e.id, "CLOCK_OUT")} className={`${btn} border-line-2 text-fg-soft`}>Clock out</button>
                              </>
                            )}
                            {isToday && clockedIn && !clockedOut && onBreak && (
                              <button onClick={() => punch(e.id, "BREAK_END")} className={`${btn} border-brand-400/30 bg-brand-400/10 text-brand-300`}>End break</button>
                            )}
                            <button onClick={() => openEdit(e)} className={`${btn} border-line text-fg-faint hover:bg-paper-2`} title="Manually set / fix times (works for past dates)">Edit</button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-4 text-xs text-fg-faint">
        Flow: <b>Clock in</b> → optionally <b>Start break</b> then <b>End break</b> → <b>Clock out</b>.
        Break time is subtracted from the day&apos;s working hours. Use <b>Edit</b> to fix or
        back-date a record if someone forgot to punch.
      </p>

      {editEmp && (
        <div className="mise-fade fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setEditEmp(null)}>
          <div className="mise-pop w-full max-w-sm rounded-2xl border border-glass/10 bg-paper-2/95 p-5 shadow-2xl shadow-black/50 backdrop-blur-xl" onClick={(ev) => ev.stopPropagation()}>
            <h3 className="font-semibold text-fg">Edit attendance</h3>
            <p className="mt-0.5 text-sm text-fg-faint">{editEmp.full_name} · {day} · times in {timeZone}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm text-fg-soft">Clock in
                <input type="time" value={ci} onChange={(ev) => setCi(ev.target.value)} className="mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm" />
              </label>
              <label className="text-sm text-fg-soft">Clock out
                <input type="time" value={co} onChange={(ev) => setCo(ev.target.value)} className="mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm" />
              </label>
              <label className="col-span-2 text-sm text-fg-soft">Break (minutes)
                <input type="number" min="0" value={brk} onChange={(ev) => setBrk(ev.target.value)} className="mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm" />
              </label>
              {previewMins !== null && (
                <p className="mise-well col-span-2 rounded-lg px-3 py-2 text-xs text-fg-soft">
                  {ci} → {co}{previewOvernight ? " (next day)" : ""} − {parseInt(brk || "0", 10) || 0}m break ={" "}
                  <b className="text-fg">{fmtHours(previewMins / 60)}</b>
                </p>
              )}
            </div>
            <p className="mt-2 text-xs text-fg-faint">Leave clock-in empty to mark the day absent.</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditEmp(null)} className="rounded-lg border border-line-2 px-3 py-1.5 text-sm text-fg-soft hover:bg-paper-2">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
