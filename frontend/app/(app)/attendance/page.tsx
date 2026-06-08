"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadFile, type AttendanceRow, type Employee } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const today = () => new Date().toISOString().slice(0, 10);

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AttendancePage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const canWrite = can(user?.role, "attendance:write");

  const [day, setDay] = useState(today());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Record<string, AttendanceRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="text-sm text-slate-500">{present} present · {employees.length} staff</span>
        {!isToday && <span className="text-xs text-slate-400">(punching only works for today)</span>}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => downloadFile(`/attendance/timesheet.pdf?on=${day}`, `timesheet-${day}.pdf`)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ⬇ PDF
          </button>
          <button
            onClick={() => downloadFile(`/attendance/timesheet.xlsx?on=${day}`, `timesheet-${day}.xlsx`)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ⬇ Excel
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-5 py-3 font-medium">Employee</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">In</th>
                <th className="px-5 py-3 font-medium">Out</th>
                <th className="px-5 py-3 text-right font-medium">Break</th>
                <th className="px-5 py-3 text-right font-medium">Hours</th>
                <th className="px-5 py-3 text-right font-medium">Penalty</th>
                {canWrite && isToday && <th className="px-5 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">No employees yet.</td></tr>
              ) : (
                employees.map((e) => {
                  const r = rows[e.id];
                  const clockedIn = !!r?.clock_in;
                  const clockedOut = !!r?.clock_out;
                  const onBreak = !!r?.on_break;
                  return (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="px-5 py-3 font-medium text-slate-800">{e.full_name}</td>
                      <td className="px-5 py-3">
                        {onBreak ? (
                          <Badge tone="amber">On break</Badge>
                        ) : clockedOut ? (
                          <Badge tone="slate">Clocked out</Badge>
                        ) : clockedIn ? (
                          <Badge tone="green">Working</Badge>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{fmtTime(r?.clock_in ?? null)}</td>
                      <td className="px-5 py-3 text-slate-600">{fmtTime(r?.clock_out ?? null)}</td>
                      <td className="px-5 py-3 text-right text-slate-600">
                        {r?.break_minutes
                          ? `${r.break_minutes}m${r.over_break_minutes ? ` (+${r.over_break_minutes})` : ""}`
                          : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">{r?.working_hours ?? "—"}</td>
                      <td className="px-5 py-3 text-right">
                        {r && parseFloat(r.break_penalty) > 0 ? (
                          <span className="text-rose-600">{format(r.break_penalty)}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      {canWrite && isToday && (
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1">
                            {!clockedIn && (
                              <button onClick={() => punch(e.id, "CLOCK_IN")} className={`${btn} border-brand-200 bg-brand-50 text-brand-700`}>Clock in</button>
                            )}
                            {clockedIn && !clockedOut && !onBreak && (
                              <>
                                <button onClick={() => punch(e.id, "BREAK_START")} className={`${btn} border-amber-200 bg-amber-50 text-amber-700`}>Start break</button>
                                <button onClick={() => punch(e.id, "CLOCK_OUT")} className={`${btn} border-slate-300 text-slate-700`}>Clock out</button>
                              </>
                            )}
                            {clockedIn && !clockedOut && onBreak && (
                              <button onClick={() => punch(e.id, "BREAK_END")} className={`${btn} border-brand-200 bg-brand-50 text-brand-700`}>End break</button>
                            )}
                            {clockedOut && <span className="text-xs text-slate-400">Done for today</span>}
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

      <p className="mt-4 text-xs text-slate-400">
        Flow: <b>Clock in</b> → optionally <b>Start break</b> then <b>End break</b> → <b>Clock out</b>.
        Break time is subtracted from the day&apos;s working hours.
      </p>
    </div>
  );
}
