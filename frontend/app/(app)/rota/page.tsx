"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, downloadFile, postForm, type Employee, type LabourSummary, type Shift } from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";
import { Select } from "@/components/Select";
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

  // ── Excel export / template / upload ───────────────────────────────────────
  const importInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function onImportRota(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await postForm<{ created: number; skipped: string[]; rows: number }>("/rota/import", fd);
      const skip = res.skipped.length ? `, skipped ${res.skipped.length} (name not found)` : "";
      setMsg(`Added ${res.created} shift${res.created === 1 ? "" : "s"} from the file${skip}.`);
      await reload();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not read that file.");
    } finally {
      setImporting(false);
    }
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

      <div className="mb-6 flex flex-wrap gap-2">
        <input ref={importInput} type="file" accept=".xlsx" className="hidden" onChange={onImportRota} />
        <button
          onClick={() => downloadFile(`/rota/export.xlsx?date_from=${from}&date_to=${to}`, `mise-rota-${from}.xlsx`)}
          className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
        >
          ⬇ Excel
        </button>
        <button
          onClick={() => downloadFile(`/rota/export.pdf?date_from=${from}&date_to=${to}`, `mise-rota-${from}.pdf`)}
          className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
        >
          ⬇ PDF
        </button>
        {canWrite && (
          <>
            <button
              onClick={() => downloadFile("/rota/template.xlsx", "mise-rota-template.xlsx")}
              title="Download a blank Excel template to fill in offline"
              className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
            >
              ⬇ Template
            </button>
            <button
              onClick={() => importInput.current?.click()}
              disabled={importing}
              title="Upload a filled template to add the shifts"
              className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-sm font-medium text-brand-300 hover:bg-brand-500/20 disabled:opacity-50"
            >
              {importing ? "Reading…" : "⬆ Upload rota"}
            </button>
          </>
        )}
      </div>

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-medium text-fg-soft">Add a shift</p>
          <form onSubmit={addShift} className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-end">
            <label className="block sm:w-48">
              <span className="block text-xs font-medium text-fg-faint">Employee</span>
              <Select
                value={emp}
                onChange={setEmp}
                placeholder="Choose…"
                className="mt-1 w-full"
                options={[
                  { value: "", label: "Choose…" },
                  ...employees.map((x) => ({ value: x.id, label: x.full_name })),
                ]}
              />
            </label>
            <label className="block sm:w-48">
              <span className="block text-xs font-medium text-fg-faint">Day</span>
              <Select
                value={day}
                onChange={setDay}
                className="mt-1 w-full"
                options={weekDates.map((d, i) => ({
                  value: iso(d),
                  label: `${DAYS[i]} ${d.getDate()}/${d.getMonth() + 1}`,
                }))}
              />
            </label>
            <label className="block sm:w-auto">
              <span className="block text-xs font-medium text-fg-faint">Start</span>
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm text-fg outline-none focus:border-brand-500 sm:w-32" />
            </label>
            <label className="block sm:w-auto">
              <span className="block text-xs font-medium text-fg-faint">End</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm text-fg outline-none focus:border-brand-500 sm:w-32" />
            </label>
            <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {busy ? "Adding…" : "Add shift"}
            </button>
          </form>
        </Card>
      )}

      {/* A horizontal week strip: each day is at least 170px so the shift cards
          never get crushed — on narrow screens it scrolls instead. */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {weekDates.map((d, i) => {
          const shifts = byDay(d);
          const isToday = iso(d) === iso(new Date());
          return (
            <Card key={i} className={`min-w-[170px] flex-1 p-3 ${isToday ? "ring-1 ring-brand-500/40" : ""}`}>
              <p className="mb-2 flex items-baseline justify-between text-sm font-semibold text-fg">
                <span>{DAYS[i]} <span className="text-fg-faint">{d.getDate()}/{d.getMonth() + 1}</span></span>
                {shifts.length > 0 && <span className="text-[10px] font-normal text-fg-faint">{shifts.length}</span>}
              </p>
              {shifts.length === 0 ? (
                <p className="py-3 text-center text-xs text-fg-faint">—</p>
              ) : (
                <ul className="space-y-1.5">
                  {shifts.map((s) => (
                    <li key={s.id} className="rounded-lg border border-line bg-glass/5 p-2 text-xs">
                      <div className="flex items-center justify-between gap-1">
                        <span className="min-w-0 truncate font-medium text-fg">{s.employee_name}</span>
                        {canWrite && (
                          <button onClick={() => removeShift(s.id)} aria-label="Remove shift" className="shrink-0 text-fg-faint hover:text-rose-300">✕</button>
                        )}
                      </div>
                      <div className="mt-0.5 text-fg-soft">{hhmm(s.start_time)}–{hhmm(s.end_time)}</div>
                      <div className="text-fg-faint">{s.hours}h · {format(s.cost)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
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
