"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Employee, type LabourSummary, type Shift } from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const off = (x.getDay() + 6) % 7; // 0=Mon … 6=Sun
  x.setDate(x.getDate() - off);
  x.setHours(0, 0, 0, 0);
  return x;
}
const hhmm = (t: string) => t.slice(0, 5);

export default function RotaPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const canWrite = can(user?.role, "employees:write");

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const weekDates = useMemo(
    () => DAYS.map((_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }),
    [weekStart],
  );
  const from = iso(weekDates[0]);
  const to = iso(weekDates[6]);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [labour, setLabour] = useState<LabourSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // add-shift form
  const [emp, setEmp] = useState("");
  const [day, setDay] = useState(from);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [busy, setBusy] = useState(false);

  function reload() {
    return Promise.all([
      api.get<Shift[]>(`/rota/shifts?date_from=${from}&date_to=${to}`).then(setShifts),
      api.get<LabourSummary>(`/rota/labour?date_from=${from}&date_to=${to}`).then(setLabour),
    ]);
  }

  useEffect(() => {
    api.get<Employee[]>("/employees").then((e) => setEmployees(e.filter((x) => x.is_active))).catch(() => {});
  }, []);
  useEffect(() => {
    setLoading(true);
    setDay(from);
    reload().catch(() => setMsg("Could not load the rota.")).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  function shiftWeek(delta: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  }

  async function addShift(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!emp || !day || !start || !end) {
      setMsg("Pick an employee, day and times.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/rota/shifts", { employee_id: emp, date: day, start_time: start, end_time: end });
      await reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not add shift");
    } finally {
      setBusy(false);
    }
  }

  async function removeShift(id: string) {
    await api.delete(`/rota/shifts/${id}`).catch(() => {});
    await reload();
  }

  if (loading && !labour) return <Spinner />;

  const byDay = (d: Date) => shifts.filter((s) => s.date === iso(d));
  const labourTone =
    !labour || parseFloat(labour.net_sales) <= 0
      ? "text-fg"
      : parseFloat(labour.labour_pct) <= 30
        ? "text-brand-400"
        : parseFloat(labour.labour_pct) <= 35
          ? "text-amber-400"
          : "text-rose-400";

  return (
    <div>
      <PageHeader title="Rota" subtitle="Schedule shifts and see forecast labour cost as a % of sales." />
      {msg && <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{msg}</p>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => shiftWeek(-1)} className="rounded-lg border border-line-2 px-3 py-1.5 text-sm text-fg-soft hover:bg-paper-2">← Prev</button>
          <span className="text-sm font-medium text-fg">{from} → {to}</span>
          <button onClick={() => shiftWeek(1)} className="rounded-lg border border-line-2 px-3 py-1.5 text-sm text-fg-soft hover:bg-paper-2">Next →</button>
        </div>
        {labour && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-fg-soft">{labour.total_hours} h · {format(labour.total_cost)} labour</span>
            <span className={`font-semibold ${labourTone}`}>
              {parseFloat(labour.net_sales) > 0 ? `${labour.labour_pct}% of sales` : "no sales yet"}
            </span>
          </div>
        )}
      </div>

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-medium text-fg-soft">Add a shift</p>
          <form onSubmit={addShift} className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-fg-faint">Employee</span>
              <select value={emp} onChange={(e) => setEmp(e.target.value)} className="mt-1 rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm text-fg-soft outline-none focus:border-brand-500">
                <option value="">Choose…</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-fg-faint">Day</span>
              <select value={day} onChange={(e) => setDay(e.target.value)} className="mt-1 rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm text-fg-soft outline-none focus:border-brand-500">
                {weekDates.map((d, i) => <option key={i} value={iso(d)}>{DAYS[i]} {d.getDate()}/{d.getMonth() + 1}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-fg-faint">Start</span>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 rounded-lg border border-line-2 bg-glass/5 px-2 py-2 text-sm text-fg outline-none focus:border-brand-500" />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-fg-faint">End</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 rounded-lg border border-line-2 bg-glass/5 px-2 py-2 text-sm text-fg outline-none focus:border-brand-500" />
            </label>
            <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {busy ? "Adding…" : "Add"}
            </button>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {weekDates.map((d, i) => (
          <Card key={i} className="p-3">
            <p className="mb-2 text-sm font-semibold text-fg">{DAYS[i]} <span className="text-fg-faint">{d.getDate()}/{d.getMonth() + 1}</span></p>
            {byDay(d).length === 0 ? (
              <p className="py-2 text-xs text-fg-faint">—</p>
            ) : (
              <ul className="space-y-1.5">
                {byDay(d).map((s) => (
                  <li key={s.id} className="rounded-lg border border-line bg-glass/5 px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-1">
                      <span className="min-w-0 truncate font-medium text-fg">{s.employee_name}</span>
                      {canWrite && (
                        <button onClick={() => removeShift(s.id)} aria-label="Remove shift" className="text-fg-faint hover:text-rose-300">✕</button>
                      )}
                    </div>
                    <div className="text-fg-faint">
                      {hhmm(s.start_time)}–{hhmm(s.end_time)} · {s.hours}h · {format(s.cost)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      {labour && labour.by_employee.length > 0 && (
        <Card className="mt-6">
          <h3 className="font-semibold text-fg">Labour by person (this week)</h3>
          <ul className="mt-3 divide-y divide-line">
            {labour.by_employee.map((b) => (
              <li key={b.employee_id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-fg-soft">{b.employee_name}</span>
                <span className="text-fg-faint">{b.hours} h · <b className="text-fg">{format(b.cost)}</b></span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-faint">
            Rates: each person&apos;s hourly rate (salaried estimated at monthly ÷ 173h). Labour % = cost ÷ net sales.
          </p>
        </Card>
      )}
    </div>
  );
}
