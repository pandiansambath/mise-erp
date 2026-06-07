"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type AttendanceRow, type Employee } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const today = () => new Date().toISOString().slice(0, 10);

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const statusTone: Record<string, "green" | "red" | "amber" | "slate"> = {
  PRESENT: "green",
  ABSENT: "red",
  HALF_DAY: "amber",
  LEAVE: "slate",
};

export default function AttendancePage() {
  const { user } = useAuth();
  const canWrite = can(user?.role, "attendance:write");

  const [day, setDay] = useState(today());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Record<string, AttendanceRow>>({});
  const [loading, setLoading] = useState(true);

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
    await api.post("/attendance/punch", { employee_id: employeeId, type });
    await load(day);
  }

  if (loading) return <Spinner />;

  const isToday = day === today();
  const present = Object.values(rows).filter((r) => r.status === "PRESENT").length;

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Clock in/out, breaks, and daily presence." />

      <div className="mb-6 flex items-center gap-3">
        <input
          type="date"
          value={day}
          onChange={(e) => changeDay(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <span className="text-sm text-slate-500">
          {present} present · {employees.length} staff
        </span>
      </div>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-5 py-3 font-medium">Employee</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">In</th>
                <th className="px-5 py-3 font-medium">Out</th>
                <th className="px-5 py-3 text-right font-medium">Hours</th>
                {canWrite && isToday && <th className="px-5 py-3 font-medium">Punch</th>}
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No employees yet.</td></tr>
              ) : (
                employees.map((e) => {
                  const r = rows[e.id];
                  return (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="px-5 py-3 font-medium text-slate-800">{e.full_name}</td>
                      <td className="px-5 py-3">
                        {r ? <Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge> : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-600">{fmtTime(r?.clock_in ?? null)}</td>
                      <td className="px-5 py-3 text-slate-600">{fmtTime(r?.clock_out ?? null)}</td>
                      <td className="px-5 py-3 text-right text-slate-700">{r?.working_hours ?? "—"}</td>
                      {canWrite && isToday && (
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-1">
                            {!r?.clock_in && (
                              <button onClick={() => punch(e.id, "CLOCK_IN")} className="rounded border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">In</button>
                            )}
                            {r?.clock_in && !r?.clock_out && (
                              <>
                                <button onClick={() => punch(e.id, "BREAK_START")} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">Break</button>
                                <button onClick={() => punch(e.id, "BREAK_END")} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">Resume</button>
                                <button onClick={() => punch(e.id, "CLOCK_OUT")} className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700">Out</button>
                              </>
                            )}
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
    </div>
  );
}
