"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, downloadFile, postForm, type Employee, type LabourSummary, type Shift } from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";
import { Bars, Meter } from "@/components/charts";
import { Select } from "@/components/Select";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { localISODate as iso } from "@/lib/date";
import { numeric } from "@/lib/sanitize";
import { spotlight, useDeepLink } from "@/components/fx";

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
const fmtDM = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

type CopyRow = {
  employee_id: string;
  employee_name: string;
  date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
};

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
  const [brk, setBrk] = useState("0");
  const [busy, setBusy] = useState(false);

  // Copy a chosen week → this week (editable preview, then apply)
  const [copyRows, setCopyRows] = useState<CopyRow[] | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copySource, setCopySource] = useState<Date | null>(null); // Monday of the source week
  const [copyConflict, setCopyConflict] = useState<"skip" | "replace">("skip");

  // ⌘K "Copy last week's rota" (?copy=1) → open the copy preview + spotlight it
  useDeepLink({ copy: () => { startCopy(); spotlight("rota-copy"); } }, !loading);

  // Grab-and-drag to scroll the week strip left/right (hand cursor).
  const stripRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ down: false, startX: 0, scroll: 0 });
  function onStripDown(e: React.MouseEvent) {
    const el = stripRef.current;
    if (!el) return;
    dragRef.current = { down: true, startX: e.pageX, scroll: el.scrollLeft };
  }
  function onStripMove(e: React.MouseEvent) {
    const el = stripRef.current;
    if (!el || !dragRef.current.down) return;
    el.scrollLeft = dragRef.current.scroll - (e.pageX - dragRef.current.startX);
  }
  function endStripDrag() {
    dragRef.current.down = false;
  }

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
      await api.post("/rota/shifts", {
        employee_id: emp, date: day, start_time: start, end_time: end,
        break_minutes: parseInt(brk, 10) || 0,
      });
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

  // Load any source week's shifts into the editable preview, mapped onto THIS week's
  // matching weekdays. Source defaults to last week but can be stepped to any week.
  async function loadCopyFrom(sourceStart: Date) {
    setMsg(null);
    const sEnd = new Date(sourceStart);
    sEnd.setDate(sEnd.getDate() + 6);
    try {
      const prev = await api.get<Shift[]>(`/rota/shifts?date_from=${iso(sourceStart)}&date_to=${iso(sEnd)}`);
      setCopySource(new Date(sourceStart));
      setCopyRows(
        prev.map((s) => {
          const idx = (new Date(s.date + "T00:00:00").getDay() + 6) % 7; // 0=Mon
          return {
            employee_id: s.employee_id,
            employee_name: s.employee_name,
            date: iso(weekDates[idx]),
            start_time: hhmm(s.start_time),
            end_time: hhmm(s.end_time),
            break_minutes: s.break_minutes,
          };
        }),
      );
    } catch {
      setMsg("Could not load that week's rota.");
    }
  }

  function startCopy() {
    const prevStart = new Date(weekStart);
    prevStart.setDate(prevStart.getDate() - 7);
    loadCopyFrom(prevStart);
  }

  // You copy FROM the past — the latest week you may pick is last week. This keeps
  // the source strictly before the week you're filling in.
  const latestSource = addDays(weekStart, -7);
  const canStepLater = copySource ? copySource.getTime() < latestSource.getTime() : false;

  function stepCopySource(delta: number) {
    if (!copySource) return;
    const d = new Date(copySource);
    d.setDate(d.getDate() + delta * 7);
    if (d.getTime() > latestSource.getTime()) return; // never step into this week or the future
    loadCopyFrom(d);
  }

  function updateCopyRow(i: number, patch: Partial<CopyRow>) {
    setCopyRows((rows) => rows && rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  }

  // Rows that clash with a shift already on this week (same person + day).
  const existingKeys = new Set(shifts.map((s) => `${s.employee_id}|${s.date}`));
  const copyClashes = (copyRows ?? []).filter((r) => existingKeys.has(`${r.employee_id}|${r.date}`)).length;

  async function applyCopy() {
    if (!copyRows || !copyRows.length) return;
    setCopyBusy(true);
    setMsg(null);
    try {
      let created = 0;
      let skipped = 0;
      let replaced = 0;
      for (const r of copyRows) {
        const clash = existingKeys.has(`${r.employee_id}|${r.date}`);
        if (clash && copyConflict === "skip") {
          skipped++;
          continue;
        }
        if (clash && copyConflict === "replace") {
          for (const s of shifts.filter((s) => s.employee_id === r.employee_id && s.date === r.date)) {
            await api.delete(`/rota/shifts/${s.id}`).catch(() => {});
          }
          replaced++;
        }
        await api.post("/rota/shifts", {
          employee_id: r.employee_id, date: r.date,
          start_time: r.start_time, end_time: r.end_time, break_minutes: r.break_minutes,
        });
        created++;
      }
      setCopyRows(null);
      setCopySource(null);
      await reload();
      const bits = [`${created} added`];
      if (skipped) bits.push(`${skipped} skipped (already scheduled)`);
      if (replaced) bits.push(`${replaced} replaced`);
      setMsg("Copied: " + bits.join(", ") + ".");
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not copy the rota.");
    } finally {
      setCopyBusy(false);
    }
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
      if (err instanceof ApiError && err.status === 422) {
        const d = err.detail as { errors?: string[] } | undefined;
        setMsg("Couldn't import — " + (d?.errors ?? ["the file didn't match the template."]).join("  •  "));
      } else {
        setMsg(err instanceof ApiError ? err.message : "Could not read that file.");
      }
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
          <button onClick={() => shiftWeek(-1)} className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm text-fg-soft">← Prev</button>
          <span className="text-sm font-medium text-fg">{from} → {to}</span>
          <button onClick={() => shiftWeek(1)} className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm text-fg-soft">Next →</button>
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

      {labour && parseFloat(labour.net_sales) > 0 && (
        <div className="mise-well mise-feel mb-4 max-w-md rounded-xl p-4">
          <Meter label="Labour cost" value={parseFloat(labour.labour_pct) || 0} target={30} goodBelow />
          <p className="mt-1.5 text-[11px] text-fg-faint">
            This week&apos;s planned labour as % of net sales — most kitchens aim under 30%.
          </p>
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        <input ref={importInput} type="file" accept=".xlsx,.csv" className="hidden" onChange={onImportRota} />
        <button
          onClick={() => downloadFile(`/rota/export.xlsx?date_from=${from}&date_to=${to}`, `mise-rota-${from}.xlsx`)}
          className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-fg-soft"
        >
          ⬇ Excel
        </button>
        <button
          onClick={() => downloadFile(`/rota/export.pdf?date_from=${from}&date_to=${to}`, `mise-rota-${from}.pdf`)}
          className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-fg-soft"
        >
          ⬇ PDF
        </button>
        {canWrite && (
          <>
            <button
              onClick={startCopy}
              disabled={!!copyRows}
              title="Copy a previous week's shifts into this week — pick the week, review, then apply"
              className="mise-press rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-sm font-medium text-brand-300 hover:bg-brand-500/20 disabled:opacity-50"
            >
              ⎘ Copy a week
            </button>
            <button
              onClick={() => downloadFile(`/rota/template.xlsx?date_from=${from}&date_to=${to}`, "mise-rota-template.xlsx")}
              title="Download this week as a blank grid (same layout as ⬇ Excel) — fill the cells and upload it back"
              className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-fg-soft"
            >
              ⬇ Blank grid (Excel)
            </button>
            <button
              onClick={() => downloadFile(`/rota/template.csv?date_from=${from}&date_to=${to}`, "mise-rota-template.csv")}
              title="Same blank grid as a CSV"
              className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-fg-soft"
            >
              CSV
            </button>
            <button
              onClick={() => importInput.current?.click()}
              disabled={importing}
              title="Upload a filled grid (the same layout you download) — it replaces that week's shifts for the staff in the file"
              className="mise-press rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-sm font-medium text-brand-300 hover:bg-brand-500/20 disabled:opacity-50"
            >
              {importing ? "Reading…" : "⬆ Upload grid"}
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
            <label className="block sm:w-auto">
              <span className="block text-xs font-medium text-fg-faint">Break (min)</span>
              <input inputMode="numeric" value={brk} onChange={(e) => setBrk(numeric(e.target.value, { decimal: false }))} title="Unpaid break — deducted from paid hours" className="mt-1 w-full rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm text-fg outline-none focus:border-brand-500 sm:w-24" />
            </label>
            <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {busy ? "Adding…" : "Add shift"}
            </button>
          </form>
        </Card>
      )}

      {copyRows && (
        <Card className="mise-card-slide mb-6 ring-1 ring-brand-500/30" id="rota-copy">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-fg">⎘ Copy a week → this week ({from} → {to})</p>
              <p className="text-xs text-fg-faint">
                Pick the week to copy from, tweak times, remove any you don&apos;t want, then apply.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg-faint">Copy from</span>
              <button onClick={() => stepCopySource(-1)} disabled={copyBusy} className="rounded-md border border-line-2 px-2 py-1 text-xs text-fg-soft hover:bg-paper-2" aria-label="Earlier week">‹</button>
              <span className="min-w-[6rem] text-center text-xs font-medium text-fg">
                {copySource ? `${fmtDM(copySource)} – ${fmtDM(addDays(copySource, 6))}` : ""}
              </span>
              <button onClick={() => stepCopySource(1)} disabled={copyBusy || !canStepLater} title={!canStepLater ? "You can only copy from a past week" : undefined} className="rounded-md border border-line-2 px-2 py-1 text-xs text-fg-soft hover:bg-paper-2 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Later week">›</button>
              <button onClick={() => { setCopyRows(null); setCopySource(null); }} className="ml-1 text-fg-faint hover:text-fg" aria-label="Cancel">✕</button>
            </div>
          </div>

          {copyRows.length === 0 ? (
            <p className="py-4 text-center text-sm text-fg-faint">No shifts in that week — use ‹ to pick an earlier week.</p>
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
                <span className="min-w-[7rem] flex-1">Employee</span>
                <span className="w-20">Day</span>
                <span className="w-[4.6rem] text-center">Start</span>
                <span className="w-[4.6rem] text-center">End</span>
                <span className="w-14 text-center">Break (min)</span>
                <span className="w-4" />
              </div>
              <div className="mise-slide-stagger mt-1 max-h-80 space-y-2 overflow-y-auto pr-1">
                {copyRows.map((r, i) => {
                  const dayIdx = weekDates.findIndex((d) => iso(d) === r.date);
                  const clash = existingKeys.has(`${r.employee_id}|${r.date}`);
                  return (
                    <div key={i} className={`mise-well flex flex-wrap items-center gap-2 rounded-xl p-2 text-sm transition ${clash ? "ring-1 ring-amber-400/40" : ""}`}>
                      <span className="flex min-w-[7rem] flex-1 items-center gap-2 truncate font-medium text-fg">
                        <span className="truncate">{r.employee_name}</span>
                        {clash && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-400/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> scheduled
                          </span>
                        )}
                      </span>
                      <span className="w-20 text-xs text-fg-faint">
                        {dayIdx >= 0 ? `${DAYS[dayIdx]} ${weekDates[dayIdx].getDate()}/${weekDates[dayIdx].getMonth() + 1}` : r.date}
                      </span>
                      <input type="time" value={r.start_time} onChange={(e) => updateCopyRow(i, { start_time: e.target.value })} className="w-[4.6rem] rounded-md border border-line-2 bg-transparent px-2 py-1 text-xs text-fg" />
                      <input type="time" value={r.end_time} onChange={(e) => updateCopyRow(i, { end_time: e.target.value })} className="w-[4.6rem] rounded-md border border-line-2 bg-transparent px-2 py-1 text-xs text-fg" />
                      <input type="number" min={0} step={5} value={r.break_minutes} onChange={(e) => updateCopyRow(i, { break_minutes: parseInt(e.target.value, 10) || 0 })} className="w-14 rounded-md border border-line-2 bg-transparent px-2 py-1 text-center text-xs text-fg" />
                      <button onClick={() => setCopyRows((rows) => rows && rows.filter((_, k) => k !== i))} className="text-fg-faint hover:text-rose-300" aria-label="Remove">✕</button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {copyClashes > 0 && (
            <div className="mise-card-slide mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-paper-2/40 px-3 py-2.5 text-xs">
              <span className="text-fg-soft">
                <b className="text-fg">{copyClashes}</b> already scheduled this week —
              </span>
              <div className="inline-flex rounded-lg border border-line bg-paper p-0.5">
                {(["skip", "replace"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setCopyConflict(m)}
                    className={`rounded-md px-3 py-1 font-medium transition ${
                      copyConflict === m ? "bg-brand-600 text-white shadow-sm" : "text-fg-soft hover:text-fg"
                    }`}
                  >
                    {m === "skip" ? "Skip them" : "Replace them"}
                  </button>
                ))}
              </div>
              <span className="text-fg-faint">
                {copyConflict === "skip" ? "keeps what's already there" : "overwrites the clashing shifts"}
              </span>
            </div>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button onClick={applyCopy} disabled={copyBusy || copyRows.length === 0} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {copyBusy ? "Copying…" : `Apply ${copyRows.length} shift${copyRows.length === 1 ? "" : "s"}`}
            </button>
            <button onClick={() => { setCopyRows(null); setCopySource(null); }} className="rounded-lg border border-line px-4 py-2 text-sm text-fg-soft hover:bg-paper-2">Cancel</button>
          </div>
        </Card>
      )}

      {/* A horizontal week strip: each day is at least 170px so the shift cards
          never get crushed. Grab-and-drag (hand cursor) to scroll left/right. */}
      <div
        ref={stripRef}
        onMouseDown={onStripDown}
        onMouseMove={onStripMove}
        onMouseUp={endStripDrag}
        onMouseLeave={endStripDrag}
        className="flex cursor-grab gap-3 overflow-x-auto pb-2 select-none active:cursor-grabbing"
      >
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
                    <li key={s.id} className="mise-well mise-feel rounded-lg p-2 text-xs">
                      <div className="flex items-center justify-between gap-1">
                        <span className="min-w-0 truncate font-medium text-fg">{s.employee_name}</span>
                        {canWrite && (
                          <button onClick={() => removeShift(s.id)} aria-label="Remove shift" className="shrink-0 text-fg-faint hover:text-rose-300">✕</button>
                        )}
                      </div>
                      <div className="mt-0.5 text-fg-soft">
                        {hhmm(s.start_time)}–{hhmm(s.end_time)}
                        {s.break_minutes > 0 && <span className="text-fg-faint"> · {s.break_minutes}m brk</span>}
                      </div>
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
        <Card className="mise-feel mt-6">
          <h3 className="font-semibold text-fg">Labour by person (this week)</h3>
          <div className="mise-well mt-3 rounded-xl p-3">
            <Bars
              formatValue={(v) => format(String(v))}
              items={[...labour.by_employee]
                .sort((a, b) => parseFloat(b.cost) - parseFloat(a.cost))
                .map((b) => ({
                  label: `${b.employee_name} · ${b.hours}h`,
                  value: parseFloat(b.cost) || 0,
                  color: "#d97742",
                }))}
            />
          </div>
          <p className="mt-2 text-xs text-fg-faint">
            Rates: each person&apos;s hourly rate (salaried estimated at monthly ÷ 173h). Labour % = cost ÷ net sales.
          </p>
        </Card>
      )}
    </div>
  );
}
