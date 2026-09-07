"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, downloadFile, postForm, type Employee, type LabourSummary, type Shift } from "@/lib/api";
import { PageMore, type PageAction } from "@/components/PageKit";
import { PageHeader, Spinner } from "@/components/ui";
import { SheetPopup } from "@/components/SheetPopup";
import { LeavePanel } from "@/components/LeavePanel";
import { LEAVE_CHANGED } from "@/components/QuickLeave";
import { RotaLegend } from "@/components/RotaLegend";
import { Bars } from "@/components/charts";
import { Select } from "@/components/Select";
import { InfoDot } from "@/components/InfoDot";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { localISODate as iso } from "@/lib/date";
import { numeric } from "@/lib/sanitize";
import { useDeepLink } from "@/components/fx";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The calendar day a column REPRESENTS, taken from the same fields the column
 *  prints.
 *
 * THE BUG THIS FIXES, which was not cosmetic. `localISODate` formats a Date in
 * the HOTEL's timezone — correct for "what day is it in the restaurant", and
 * wrong for "which day is this column". The headers print `d.getDate()`, which
 * is the BROWSER's day. For anybody east of London the two disagree: a column
 * labelled "Mon 7/9" had the identity 2026-09-06, because midnight on the 7th
 * in Kolkata is the evening of the 6th in London.
 *
 * So dragging a shift onto Monday filed it against Sunday. His undo ticket said
 * so in plain text — "Mohamed 2026-09-06 → 2026-09-07" — while the card sat
 * under a column headed 7/9. A rota that quietly stores a different day from
 * the one you dropped it on is worse than a rota that looks wrong.
 *
 * The label and the identity now come from the same three numbers. */
function dayKey(d: Date): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

/** Monday of the week containing `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const off = (x.getDay() + 6) % 7; // 0=Mon … 6=Sun
  x.setDate(x.getDate() - off);
  x.setHours(0, 0, 0, 0);
  return x;
}
const hhmm = (t: string) => t.slice(0, 5);
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
  // `localISODate` is right for this and only this: which calendar day the
  // restaurant is currently having.
  const hotelToday = iso(new Date());
  const from = dayKey(weekDates[0]);
  const to = dayKey(weekDates[6]);

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
  // Which sheet is open. Leave, copying, exports and the legend were four
  // permanent blocks above the week; they are jobs you do occasionally TO a
  // rota, and none of them earned a place above it.
  const [sheet, setSheet] = useState<null | "leave" | "copy" | "labour" | "legend">(null);
  const [addOpen, setAddOpen] = useState(false);
  // The move list stays collapsed unless asked for — see the comment on the
  // ticket strip.
  const [showMoves, setShowMoves] = useState(false);
  const [copyRows, setCopyRows] = useState<CopyRow[] | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copySource, setCopySource] = useState<Date | null>(null); // Monday of the source week
  const [copyConflict, setCopyConflict] = useState<"skip" | "replace">("skip");

  // ⌘K "Copy last week's rota" (?copy=1) → open the copy preview + spotlight it
  // ⌘K "Copy last week's rota" opens the sheet directly now — there is no
  // longer a block on the page to scroll to and flash.
  useDeepLink({ copy: () => { startCopy(); setSheet("copy"); } }, !loading);


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

  function openAdd(iso: string) {
    setDay(iso);
    setMsg(null);
    setAddOpen(true);
  }

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

  // ── Jira-style drag & drop: pick a shift card up, drop it on another day ──
  const [dragId, setDragId] = useState<string | null>(null);
  // ✏️ in-place shift editor: tap a name → edit times/break right there
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDay, setEditDay] = useState("");
  const [eStart, setEStart] = useState("");
  const [eEnd, setEEnd] = useState("");
  const [eBreak, setEBreak] = useState("0");
  const [eBusy, setEBusy] = useState(false);

  async function saveEdit(id: string) {
    setEBusy(true);
    try {
      await api.patch(`/rota/shifts/${id}`, {
        start_time: eStart, end_time: eEnd,
        break_minutes: parseInt(eBreak || "0", 10),
      });
      setEditId(null);
      setEditName("");
      await reload(); // fresh hours/cost come computed from the server
    } catch { /* keep the editor open so nothing is lost */ } finally {
      setEBusy(false);
    }
  }
  const [dropDay, setDropDay] = useState<string | null>(null);
  // Approved leave overlapping the visible week, by ISO day.
  const [leaveByDay, setLeaveByDay] = useState<Record<string, { name: string; kind: string }[]>>({});
  // Bumped when leave changes anywhere on the site, to re-run the fetch.
  const [leaveTick, setLeaveTick] = useState(0);
  // every drop stacks a move ticket: it PERSISTS until you keep or undo it,
  // each move can be undone on its own, Ctrl+Z pops the latest.
  type Move = {
    newId: string; name: string; fromDate: string; toDate: string;
    employee_id: string; start_time: string; end_time: string; break_minutes: number;
  };
  const [moves, setMoves] = useState<Move[]>([]);
  const movedIds = useMemo(() => new Set(moves.map((m) => m.newId)), [moves]);

  // A DROP THAT FIRED TWICE COULD NOT BE UNDONE ONCE.
  //
  //   "here i moved 1 member from today to next day but it got duplicated...
  //    then i clicked undo last, 1 undo done, duplicate stayed here itself,
  //    there is no undo."
  //
  // Two faults, one symptom.
  //
  // First, the move was a CREATE followed by a DELETE. Between those two calls
  // the shift exists on both days for real, on the server, and anything that
  // reads the rota in that window sees a duplicate. It is one PATCH now — the
  // row changes its date, and there is no in-between state to catch.
  //
  // Second, and this is the half that made it unrecoverable: `moves` was keyed
  // on a temporary id, and the undo only deleted the server row if that id had
  // already been swapped for a real one. Undo pressed too early therefore
  // restored the shift on the old day and left the new one standing, with its
  // ticket now gone — a duplicate with nothing left pointing at it. Hence "1
  // undo done, duplicate stayed, there is no undo". With a PATCH there is no
  // temporary id at all: the shift keeps the id it always had, so undo is just
  // the same PATCH pointing back the other way and it cannot arrive too early.
  //
  // `movingRef` is a ref rather than state on purpose. Two drop events inside
  // one gesture run in the same tick, so a state flag set by the first has not
  // rendered by the time the second reads it — the guard has to be a value
  // that changes the instant it is written.
  // ── THE WEEK CHECK ────────────────────────────────────────────────────────
  //
  //   "in this rota, just think any other creative feature that we can add...
  //    any other creative feature that will make the user feel comfortable and
  //    impressed."
  //
  // The page could already tell you what the week COSTS. It could not tell you
  // whether the week is any good — and those are different questions. A rota is
  // wrong long before it is expensive: a day with nobody on it, a person
  // rostered eleven days without a break, somebody quietly pushed past the
  // working-time limit. Every one of those is invisible in a grid of cards,
  // because seeing it means adding up a column in your head.
  //
  // Nothing new is fetched. All three answers are already sitting in `shifts`;
  // nobody had added them up. That is the feature: not more data, the same data
  // read the way a manager reads it.
  //
  // 48 hours is the UK Working Time Regulations weekly average. It is an
  // average over 17 weeks rather than a hard weekly cap, so this WARNS and
  // never blocks — a genuine 50-hour week during a festival is legal and
  // normal, and a rota tool that refuses to let you build one is a rota tool
  // people stop using. It is here because nobody notices it by accident.
  const weekCheck = useMemo(() => {
    // dayKey, not iso — the columns are keyed on the calendar day the header
    // prints, and mixing the two is what put "today" on Tuesday last time.
    const inWeek = shifts.filter((s) => s.date >= from && s.date <= to);

    const byPerson = new Map<string, { name: string; hours: number; days: Set<string> }>();
    for (const s of inWeek) {
      const cur = byPerson.get(s.employee_id) ?? {
        name: s.employee_name,
        hours: 0,
        days: new Set<string>(),
      };
      cur.hours += parseFloat(s.hours || "0") || 0;
      cur.days.add(s.date);
      byPerson.set(s.employee_id, cur);
    }

    const people = [...byPerson.values()].sort((a, b) => b.hours - a.hours);
    const longWeeks = people.filter((p) => p.hours > 48);
    // Six or seven days on is where a week stops having a day off in it.
    const noDayOff = people.filter((p) => p.days.size >= 6);
    const emptyDays = weekDates.filter(
      (d) =>
        inWeek.every((s) => s.date !== dayKey(d)) &&
        (leaveByDay[dayKey(d)] ?? []).length === 0,
    );

    return { people, longWeeks, noDayOff, emptyDays };
  }, [shifts, weekDates, from, to, leaveByDay]);

  const movingRef = useRef<Set<string>>(new Set());

  function moveShift(id: string | null, targetDate: string) {
    setDropDay(null);
    setDragId(null);
    if (!id || movingRef.current.has(id)) return;
    const sh = shifts.find((x) => x.id === id);
    if (!sh || sh.date === targetDate) return;
    movingRef.current.add(id);
    const fromDate = sh.date;

    // INSTANT: the card lands and the ticket appears in the same frame; the
    // server settles behind it.
    setShifts((list) => list.map((x) => (x.id === id ? { ...x, date: targetDate } : x)));
    setMoves((list) => [
      ...list,
      {
        newId: id, name: sh.employee_name, fromDate, toDate: targetDate,
        employee_id: sh.employee_id, start_time: sh.start_time, end_time: sh.end_time,
        break_minutes: sh.break_minutes,
      },
    ]);
    setRedos([]); // a fresh move ends the redo trail, as it does in every editor

    (async () => {
      try {
        await api.patch(`/rota/shifts/${id}`, { date: targetDate });
        reload().catch(() => {}); // labour totals refresh quietly
      } catch (err) {
        setShifts((list) => list.map((x) => (x.id === id ? { ...x, date: fromDate } : x)));
        setMoves((list) => list.filter((m) => m.newId !== id));
        setMsg(err instanceof ApiError ? err.message : "Could not move the shift");
      } finally {
        movingRef.current.delete(id);
      }
    })();
  }

  // "i also need ctrl y to redo, both i want."
  // An undo you cannot take back is only half a safety net — you hesitate over
  // the undo instead of the move. Undone moves land here in the order they were
  // undone, and redo replays the newest.
  const [redos, setRedos] = useState<Move[]>([]);

  const undoMove = useCallback((m: Move) => {
    // INSTANT: the ticket goes, the card slides home, the server follows.
    setMoves((list) => list.filter((x) => x.newId !== m.newId));
    setShifts((list) => list.map((x) => (x.id === m.newId ? { ...x, date: m.fromDate } : x)));
    setRedos((list) => [...list, m]);
    (async () => {
      try {
        await api.patch(`/rota/shifts/${m.newId}`, { date: m.fromDate });
        reload().catch(() => {});
      } catch (err) {
        setMsg(err instanceof ApiError ? err.message : "Could not undo the move");
        setRedos((list) => list.filter((x) => x.newId !== m.newId));
        reload().catch(() => {});
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const redoMove = useCallback((m: Move) => {
    setRedos((list) => list.filter((x) => x.newId !== m.newId));
    setShifts((list) => list.map((x) => (x.id === m.newId ? { ...x, date: m.toDate } : x)));
    setMoves((list) => [...list, m]);
    (async () => {
      try {
        await api.patch(`/rota/shifts/${m.newId}`, { date: m.toDate });
        reload().catch(() => {});
      } catch (err) {
        setMsg(err instanceof ApiError ? err.message : "Could not redo the move");
        setMoves((list) => list.filter((x) => x.newId !== m.newId));
        reload().catch(() => {});
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "ctrl z to undo working, but i also need ctrl y to redo, both i want."
  //
  // Ctrl+Y is the Windows spelling and he is on Windows, so that is the one
  // that had to work. Ctrl+Shift+Z is bound too, because it is the same key
  // everywhere else and someone reaching for it should not find nothing.
  //
  // The handler no longer bails when there are no move tickets — there can be
  // a redo waiting with the undo list empty, which is exactly the state you are
  // in the moment after undoing your only move. Typing where text goes is left
  // alone: Ctrl+Z in the notes box has to mean what it means in every box.
  useEffect(() => {
    if (moves.length === 0 && redos.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        if (moves.length === 0) return;
        e.preventDefault();
        undoMove(moves[moves.length - 1]);
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        if (redos.length === 0) return;
        e.preventDefault();
        redoMove(redos[redos.length - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moves, redos, undoMove, redoMove]);

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


  // Approved leave across the visible week. Keyed off the week's two ISO
  // strings, which are already derived once — no callback to memoise, and
  // nothing that changes identity on every render.
  useEffect(() => {
    let cancelled = false;
    api
      .get<
        { employee_name: string; start_date: string; end_date: string; kind: string; status: string }[]
      >(`/employees/leave/list?date_from=${from}&date_to=${to}`)
      .then((rows) => {
        if (cancelled) return;
        const map: Record<string, { name: string; kind: string }[]> = {};
        for (const lv of rows) {
          // Only approved leave stops anything — a request nobody agreed to is
          // not yet a fact about the world.
          if (lv.status !== "APPROVED") continue;
          for (let i = 0; i < 7; i++) {
            const d = new Date(`${from}T12:00:00`);
            d.setDate(d.getDate() + i);
            const day = iso(d);
            if (day >= lv.start_date && day <= lv.end_date) {
              (map[day] ??= []).push({ name: lv.employee_name, kind: lv.kind });
            }
          }
        }
        setLeaveByDay(map);
      })
      .catch(() => {
        if (!cancelled) setLeaveByDay({});
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, leaveTick]);

  useEffect(() => {
    // Leave booked from the attendance sheet is the same fact seen twice, so
    // this page re-reads rather than sitting there stale.
    const onChanged = () => setLeaveTick((n) => n + 1);
    window.addEventListener(LEAVE_CHANGED, onChanged);
    return () => window.removeEventListener(LEAVE_CHANGED, onChanged);
  }, []);

  if (loading && !labour) return <Spinner />;

  // Day columns always sort by START TIME (ties: name) — a dropped shift slots
  // into its time position, and no other card ever appears to jump.
  const byDay = (d: Date) =>
    shifts
      .filter((s) => s.date === dayKey(d))
      .sort((a, b) => a.start_time.localeCompare(b.start_time) || a.employee_name.localeCompare(b.employee_name));
  const labourTone =
    !labour || parseFloat(labour.net_sales) <= 0
      ? "text-fg"
      : parseFloat(labour.labour_pct) <= 30
        ? "text-brand-400"
        : parseFloat(labour.labour_pct) <= 35
          ? "text-amber-400"
          : "text-rose-400";


  // WHAT CHANGED HERE, and why.
  //
  // Measured before touching it: the week grid — the entire point of the page —
  // began about 900px down, under a tab strip that only scrolled, a permanently
  // open Leave panel, six export buttons and an inline five-field form. And the
  // strip was a horizontal scroller of 170px columns, so on a normal window
  // Saturday and Sunday were simply off the right-hand edge. A week you cannot
  // see the end of is not a week.
  //
  // Now: one row saying which week and what it costs, then the seven days. The
  // grid gives every day a column that fits, so the week ends where the week
  // ends. Leave, copying, exports, the import and the legend are all still here
  // — behind ⋯, because they are jobs you do occasionally TO the rota, and none
  // of them earned a permanent place above it.
  //
  // Adding a shift moved onto the day itself. A form with a day dropdown asks
  // you to say in a field what you already said by looking at Thursday.
  const more: PageAction[] = [
    { key: "leave", label: "Leave", icon: "🌴", hint: "Book time off — the rota then refuses to schedule them", onSelect: () => setSheet("leave") },
    { key: "copy", label: "Copy a week across", icon: "⧉", hint: "Bring a past week onto this one, edit before applying", onSelect: () => { startCopy(); setSheet("copy"); } },
    { key: "labour", label: "Labour by person", icon: "💷", onSelect: () => setSheet("labour") },
    { key: "xlsx", label: "This week (Excel)", icon: "📊", onSelect: () => void downloadFile(`/rota/export.xlsx?date_from=${from}&date_to=${to}`, `mise-rota-${from}.xlsx`) },
    { key: "pdf", label: "This week (PDF)", icon: "📄", onSelect: () => void downloadFile(`/rota/export.pdf?date_from=${from}&date_to=${to}`, `mise-rota-${from}.pdf`) },
    { key: "tmpl", label: "Blank grid (Excel)", icon: "📋", hint: "Fill it in away from the screen, then upload it", onSelect: () => void downloadFile(`/rota/template.xlsx?date_from=${from}&date_to=${to}`, "mise-rota-template.xlsx") },
    { key: "csv", label: "Blank grid (CSV)", icon: "📋", onSelect: () => void downloadFile(`/rota/template.csv?date_from=${from}&date_to=${to}`, "mise-rota-template.csv") },
    { key: "upload", label: importing ? "Reading the file…" : "Upload a filled grid", icon: "⬆️", tone: "brand", onSelect: () => importInput.current?.click() },
    { key: "legend", label: "What you are looking at", icon: "🔑", onSelect: () => setSheet("legend") },
  ];

  return (
    // The week is a board, so it should occupy the board's worth of space.
    // Left to size itself it sat in the top third of a laptop screen with a
    // blank half underneath — which is what "clumsy" looks like when nothing
    // is actually wrong: seven short boxes floating above nothing.
    <div className="min-h-0">
      <PageHeader
        title="Rota"
        subtitle="Who is working this week, and what it costs."
        actions={
          <div className="flex items-center gap-2">
            {canWrite && (
              <>
                <button
                  type="button"
                  onClick={() => openAdd(from)}
                  data-tone="brand"
                  data-testid="rota-add"
                  className="mise-btn-flat mise-press min-h-[40px] px-4 py-2 text-sm font-bold text-brand-300"
                >
                  ＋ Add shift
                </button>
                {/* "that copy any week's rota feature button — try to place
                    somewhere here instead of keeping in more." Fair: filling
                    next week from last week is the single most common thing
                    anybody does on this page, and it was two taps into a menu. */}
                <button
                  type="button"
                  onClick={() => {
                    startCopy();
                    setSheet("copy");
                  }}
                  data-testid="rota-copy-week"
                  className="mise-btn-flat mise-press min-h-[40px] px-4 py-2 text-sm font-semibold text-fg-soft"
                >
                  ⧉ Copy a week
                </button>
              </>
            )}
            <PageMore actions={more} title="Rota" subtitle="Leave, copying, exports" />
          </div>
        }
      />

      {/* THE ONLY ROW ABOVE THE WEEK: which week, and what it costs. */}
      <div className="mise-card-inset mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-3 py-2.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
            className="mise-btn-flat mise-press grid h-9 w-9 place-items-center text-fg-soft"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setWeekStart(mondayOf(new Date()))}
            title="Back to this week"
            data-testid="rota-week-label"
            className="mise-press min-w-[11rem] rounded-lg px-2 py-1 text-sm font-semibold text-fg"
          >
            {weekDates[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} –{" "}
            {weekDates[6].toLocaleDateString(undefined, { day: "numeric", month: "short" })}
          </button>
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
            className="mise-btn-flat mise-press grid h-9 w-9 place-items-center text-fg-soft"
          >
            ›
          </button>
        </div>

        {labour && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="tabular-nums text-fg-soft">
              <span className="font-semibold text-fg">{labour.total_hours}h</span> scheduled
            </span>
            <span className="tabular-nums text-fg-soft">
              <span className="font-semibold text-fg">{format(labour.total_cost)}</span> labour
            </span>
            {/* The number the whole page exists to move. Amber and red are not
                decoration: past 30% of sales, a rota is a problem. */}
            {parseFloat(labour.net_sales) > 0 ? (
              <span className={`font-semibold tabular-nums ${labourTone}`}>
                {labour.labour_pct}% of sales
              </span>
            ) : (
              <span className="text-[11px] text-fg-faint">no sales booked for this week yet</span>
            )}
          </div>
        )}
      </div>

      {/* ── WHAT THE COST ROW COULD NOT TELL YOU ─────────────────────────────
          The row above says what the week COSTS. This says whether the week is
          any GOOD, and those are different questions — a rota is wrong long
          before it is expensive.

          It only appears when there is something to say. A quiet week draws
          nothing, because a panel that says "all fine" every day is a panel
          people stop reading, and then it is not there on the day it matters. */}
      {(weekCheck.longWeeks.length > 0 ||
        weekCheck.noDayOff.length > 0 ||
        weekCheck.emptyDays.length > 0) && (
        <div className="mise-card-inset mb-3 rounded-2xl px-3 py-2.5" data-testid="rota-check">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span className="font-semibold text-fg">Worth a look</span>

            {weekCheck.emptyDays.length > 0 && (
              <span className="text-fg-soft">
                <b className="text-fg">Nobody on</b>{" "}
                {weekCheck.emptyDays
                  .map((d) => d.toLocaleDateString(undefined, { weekday: "short" }))
                  .join(", ")}
                <InfoDot label="Why a day with nobody on it is flagged">
                  These days have no shifts and nobody on booked leave. Usually it means the
                  rota is unfinished — but if you are closed that day, it is right, and you
                  can ignore it.
                </InfoDot>
              </span>
            )}

            {weekCheck.longWeeks.length > 0 && (
              <span className="text-danger">
                <b>Over 48h:</b>{" "}
                {weekCheck.longWeeks.map((p) => `${p.name} (${p.hours.toFixed(1)}h)`).join(", ")}
                <InfoDot label="Why 48 hours is flagged">
                  <b className="text-fg">The UK working-time limit is 48 hours a week</b>,
                  averaged over 17 weeks — so a single long week during a festival is legal
                  and normal. This is a nudge, not a block: nobody notices it by accident,
                  and the average is built one week at a time.
                </InfoDot>
              </span>
            )}

            {weekCheck.noDayOff.length > 0 && (
              <span className="text-fg-soft">
                <b className="text-fg">No day off:</b>{" "}
                {weekCheck.noDayOff.map((p) => p.name).join(", ")}
                <InfoDot label="Why six days on is flagged">
                  Six or seven days on is a week without a day off in it. Legal, and worth
                  seeing before the rota goes up rather than after somebody reads it.
                </InfoDot>
              </span>
            )}
          </div>
        </div>
      )}

      {msg && (
        <p className="mb-3 rounded-xl bg-glass/10 px-3 py-2 text-sm text-fg-soft" role="status">
          {msg}
        </p>
      )}

      {/* ONE LINE, NOT A PILE.
          "that undo feature is coming one by one which will drag the card too
           much — suppose we moving so many cards, we need to make something
           here to handle the ui for pile uping undo."
          Right: six moves pushed the week off the screen, and the thing you
          were looking at is the week. It is one line now — how many, undo the
          last, or keep them all — and the full list opens if you want it.
          Nobody needs to read six tickets; they need to undo the one they just
          got wrong. */}
      {(moves.length > 0 || redos.length > 0) && (
        <div className="mise-card-inset mb-3 rounded-2xl px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-fg">
              {moves.length === 0
                ? "Move undone"
                : moves.length === 1
                  ? "1 shift moved"
                  : `${moves.length} shifts moved`}
            </span>
            {moves.length > 0 && (
              <button
                type="button"
                onClick={() => undoMove(moves[moves.length - 1])}
                data-testid="rota-undo"
                className="mise-btn-flat mise-press min-h-[32px] px-3 text-xs font-semibold text-fg-soft"
              >
                ↶ Undo last
              </button>
            )}
            {redos.length > 0 && (
              <button
                type="button"
                onClick={() => redoMove(redos[redos.length - 1])}
                data-testid="rota-redo"
                className="mise-btn-flat mise-press min-h-[32px] px-3 text-xs font-semibold text-fg-soft"
              >
                ↷ Redo
              </button>
            )}
            {moves.length > 1 && (
              <button
                type="button"
                onClick={() => setShowMoves((v) => !v)}
                data-testid="moves-toggle"
                className="mise-press text-xs font-medium text-brand-300 underline underline-offset-2"
              >
                {showMoves ? "hide" : `see all ${moves.length}`}
              </button>
            )}
            <span className="text-[11px] text-fg-faint">Ctrl+Z undo · Ctrl+Y redo</span>
            <button
              type="button"
              onClick={() => {
                setMoves([]);
                setRedos([]);
                setShowMoves(false);
              }}
              data-tone="brand"
              className="mise-btn-flat mise-press ml-auto min-h-[32px] px-3 text-xs font-semibold"
            >
              {moves.length === 0 ? "Dismiss ✓" : "Keep all ✓"}
            </button>
          </div>

          {showMoves && (
            <ul className="mise-noscrollbar mt-2 max-h-32 space-y-1 overflow-y-auto border-t border-line/60 pt-2">
              {moves.map((m) => (
                <li key={m.newId} className="flex items-center gap-2 text-[11px] text-fg-soft">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-fg">{m.name}</span> {m.fromDate} → {m.toDate}
                  </span>
                  <button
                    type="button"
                    onClick={() => undoMove(m)}
                    className="mise-btn-flat mise-press min-h-[28px] shrink-0 px-2 text-[11px] text-fg-soft"
                  >
                    Undo
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* THE WEEK. Seven columns on a laptop, so the week ends on screen; seven
          stacked bands on a phone, because 55px columns are not a rota. */}
      <div
        className="grid gap-2 overflow-visible lg:grid-cols-7 lg:items-start"
        data-testid="rota-week"
      >
        {weekDates.map((d, i) => {
          const dayShifts = byDay(d);
          // The restaurant's today, not the browser's — a kitchen in London
          // is still on Monday while a phone in Kolkata has ticked over. But
          // compared against the column's own label, so the two cannot drift.
          const isToday = dayKey(d) === hotelToday;
          const onLeave = leaveByDay[dayKey(d)] ?? [];
          return (
            <div
              key={i}
              onDragOver={(e: React.DragEvent) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dropDay !== dayKey(d)) setDropDay(dayKey(d));
              }}
              onDragLeave={() => setDropDay((cur) => (cur === dayKey(d) ? null : cur))}
              onDrop={(e: React.DragEvent) => {
                e.preventDefault();
                moveShift(dragId, dayKey(d));
              }}
              data-testid="rota-day"
              // A DAY GROWS DOWNWARDS, it does not scroll.
              // "if i add more than 5 members means its in the card itself giving
              //  scroll which is very tight to scroll and check."
              // A scroll box inside a grid cell is the worst of both: you cannot see
              // the day, and you cannot drop onto the part you cannot see. The row
              // is sized by its fullest day now, and the PAGE scrolls if a week is
              // genuinely busy — which is a thing people already know how to do.
              className={`mise-card-inset flex min-h-[7rem] flex-col rounded-2xl p-2 transition-all duration-150 ${
                isToday ? "ring-1 ring-brand-500/40" : ""
              } ${dropDay === dayKey(d) ? "bg-brand-400/5 ring-2 ring-brand-400/60" : ""}`}
            >
              <div className="mb-1.5 flex items-baseline justify-between gap-1">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                  {DAYS[i]}{" "}
                  <span className="font-normal text-fg-faint">
                    {d.getDate()}/{d.getMonth() + 1}
                  </span>
                  {/* A ring around a column is a hint you have to know how to
                      read. The word is not. */}
                  {isToday && (
                    <span className="rounded-full bg-brand-600 px-1.5 py-px text-[9px] font-bold text-white">
                      today
                    </span>
                  )}
                </p>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => openAdd(dayKey(d))}
                    aria-label={`Add a shift on ${DAYS[i]}`}
                    title="Add a shift on this day"
                    // 24x24 was below the size a thumb can reliably hit — the audit found
                    // eight of these on one screen. A wet hand in a kitchen needs 32.
                    className="mise-press grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base text-fg-faint hover:bg-glass/10 hover:text-brand-300"
                  >
                    ＋
                  </button>
                ) : (
                  dayShifts.length > 0 && (
                    <span className="text-[10px] text-fg-faint">{dayShifts.length}</span>
                  )
                )}
              </div>

              {onLeave.length > 0 && (
                <ul className="mb-1.5 space-y-1">
                  {onLeave.map((lv) => (
                    <li
                      key={lv.name}
                      title={`${lv.name} is on approved ${lv.kind.toLowerCase()} leave — they cannot be rota'd`}
                      className="flex items-center gap-1.5 rounded-lg border border-sky-400/25 bg-sky-400/[0.08] px-1.5 py-1 text-[10px] text-sky-300"
                    >
                      <span aria-hidden>🌴</span>
                      <span className="min-w-0 flex-1 truncate">{lv.name}</span>
                    </li>
                  ))}
                </ul>
              )}

              {dayShifts.length === 0 ? (
                // An em-dash is a shrug. A day with nobody on it is the most
                // common thing you came here to change, so it offers the change
                // rather than reporting the absence.
                canWrite ? (
                  <button
                    type="button"
                    onClick={() => openAdd(dayKey(d))}
                    className="mise-press flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line py-4 text-[11px] text-fg-faint transition hover:border-brand-400/50 hover:text-brand-300"
                  >
                    <span aria-hidden className="text-base leading-none">＋</span>
                    Add a shift
                  </button>
                ) : (
                  <p className="flex-1 py-3 text-center text-[11px] text-fg-faint">
                    Nobody on
                  </p>
                )
              ) : (
                <ul className="space-y-1">
                  {dayShifts.map((s) => (
                    <li
                      key={s.id}
                      draggable={canWrite}
                      onDragStart={(e) => {
                        setDragId(s.id);
                        e.dataTransfer.setData("text/plain", s.id);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropDay(null);
                      }}
                      title={canWrite ? "Drag onto another day to move this shift" : undefined}
                      className={`mise-well relative rounded-lg p-1.5 text-[11px] ${
                        canWrite ? "cursor-grab active:cursor-grabbing" : ""
                      } ${dragId === s.id ? "opacity-40 ring-1 ring-brand-400/50" : ""} ${
                        movedIds.has(s.id) ? "mise-moved-glow" : ""
                      }`}
                    >
                      {movedIds.has(s.id) && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-copper-500 px-1 py-0.5 text-[8px] font-bold text-white shadow">
                          moved
                        </span>
                      )}
                      <div className="flex items-start justify-between gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            if (!canWrite) return;
                            setEditId(s.id);
                            setEditName(s.employee_name);
                            setEditDay(s.date);
                            setEStart(s.start_time.slice(0, 5));
                            setEEnd(s.end_time.slice(0, 5));
                            setEBreak(String(s.break_minutes ?? 0));
                          }}
                          data-testid="rota-shift"
                          className="min-w-0 flex-1 text-left font-medium text-fg"
                        >
                          <span className="block truncate">{s.employee_name}</span>
                        </button>
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => removeShift(s.id)}
                            aria-label={`Remove ${s.employee_name}'s shift`}
                            className="shrink-0 text-fg-faint hover:text-rose-300"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div className="text-fg-soft">
                        {hhmm(s.start_time)}–{hhmm(s.end_time)}
                        {s.break_minutes > 0 && (
                          <span className="text-fg-faint"> · {s.break_minutes}m</span>
                        )}
                      </div>
                      <div className="text-fg-faint">
                        {s.hours}h · {format(s.cost)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {canWrite && (
        <p className="mt-2 text-[11px] text-fg-faint">
          Drag any shift onto another day to move it — Ctrl+Z puts it back, Ctrl+Y brings it forward again.
        </p>
      )}

      <input
        ref={importInput}
        type="file"
        accept=".xlsx,.csv"
        className="hidden"
        onChange={onImportRota}
      />

      {/* ── Add a shift, already knowing which day ──────────────────────── */}
      {addOpen && (
        <SheetPopup
          onClose={() => setAddOpen(false)}
          title="Add a shift"
          subtitle={new Date(day + "T00:00:00").toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        >
          <form
            onSubmit={(e) => {
              void addShift(e);
            }}
            className="space-y-3"
          >
            <label className="block text-[11px] text-fg-faint">
              Who
              <Select
                value={emp}
                onChange={setEmp}
                options={[
                  { value: "", label: "Choose…" },
                  ...employees.map((e) => ({ value: e.id, label: e.full_name })),
                ]}
              />
            </label>
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-[11px] text-fg-faint">
                Start
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  data-testid="shift-start"
                  className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2 text-sm outline-none"
                />
              </label>
              <label className="block text-[11px] text-fg-faint">
                End
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  data-testid="shift-end"
                  className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2 text-sm outline-none"
                />
              </label>
              <label className="block text-[11px] text-fg-faint">
                Break (min)
                <input
                  inputMode="numeric"
                  value={brk}
                  onChange={(e) => setBrk(numeric(e.target.value))}
                  className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2 text-sm outline-none"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy}
              data-tone="brand"
              data-testid="shift-save"
              className="mise-btn-flat mise-press min-h-[46px] w-full px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
            >
              {busy ? "Adding…" : "Add shift"}
            </button>
          </form>
        </SheetPopup>
      )}

      {/* ── the shift editor ────────────────────────────────────────────── */}
      {editId && (
        <SheetPopup
          onClose={() => setEditId(null)}
          title={editName}
          subtitle={new Date(editDay + "T00:00:00").toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <label className="block text-[11px] text-fg-faint">
                Start
                <input
                  type="time"
                  value={eStart}
                  onChange={(e) => setEStart(e.target.value)}
                  data-testid="edit-start"
                  className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2 text-sm outline-none"
                />
              </label>
              <label className="block text-[11px] text-fg-faint">
                End
                <input
                  type="time"
                  value={eEnd}
                  onChange={(e) => setEEnd(e.target.value)}
                  className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2 text-sm outline-none"
                />
              </label>
              <label className="block text-[11px] text-fg-faint">
                Break (min)
                <input
                  inputMode="numeric"
                  value={eBreak}
                  onChange={(e) => setEBreak(numeric(e.target.value))}
                  className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2 text-sm outline-none"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => void saveEdit(editId)}
              disabled={eBusy}
              data-tone="brand"
              data-testid="edit-shift-save"
              className="mise-btn-flat mise-press min-h-[46px] w-full px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
            >
              {eBusy ? "Saving…" : "Save shift"}
            </button>
          </div>
        </SheetPopup>
      )}

      {/* ── leave ───────────────────────────────────────────────────────── */}
      {sheet === "leave" && (
        <SheetPopup
          onClose={() => setSheet(null)}
          title="Leave"
          subtitle="The rota refuses to schedule anyone on approved leave, and says until when."
          columns={2}
        >
          <LeavePanel
            employees={employees}
            canWrite={canWrite}
            onChanged={() => {
              reload().catch(() => {});
            }}
          />
        </SheetPopup>
      )}

      {/* ── copy a week across ──────────────────────────────────────────── */}
      {sheet === "copy" && (
        <SheetPopup
          onClose={() => {
            setSheet(null);
            setCopyRows(null);
            setCopySource(null);
          }}
          title="Copy a week across"
          subtitle="Edit anything before it lands — nothing is written until you apply."
          columns={3}
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => stepCopySource(-1)}
                className="mise-btn-flat mise-press min-h-[36px] px-3 text-sm"
              >
                ‹ earlier
              </button>
              <span className="text-sm font-semibold text-fg">
                {copySource
                  ? `week of ${copySource.toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}`
                  : "…"}
              </span>
              <button
                type="button"
                onClick={() => stepCopySource(1)}
                disabled={!canStepLater}
                className="mise-btn-flat mise-press min-h-[36px] px-3 text-sm disabled:opacity-40"
              >
                later ›
              </button>
            </div>

            {copyRows === null ? (
              <p className="py-6 text-center text-sm text-fg-faint">Loading that week…</p>
            ) : copyRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-faint">
                Nothing was scheduled that week.
              </p>
            ) : (
              <>
                {copyClashes > 0 && (
                  <div className="mise-well rounded-xl px-3 py-2">
                    <p className="text-[11px] text-fg-soft">
                      {copyClashes} of these clash with a shift already on this week.
                    </p>
                    <div className="mt-1.5 flex gap-2">
                      {(["skip", "replace"] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setCopyConflict(mode)}
                          className={`mise-press min-h-[32px] rounded-lg px-3 text-[11px] font-semibold ${
                            copyConflict === mode
                              ? "bg-brand-600 text-white"
                              : "text-fg-soft hover:text-fg"
                          }`}
                        >
                          {mode === "skip" ? "Leave those alone" : "Replace them"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                  {copyRows.map((r, i) => (
                    <div
                      key={`${r.employee_id}-${i}`}
                      className="mise-well flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">
                        {r.employee_name}
                      </span>
                      <input
                        type="date"
                        value={r.date}
                        onChange={(e) => updateCopyRow(i, { date: e.target.value })}
                        className="mise-well min-h-[34px] rounded-md px-1.5 text-[11px] outline-none"
                      />
                      <input
                        type="time"
                        value={r.start_time}
                        onChange={(e) => updateCopyRow(i, { start_time: e.target.value })}
                        className="mise-well min-h-[34px] rounded-md px-1.5 text-[11px] outline-none"
                      />
                      <input
                        type="time"
                        value={r.end_time}
                        onChange={(e) => updateCopyRow(i, { end_time: e.target.value })}
                        className="mise-well min-h-[34px] rounded-md px-1.5 text-[11px] outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setCopyRows((rows) => rows && rows.filter((_, k) => k !== i))}
                        aria-label="Drop this one"
                        className="shrink-0 text-fg-faint hover:text-rose-300"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void applyCopy()}
                  disabled={copyBusy}
                  data-tone="brand"
                  data-testid="copy-apply"
                  className="mise-btn-flat mise-press min-h-[46px] w-full px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
                >
                  {copyBusy ? "Copying…" : `Copy ${copyRows.length} onto this week`}
                </button>
              </>
            )}
          </div>
        </SheetPopup>
      )}

      {/* ── labour by person ────────────────────────────────────────────── */}
      {sheet === "labour" && (
        <SheetPopup
          onClose={() => setSheet(null)}
          title="Labour by person"
          subtitle="This week, scheduled"
          columns={2}
        >
          {labour && labour.by_employee.length > 0 ? (
            <Bars
              items={labour.by_employee.map((b) => ({
                label: b.employee_name,
                value: parseFloat(b.cost),
              }))}
              formatValue={(v) => format(v)}
            />
          ) : (
            <p className="py-6 text-center text-sm text-fg-faint">
              Nothing scheduled this week yet.
            </p>
          )}
        </SheetPopup>
      )}

      {/* ── legend ──────────────────────────────────────────────────────── */}
      {sheet === "legend" && (
        <SheetPopup
          onClose={() => setSheet(null)}
          title="What you are looking at"
          subtitle="Rota and Attendance are the same fact seen twice."
          columns={2}
        >
          <RotaLegend />
        </SheetPopup>
      )}
    </div>
  );
}
