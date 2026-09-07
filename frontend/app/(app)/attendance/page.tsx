"use client";

// ATTENDANCE — rebuilt around the only question the page is asked.
//
//   "UI UX we need to change from the scratch, we need to build the super cool
//    UI UX. try think deeply and work on"
//
// WHAT WAS WRONG, measured before touching anything: the page ran 1.97 screens
// on a laptop and **4.41 on a phone**, and the six people it is about began
// roughly a thousand pixels down. Above them sat a history panel, a punch clock
// illustrated with a 180px cartoon chef, and a numbered how-to for setting up
// the door tablet. Below them, a legend and a flow explainer. On a phone you
// reached the end of the first screen without seeing a single person.
//
// It was laid out as a manual with the tool at the bottom.
//
// WHAT IT IS NOW. One question — *who is in, and who should be* — answered in
// the first screen. A sticky row says which day and how many are in; under it
// the staff, as cards, immediately.
//
// The punch clock stopped being a section. Picking a name from a dropdown and
// then pressing a button somewhere else is two steps to say one thing, and it
// could contradict the list right beside it. Now the card IS the punch clock:
// each person shows one obvious next action, and what that action is depends on
// where they are in the day. You cannot clock in somebody who is already in,
// because that button is not there to press.
//
// Everything occasional — exports, the tablet setup, the legend, a person's
// history — moved behind ⋯ or behind the person it concerns. None of it earned
// a permanent place above the answer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AttendanceLock } from "@/components/AttendanceLock";
import Link from "next/link";

import { Bars, CalendarHeat } from "@/components/charts";
import { TimeRangePicker } from "@/components/RangeControls";
import { DayStepper, PageMore, type PageAction } from "@/components/PageKit";
import { AttendanceLegend, LEAVE_CHANGED, QuickLeave } from "@/components/QuickLeave";
import { SheetPopup } from "@/components/SheetPopup";
import { Badge, Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { api, ApiError, downloadFile, type AttendanceRow, type Employee } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { fmtHours } from "@/lib/quantity";
import { useHotelTime } from "@/lib/time";

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
    present: number;
    half_days: number;
    absent: number;
    recorded_days: number;
    total_hours: string;
    indicative_pay: string;
    basis: string;
  };
  days: {
    date: string;
    status: string;
    working_hours: string | null;
    clock_in: string | null;
    clock_out: string | null;
    break_minutes: number;
    no_punch?: boolean;
  }[];
};

/** Where one person is in their day. Deriving this once, in one place, is what
 *  lets the card show a single obvious action instead of a row of buttons that
 *  are mostly wrong. */
type Phase = "leave" | "out" | "working" | "break" | "done";

function phaseOf(r: AttendanceRow | undefined): Phase {
  if (r?.on_leave) return "leave";
  if (!r?.clock_in) return "out";
  if (r.on_break) return "break";
  if (!r.clock_out) return "working";
  return "done";
}

const PHASE_LABEL: Record<Phase, string> = {
  leave: "On leave",
  out: "Not in yet",
  working: "Working",
  break: "On break",
  done: "Clocked out",
};

const PHASE_TONE: Record<Phase, "green" | "amber" | "red" | "slate"> = {
  leave: "slate",
  out: "red",
  working: "green",
  break: "amber",
  done: "slate",
};

/** 120 -> "2h", 90 -> "1h 30m". Minutes alone made a two-hour break read as a
 *  typo. */
function fmtBreak(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export default function AttendancePage() {
  const { user } = useAuth();
  const { time: fmtTime, timeZone } = useHotelTime();
  const canWrite = can(user?.role, "attendance:write");

  const [day, setDay] = useState(today());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<Record<string, AttendanceRow>>({});
  const [week, setWeek] = useState<Record<string, number[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [openPerson, setOpenPerson] = useState<Employee | null>(null);
  const [sheet, setSheet] = useState<null | "tablet" | "markers">(null);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    try {
      const [emps, att] = await Promise.all([
        api.get<Employee[]>("/employees"),
        api.get<AttendanceRow[]>(`/attendance?on=${d}`),
      ]);
      setEmployees(emps);
      setRows(Object.fromEntries(att.map((r) => [r.employee_id, r])));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load attendance");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(day);
  }, [day, load]);

  // The seven days ending on the one being viewed, for the little bar under each
  // name. Loaded after the page has painted: it is context, not the answer, and
  // the answer should not wait for it.
  useEffect(() => {
    let alive = true;
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(day + "T00:00:00");
      d.setDate(d.getDate() - (6 - i));
      return d.toISOString().slice(0, 10);
    });
    Promise.all(
      days.map((dt) =>
        api.get<AttendanceRow[]>(`/attendance?on=${dt}`).catch(() => [] as AttendanceRow[]),
      ),
    ).then((all) => {
      if (!alive) return;
      const map: Record<string, number[]> = {};
      all.forEach((rowsForDay, i) => {
        for (const r of rowsForDay) {
          (map[r.employee_id] ??= Array(7).fill(0))[i] = Number(r.working_hours ?? 0);
        }
      });
      setWeek(map);
    });
    return () => {
      alive = false;
    };
  }, [day]);

  useEffect(() => {
    const again = () => void load(day);
    window.addEventListener(LEAVE_CHANGED, again);
    return () => window.removeEventListener(LEAVE_CHANGED, again);
  }, [day, load]);

  async function punch(employeeId: string, type: string) {
    setBusyId(employeeId);
    setError(null);
    try {
      await api.post("/attendance/punch", { employee_id: employeeId, type });
      await load(day);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That did not register");
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    let inNow = 0;
    let onBreak = 0;
    let leave = 0;
    let missing = 0;
    for (const e of employees) {
      const p = phaseOf(rows[e.id]);
      if (p === "working") inNow += 1;
      if (p === "break") {
        inNow += 1;
        onBreak += 1;
      }
      if (p === "leave") leave += 1;
      if (p === "out" && rows[e.id]?.scheduled) missing += 1;
    }
    return { inNow, onBreak, leave, missing };
  }, [employees, rows]);

  const more: PageAction[] = [
    {
      key: "pdf",
      label: "Timesheet for this day (PDF)",
      icon: "📄",
      onSelect: () =>
        void downloadFile(`/attendance/timesheet.pdf?on=${day}`, `timesheet-${day}.pdf`),
    },
    {
      key: "xlsx",
      label: "This day (Excel)",
      icon: "📊",
      onSelect: () =>
        void downloadFile(`/attendance/timesheet.xlsx?on=${day}`, `timesheet-${day}.xlsx`),
    },
    {
      key: "range",
      label: "Last 30 days (Excel)",
      icon: "🗓️",
      hint: "Every person, every day, with hours",
      onSelect: () =>
        void downloadFile(
          `/attendance/range.xlsx?date_from=${daysAgoISO(29)}&date_to=${today()}`,
          "attendance-last-30-days.xlsx",
        ),
    },
    {
      key: "tablet",
      label: "The tablet by the door",
      icon: "🖥️",
      hint: "Set the PIN and open the clocking screen",
      onSelect: () => setSheet("tablet"),
    },
    {
      key: "markers",
      label: "What the markers mean",
      icon: "🔑",
      onSelect: () => setSheet("markers"),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Who is in, and who should be."
        actions={<PageMore actions={more} title="Attendance" subtitle="Exports and setup" />}
      />

      {/* THE ONLY ROW ABOVE THE PEOPLE. Which day, and how it stands. */}
      <div className="mise-card-inset mb-4 flex flex-wrap items-center gap-3 rounded-2xl px-3 py-2.5">
        <DayStepper value={day} onChange={setDay} max={today()} />
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold text-fg" data-testid="att-count">
            {counts.inNow} of {employees.length} in
          </span>
          {counts.onBreak > 0 && (
            <span className="text-amber-500">{counts.onBreak} on break</span>
          )}
          {counts.leave > 0 && <span className="text-fg-faint">{counts.leave} on leave</span>}
          {/* The one that needs a phone call, said plainly rather than left for
              the reader to work out by comparing two columns. */}
          {counts.missing > 0 && (
            <span className="font-semibold text-rose-400">
              {counts.missing} expected, not in
            </span>
          )}
        </div>
        <span className="ml-auto text-[11px] text-fg-faint">times in {timeZone}</span>
      </div>

      {error && (
        <p className="mb-3 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-400">{error}</p>
      )}

      {loading ? (
        <Spinner />
      ) : employees.length === 0 ? (
        <Card className="py-10 text-center text-sm text-fg-faint">
          Nobody on the books yet. Add people on Employees and they appear here.
        </Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {employees.map((e) => (
            <PersonCard
              key={e.id}
              employee={e}
              row={rows[e.id]}
              hours={week[e.id]}
              busy={busyId === e.id}
              canWrite={canWrite}
              fmtTime={fmtTime}
              onPunch={(type) => void punch(e.id, type)}
              onOpen={() => setOpenPerson(e)}
            />
          ))}
        </div>
      )}

      {openPerson && (
        <PersonSheet
          employee={openPerson}
          row={rows[openPerson.id]}
          day={day}
          canWrite={canWrite}
          timeZone={timeZone}
          fmtTime={fmtTime}
          onClose={() => setOpenPerson(null)}
          onChanged={() => void load(day)}
        />
      )}

      {sheet === "tablet" && (
        <SheetPopup
          onClose={() => setSheet(null)}
          title="The tablet by the door"
          subtitle="A screen that can only clock people in and out"
        >
          <AttendanceLock />
        </SheetPopup>
      )}

      {sheet === "markers" && (
        <SheetPopup
          onClose={() => setSheet(null)}
          title="What the markers mean"
          subtitle="Clock in → (break → resume) → clock out. Hours calculate themselves."
        >
          <AttendanceLegend />
        </SheetPopup>
      )}
    </div>
  );
}

/** One person, one card, one obvious next action.
 *
 *  The action is derived from where they are in the day rather than listed in
 *  full, so an impossible one is never on screen to be pressed. Tapping the
 *  card itself opens everything else about them — the buttons stop propagation
 *  so a punch never opens a sheet by accident.
 */
function PersonCard({
  employee,
  row,
  hours,
  busy,
  canWrite,
  fmtTime,
  onPunch,
  onOpen,
}: {
  employee: Employee;
  row?: AttendanceRow;
  hours?: number[];
  busy: boolean;
  canWrite: boolean;
  fmtTime: (iso: string | null) => string;
  onPunch: (type: string) => void;
  onOpen: () => void;
}) {
  const phase = phaseOf(row);

  const line = (() => {
    if (phase === "leave") return "Booked off — nobody to chase";
    if (phase === "out") {
      return row?.scheduled_start ? `Due ${row.scheduled_start}` : "No shift on the rota today";
    }
    const bits = [`in ${fmtTime(row?.clock_in ?? null)}`];
    if (row?.clock_out) bits.push(`out ${fmtTime(row.clock_out)}`);
    if (row?.break_minutes) bits.push(`${fmtBreak(row.break_minutes)} break`);
    return bits.join(" · ");
  })();

  const actions: { label: string; type: string; strong?: boolean }[] =
    phase === "out"
      ? [{ label: "Clock in", type: "CLOCK_IN", strong: true }]
      : phase === "working"
        ? [
            { label: "Break", type: "BREAK_START" },
            { label: "Clock out", type: "CLOCK_OUT", strong: true },
          ]
        : phase === "break"
          ? [{ label: "End break", type: "BREAK_END", strong: true }]
          : [];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onOpen();
        }
      }}
      data-testid="att-person"
      className="mise-card-inset mise-press flex cursor-pointer flex-col gap-2 rounded-2xl px-3.5 py-3 text-left transition hover:bg-glass/5"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-fg">{employee.full_name}</p>
          <p className="truncate text-[11px] text-fg-faint">{line}</p>
        </div>
        <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
      </div>

      {/* THE FIGURES, ON THE CARD.
          "you need to show major details in front page itself instead of clicks
           and seeing. nobody will like click and see... they prefer instant see
           the core details."
          In, out, break and hours were the old table's columns and they were
          right to be visible: they are what you SCAN. The sheet keeps what you
          only ever open one at a time — fixing a punch, booking leave, reading
          a month of history. */}
      <div className="grid grid-cols-4 gap-1 border-t border-line/60 pt-2">
        {[
          ["In", fmtTime(row?.clock_in ?? null) || "—"],
          ["Out", fmtTime(row?.clock_out ?? null) || "—"],
          ["Break", row?.break_minutes ? fmtBreak(row.break_minutes) : "—"],
          ["Hours", row?.working_hours ? fmtHours(Number(row.working_hours)) : "—"],
        ].map(([label, value], i) => (
          <div key={label} className="text-center">
            <p className="text-[9px] uppercase tracking-wide text-fg-faint">{label}</p>
            <p
              className={`tabular-nums ${
                i === 3 ? "text-sm font-semibold text-fg" : "text-xs text-fg-soft"
              }`}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {row?.over_break_minutes ? (
        <p className="rounded-lg bg-amber-500/10 px-2 py-1 text-[10px] text-amber-500">
          Break over-ran by {fmtBreak(row.over_break_minutes)}
        </p>
      ) : null}

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          {/* Seven days at a glance. Bars, not numbers: the question it answers
              is "is this normal for them", which is a shape, not a figure. */}
          {hours && hours.some((h) => h > 0) && (
            <div className="mt-1 flex h-4 items-end gap-0.5" aria-hidden>
              {hours.map((h, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-sm bg-brand-400/50"
                  style={{ height: `${Math.max(2, Math.min(16, (h / 10) * 16))}px` }}
                />
              ))}
            </div>
          )}
        </div>

        {canWrite && actions.length > 0 && (
          <div className="flex shrink-0 gap-1.5" onClick={(ev) => ev.stopPropagation()}>
            {actions.map((a) => (
              <button
                key={a.type}
                type="button"
                disabled={busy}
                onClick={() => onPunch(a.type)}
                data-tone={a.strong ? "brand" : undefined}
                data-testid={`punch-${a.type}`}
                className={`mise-btn-flat mise-press min-h-[38px] px-3 py-1.5 text-xs font-bold disabled:opacity-40 ${
                  a.strong ? "text-brand-300" : "text-fg-soft"
                }`}
              >
                {busy ? "…" : a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Everything else about one person: their day, a missed punch, leave, and the
 *  history that used to need its own panel at the top of the page. */
function PersonSheet({
  employee,
  row,
  day,
  canWrite,
  timeZone,
  fmtTime,
  onClose,
  onChanged,
}: {
  employee: Employee;
  row?: AttendanceRow;
  day: string;
  canWrite: boolean;
  timeZone: string;
  fmtTime: (iso: string | null) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { format } = useCurrency();
  const [tab, setTab] = useState<"day" | "history">("day");

  const toHHMM = useCallback(
    (iso: string | null | undefined): string =>
      iso
        ? new Date(iso).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone,
          })
        : "",
    [timeZone],
  );

  const [ci, setCi] = useState(() => toHHMM(row?.clock_in));
  const [co, setCo] = useState(() => toHHMM(row?.clock_out));
  const [brk, setBrk] = useState(String(row?.break_minutes ?? 0));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [hist, setHist] = useState<AttHistory | null>(null);
  // A range they choose, not three buttons I chose for them. The first cut of
  // this rewrite offered 7/30/90 and nothing else, which quietly removed the
  // From→to filter — "attendance we need historical datas too".
  const [range, setRange] = useState({ from: daysAgoISO(29), to: today() });
  const loadedFor = useRef<string>("");

  useEffect(() => {
    if (tab !== "history") return;
    const key = `${employee.id}:${range.from}:${range.to}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    setHist(null);
    api
      .get<AttHistory>(
        `/attendance/history/${employee.id}?date_from=${range.from}&date_to=${range.to}`,
      )
      .then(setHist)
      .catch(() => setHist(null));
  }, [tab, employee.id, range.from, range.to]);

  // The exact sum the server will do — (out − in, rolling past midnight) minus
  // the break — shown as you type, so the saved number is never a surprise.
  const previewMins = (() => {
    if (!ci || !co) return null;
    const [ih, im] = ci.split(":").map(Number);
    const [oh, om] = co.split(":").map(Number);
    let span2 = oh * 60 + om - (ih * 60 + im);
    if (span2 <= 0) span2 += 24 * 60;
    return Math.max(0, span2 - (parseInt(brk || "0", 10) || 0));
  })();
  const overnight = !!ci && !!co && co <= ci;

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await api.post("/attendance/edit", {
        employee_id: employee.id,
        date: day,
        clock_in: ci || null,
        clock_out: co || null,
        break_minutes: parseInt(brk || "0", 10) || 0,
      });
      onChanged();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save that");
    } finally {
      setSaving(false);
    }
  }

  const phase = phaseOf(row);

  return (
    <SheetPopup
      onClose={onClose}
      title={employee.full_name}
      subtitle={`${PHASE_LABEL[phase]} · ${new Date(day + "T00:00:00").toLocaleDateString(
        undefined,
        { weekday: "long", day: "numeric", month: "long" },
      )}`}
      columns={2}
    >
      <div className="space-y-4">
        <Segmented
          options={[
            { value: "day", label: "This day" },
            { value: "history", label: "History" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "day" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ["In", fmtTime(row?.clock_in ?? null)],
                ["Out", fmtTime(row?.clock_out ?? null)],
                ["Break", row?.break_minutes ? fmtBreak(row.break_minutes) : "—"],
              ].map(([label, value]) => (
                <div key={label} className="mise-well rounded-xl px-2 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</p>
                  <p className="text-sm font-semibold tabular-nums text-fg">{value || "—"}</p>
                </div>
              ))}
            </div>

            {row?.over_break_minutes ? (
              <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
                Break over-ran by {fmtBreak(row.over_break_minutes)} — {format(
                  Number(row.break_penalty || 0),
                )} deducted.
              </p>
            ) : null}

            {canWrite && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                  Fix or back-date
                </p>
                <p className="text-[11px] text-fg-faint">
                  For when somebody forgot to punch. Times are {timeZone}.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[11px] text-fg-faint">
                    In
                    <input
                      type="time"
                      value={ci}
                      onChange={(e) => setCi(e.target.value)}
                      data-testid="edit-in"
                      className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2 text-sm outline-none"
                    />
                  </label>
                  <label className="text-[11px] text-fg-faint">
                    Out
                    <input
                      type="time"
                      value={co}
                      onChange={(e) => setCo(e.target.value)}
                      data-testid="edit-out"
                      className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2 text-sm outline-none"
                    />
                  </label>
                  <label className="text-[11px] text-fg-faint">
                    Break (min)
                    <input
                      type="number"
                      min={0}
                      value={brk}
                      onChange={(e) => setBrk(e.target.value)}
                      className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2 text-sm outline-none"
                    />
                  </label>
                </div>

                {previewMins !== null && (
                  <p className="text-[11px] text-fg-faint">
                    That is{" "}
                    <span className="font-semibold text-fg">{fmtHours(previewMins / 60)}</span>{" "}
                    worked{overnight ? " — counted through midnight" : ""}.
                  </p>
                )}
                {err && <p className="text-[11px] text-rose-400">{err}</p>}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    data-tone="brand"
                    data-testid="edit-save"
                    className="mise-btn-flat mise-press min-h-[44px] flex-1 px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
                  >
                    {saving ? "Saving…" : "Save this day"}
                  </button>
                  <QuickLeave
                    employeeId={employee.id}
                    employeeName={employee.full_name}
                    day={day}
                    onBooked={() => {
                      onChanged();
                      onClose();
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <TimeRangePicker range={range} onChange={setRange} />
              <button
                type="button"
                onClick={() =>
                  void downloadFile(
                    `/attendance/history/${employee.id}.xlsx?date_from=${range.from}&date_to=${range.to}`,
                    `${employee.full_name}-attendance.xlsx`,
                  )
                }
                className="mise-btn-flat mise-press min-h-[36px] px-3 text-xs font-semibold text-fg-soft"
              >
                ↓ Excel
              </button>
            </div>

            {!hist ? (
              <p className="py-6 text-center text-sm text-fg-faint">Loading…</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["Present", String(hist.totals.present)],
                    ["Absent", String(hist.totals.absent)],
                    ["Hours", fmtHours(Number(hist.totals.total_hours || 0))],
                    ["Would earn", format(Number(hist.totals.indicative_pay || 0))],
                  ].map(([label, value]) => (
                    <div key={label} className="mise-well rounded-xl px-2 py-2.5 text-center">
                      <p className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</p>
                      <p className="text-sm font-semibold tabular-nums text-fg">{value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-fg-faint">
                  {hist.totals.basis} — indicative. The real, overlap-checked run
                  lives in{" "}
                  <Link href="/payroll" className="text-brand-400 underline">
                    Payroll
                  </Link>
                  .
                </p>

                <CalendarHeat
                  days={hist.days.map((d) => ({
                    date: d.date,
                    value: Number(d.working_hours ?? 0),
                  }))}
                  formatValue={(v) => fmtHours(v)}
                />

                <Bars
                  items={[
                    { label: "Present", value: hist.totals.present },
                    { label: "Half days", value: hist.totals.half_days },
                    { label: "Absent", value: hist.totals.absent },
                  ]}
                />

                <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                  {hist.days
                    .slice()
                    .reverse()
                    .map((d) => (
                      <div
                        key={d.date}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px]"
                      >
                        <span className="w-20 shrink-0 tabular-nums text-fg-faint">
                          {new Date(d.date + "T00:00:00").toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                        <span className="flex-1 truncate text-fg-soft">
                          {d.clock_in ? `${fmtTime(d.clock_in)} → ${fmtTime(d.clock_out)}` : "—"}
                          {d.no_punch ? " · marked present" : ""}
                        </span>
                        <span className="shrink-0 tabular-nums font-semibold text-fg">
                          {d.working_hours ? fmtHours(Number(d.working_hours)) : "—"}
                        </span>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </SheetPopup>
  );
}
