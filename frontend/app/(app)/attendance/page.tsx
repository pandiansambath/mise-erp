"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadFile, type AttendanceRow, type Employee } from "@/lib/api";
import Link from "next/link";
import { Badge, Button, Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { Bars, CalendarHeat } from "@/components/charts";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { useHotelTime } from "@/lib/time";
import { can } from "@/lib/permissions";
import { Select } from "@/components/Select";
import ChefMascot from "@/components/auth/ChefMascot";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

type AttHistory = {
  employee: { id: string; name: string; salary_type: string };
  date_from: string;
  date_to: string;
  totals: {
    present: number; half_days: number; absent: number; recorded_days: number;
    total_hours: string; indicative_pay: string; basis: string;
  };
  days: {
    date: string; status: string; working_hours: string | null;
    clock_in: string | null; clock_out: string | null; break_minutes: number;
  }[];
};

const STATUS_TONE: Record<string, string> = {
  PRESENT: "text-emerald-500",
  HALF_DAY: "text-amber-500",
  ABSENT: "text-rose-400",
};

export default function AttendancePage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const { time: fmtTime, timeZone } = useHotelTime();
  const canWrite = can(user?.role, "attendance:write");

  const [day, setDay] = useState(today());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Record<string, AttendanceRow>>({});
  // per-person trailing week: employee_id -> hours worked on each of the 7 days ending `day`
  const [week, setWeek] = useState<Record<string, number[]>>({});
  const [weekDays, setWeekDays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The punch clock: who's at the pad + the press ripple
  const [punchSel, setPunchSel] = useState("");
  const [punchRipple, setPunchRipple] = useState(0);

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

  // The week strip loads quietly after the day view — never blocks the page.
  const loadWeek = useCallback(async (d: string) => {
    const end = new Date(d + "T12:00:00");
    const days = Array.from({ length: 7 }, (_, i) => {
      const dt = new Date(end);
      dt.setDate(end.getDate() - (6 - i));
      return dt.toISOString().slice(0, 10);
    });
    setWeekDays(days);
    const perDay = await Promise.all(
      days.map((dt) => api.get<AttendanceRow[]>(`/attendance?on=${dt}`).catch(() => [] as AttendanceRow[])),
    );
    const map: Record<string, number[]> = {};
    perDay.forEach((att, i) => {
      for (const r of att) {
        (map[r.employee_id] ??= Array(7).fill(0))[i] = parseFloat(r.working_hours ?? "0") || 0;
      }
    });
    setWeek(map);
  }, []);

  useEffect(() => {
    load(day).finally(() => setLoading(false));
    loadWeek(day);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changeDay(d: string) {
    setDay(d);
    setLoading(true);
    await load(d).finally(() => setLoading(false));
    loadWeek(d);
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
          className="mise-well rounded-lg px-3 py-2 text-sm outline-none"
        />
        <span className="text-sm text-fg-faint">{present} present · {employees.length} staff</span>
        <span className="text-xs text-fg-faint">· times in {timeZone}</span>
        {!isToday && <span className="text-xs text-fg-faint">(punching only works for today)</span>}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => downloadFile(`/attendance/timesheet.pdf?on=${day}`, `timesheet-${day}.pdf`)}
            className="mise-raised mise-press rounded-lg px-3 py-2 text-sm font-medium text-fg-soft"
          >
            ⬇ PDF
          </button>
          <button
            onClick={() => downloadFile(`/attendance/timesheet.xlsx?on=${day}`, `timesheet-${day}.xlsx`)}
            className="mise-raised mise-press rounded-lg px-3 py-2 text-sm font-medium text-fg-soft"
            title="Just this one day"
          >
            ⬇ Excel (day)
          </button>
          <button
            onClick={() => downloadFile(`/attendance/range.xlsx?date_from=${daysAgoISO(29)}&date_to=${today()}`, `attendance-last-30-days.xlsx`)}
            className="mise-raised mise-press rounded-lg px-3 py-2 text-sm font-medium text-fg-soft"
            title="Everyone, last 30 days"
          >
            ⬇ Last 30 days
          </button>
        </div>
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      <AttendanceHistoryCard employees={employees} format={format} />

      {/* ── THE PUNCH CLOCK — one big physical button, chef looking on ── */}
      {isToday && canWrite && employees.length > 0 && (() => {
        const emp = employees.find((e) => e.id === punchSel) ?? employees[0];
        const r = rows[emp.id];
        const state: { type: string | null; label: string; sub: string; tone: string } = !r?.clock_in
          ? { type: "CLOCK_IN", label: "Clock in", sub: "start the shift", tone: "text-brand-300" }
          : r.on_break
            ? { type: "BREAK_END", label: "End break", sub: "back to the pass", tone: "text-amber-300" }
            : !r.clock_out
              ? { type: "CLOCK_OUT", label: "Clock out", sub: "wrap the shift", tone: "text-rose-300" }
              : { type: null, label: "Done ✓", sub: `worked ${fmtHours(r.working_hours)}`, tone: "text-fg-faint" };
        return (
          <Card className="mise-feel mb-6">
            <div className="flex flex-wrap items-center gap-6">
              <div className="w-28 shrink-0 sm:w-32">
                <ChefMascot mood={state.type === null ? "happy" : r?.on_break ? "think" : "point"} look={0} />
              </div>
              <div className="min-w-[12rem] flex-1">
                <h3 className="font-semibold text-fg">Punch clock</h3>
                <p className="mb-2 text-xs text-fg-faint">pick a person, press the button — that&apos;s the whole job</p>
                <Select
                  value={emp.id}
                  onChange={setPunchSel}
                  options={employees.map((e) => {
                    const er = rows[e.id];
                    const flag = !er?.clock_in ? "· not in yet" : er.on_break ? "· on break" : er.clock_out ? "· done" : "· working";
                    return { value: e.id, label: `${e.full_name} ${flag}` };
                  })}
                />
                {r?.clock_in && (
                  <p className="mt-2 text-xs text-fg-faint">
                    in {fmtTime(r.clock_in)}{r.break_minutes > 0 ? ` · break ${r.break_minutes}m` : ""}
                    {r.clock_out ? ` · out ${fmtTime(r.clock_out)}` : ""}
                  </p>
                )}
              </div>
              <div className="relative mx-auto sm:mx-0">
                {punchRipple > 0 && (
                  <span key={punchRipple} aria-hidden className="mise-punch-ring absolute inset-0 rounded-full" />
                )}
                <button
                  type="button"
                  disabled={state.type === null}
                  onClick={() => {
                    setPunchRipple((n) => n + 1);
                    if (state.type) punch(emp.id, state.type);
                  }}
                  className={`mise-raised mise-press relative grid h-36 w-36 place-items-center rounded-full text-center disabled:opacity-60 ${state.tone}`}
                >
                  <span>
                    <span className="block text-xl font-bold">{state.label}</span>
                    <span className="block text-[11px] text-fg-faint">{state.sub}</span>
                  </span>
                </button>
              </div>
            </div>
          </Card>
        );
      })()}

      {/* the floor, live: who's on right now — breathing presence chips */}
      {(() => {
        const on = employees.filter((e) => {
          const r = rows[e.id];
          return r?.clock_in && !r.clock_out;
        });
        if (on.length === 0) return null;
        return (
          <div className="mise-well mb-4 flex flex-wrap items-center gap-2 rounded-2xl p-2.5">
            <span className="px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
              On the floor now
            </span>
            {on.map((e) => {
              const r = rows[e.id];
              return (
                <span
                  key={e.id}
                  className={`mise-raised inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                    r?.on_break ? "text-amber-300" : "text-brand-300"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 animate-pulse rounded-full ${r?.on_break ? "bg-amber-400" : "bg-brand-400"}`}
                    aria-hidden
                  />
                  {e.full_name.split(" ")[0]}
                  {r?.on_break && <span className="text-[10px] opacity-80">break</span>}
                </span>
              );
            })}
            <span className="ml-auto px-1 text-[11px] text-fg-faint">
              {on.length} in · {on.filter((e) => rows[e.id]?.on_break).length} on break
            </span>
          </div>
        );
      })()}

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
                      <td className="px-5 py-3 font-medium text-fg">
                        {e.full_name}
                        {week[e.id] && (
                          // the last 7 days at a glance — darker = longer day
                          <span className="mt-1.5 flex items-center gap-[3px]" aria-hidden>
                            {week[e.id].map((h, i) => (
                              <span
                                key={i}
                                title={`${weekDays[i]}: ${h ? `${h.toFixed(1)}h` : "off"}`}
                                className="h-2.5 w-2.5 rounded-[3px]"
                                style={{
                                  background:
                                    h > 0
                                      ? `rgba(16,185,129,${Math.min(1, 0.25 + (h / 10) * 0.75).toFixed(2)})`
                                      : "rgba(148,163,158,0.14)",
                                }}
                              />
                            ))}
                            <span className="ml-1 text-[9px] font-normal text-fg-faint">7d</span>
                          </span>
                        )}
                      </td>
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
                        {r?.clock_in && (() => {
                          // the day as a strip: 06:00→24:00, shift filled in
                          const frac = (iso: string) => {
                            const [h, m] = fmtTime(iso).split(":").map(Number);
                            return Math.max(0, Math.min(1, (h + m / 60 - 6) / 18));
                          };
                          const a = frac(r.clock_in);
                          const b = r.clock_out ? Math.max(a + 0.02, frac(r.clock_out)) : Math.max(a + 0.02, frac(new Date().toISOString()));
                          return (
                            <span className="mise-well mt-1.5 block h-1.5 w-24 overflow-hidden rounded-full" aria-hidden>
                              <span
                                className={`block h-full rounded-full ${r.clock_out ? "bg-brand-500/70" : "bg-amber-400/80"}`}
                                style={{ marginLeft: `${a * 100}%`, width: `${Math.max(3, (b - a) * 100)}%` }}
                              />
                            </span>
                          );
                        })()}
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
                <input type="time" value={ci} onChange={(ev) => setCi(ev.target.value)} className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none" />
              </label>
              <label className="text-sm text-fg-soft">Clock out
                <input type="time" value={co} onChange={(ev) => setCo(ev.target.value)} className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none" />
              </label>
              <label className="col-span-2 text-sm text-fg-soft">Break (minutes)
                <input type="number" min="0" value={brk} onChange={(ev) => setBrk(ev.target.value)} className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none" />
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
              <button onClick={() => setEditEmp(null)} className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm text-fg-soft">Cancel</button>
              <button onClick={saveEdit} disabled={savingEdit} className="mise-press rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {savingEdit ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ── Per-person attendance history: any range, charts, totals, download ── */
function AttendanceHistoryCard({ employees, format }: {
  employees: Employee[];
  format: (v: string) => string;
}) {
  const [empId, setEmpId] = useState("");
  const [mode, setMode] = useState<"WEEK" | "MONTH" | "CUSTOM">("MONTH");
  const [from, setFrom] = useState(daysAgoISO(29));
  const [to, setTo] = useState(today());
  const [hist, setHist] = useState<AttHistory | null>(null);
  const [busy, setBusy] = useState(false);

  function applyMode(m: "WEEK" | "MONTH" | "CUSTOM") {
    setMode(m);
    if (m === "WEEK") { setFrom(daysAgoISO(6)); setTo(today()); }
    else if (m === "MONTH") { setFrom(daysAgoISO(29)); setTo(today()); }
  }

  const load = useCallback(() => {
    if (!empId) { setHist(null); return; }
    setBusy(true);
    api.get<AttHistory>(`/attendance/history/${empId}?date_from=${from}&date_to=${to}`)
      .then(setHist).catch(() => setHist(null)).finally(() => setBusy(false));
  }, [empId, from, to]);
  useEffect(load, [load]);

  return (
    <Card className="mise-feel mb-6">
      <h3 className="font-semibold text-fg">📖 Attendance history by person</h3>
      <p className="mt-1 text-sm text-fg-faint">
        No more clicking day by day — pick a person and a range and see the whole picture:
        every day, total hours, and the pay it would earn. Download it too.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="w-56">
          <label className="block text-xs font-medium text-fg-faint">Person</label>
          <Select
            className="mt-1"
            value={empId}
            onChange={setEmpId}
            options={[{ value: "", label: "Choose a person\u2026" },
              ...employees.map((e) => ({ value: e.id, label: e.full_name }))]}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-fg-faint">Range</label>
          <Segmented
            className="mt-1"
            value={mode}
            onChange={(v) => applyMode(v as "WEEK" | "MONTH" | "CUSTOM")}
            options={[
              { value: "WEEK", label: "Last 7 days" },
              { value: "MONTH", label: "Last 30 days" },
              { value: "CUSTOM", label: "From\u2192to" },
            ]}
          />
        </div>
        {mode === "CUSTOM" && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mise-well rounded-lg px-2.5 py-2 text-sm" aria-label="From" />
            <span className="text-fg-faint">\u2192</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mise-well rounded-lg px-2.5 py-2 text-sm" aria-label="To" />
          </div>
        )}
        {empId && (
          <Button variant="secondary" onClick={() => downloadFile(
            `/attendance/range.xlsx?date_from=${from}&date_to=${to}&employee_id=${empId}`,
            `attendance-${hist?.employee.name ?? "person"}-${from}-to-${to}.xlsx`)}>
            \u2b07 Download
          </Button>
        )}
      </div>

      {busy && <p className="mt-4 text-sm text-fg-faint">Loading\u2026</p>}
      {hist && !busy && (
        <div className="mise-cadence-in mt-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ["Present", String(hist.totals.present), "text-emerald-500"],
              ["Half-days", String(hist.totals.half_days), "text-amber-500"],
              ["Absent", String(hist.totals.absent), "text-rose-400"],
              ["Total hours", hist.totals.total_hours, "text-fg"],
              ["Indicative pay", format(hist.totals.indicative_pay), "text-brand-400"],
            ].map(([l, v, c]) => (
              <div key={l} className="mise-well rounded-xl p-2.5 text-center">
                <p className={`font-mono text-base font-bold ${c}`}>{v}</p>
                <p className="text-[10px] uppercase tracking-wide text-fg-faint">{l}</p>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-fg-faint">
            indicative pay = {hist.totals.basis} \u00b7 the real, overlap-checked run lives in{" "}
            <Link href="/payroll" className="text-brand-400 underline">Payroll</Link>
          </p>

          {hist.days.length > 0 ? (
            <>
              <div className="mt-4">
                <CalendarHeat
                  days={hist.days.map((d) => ({
                    date: d.date,
                    value: d.status === "PRESENT" ? 2 : d.status === "HALF_DAY" ? 1 : 0,
                  }))}
                  formatValue={(v) => (v === 2 ? "present" : v === 1 ? "half-day" : "absent")}
                />
              </div>
              <div className="mt-4">
                <Bars items={[...hist.days].reverse().map((d) => ({
                  label: d.date.slice(5),
                  value: parseFloat(d.working_hours ?? "0") || 0,
                  color: d.status === "PRESENT" ? "#10b981" : d.status === "HALF_DAY" ? "#f59e0b" : "#f43f5e",
                }))} formatValue={(v) => `${v}h`} />
                <p className="mt-1 text-center text-[10px] text-fg-faint">hours worked each day</p>
              </div>
              <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-line">
                    {hist.days.map((d) => (
                      <tr key={d.date}>
                        <td className="px-3 py-2 font-mono text-fg-soft">{d.date}</td>
                        <td className={`px-3 py-2 font-semibold ${STATUS_TONE[d.status] ?? "text-fg-faint"}`}>
                          {d.status.replace("_", "-").toLowerCase()}
                        </td>
                        <td className="px-3 py-2 text-fg-faint">
                          {d.clock_in ? `${d.clock_in.slice(11, 16)}\u2013${d.clock_out ? d.clock_out.slice(11, 16) : "\u2026"}` : "\u2014"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-fg">{d.working_hours ?? "0"}h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="mise-well mt-3 rounded-xl p-4 text-sm text-fg-faint">No attendance recorded in this range.</p>
          )}
        </div>
      )}
    </Card>
  );
}
