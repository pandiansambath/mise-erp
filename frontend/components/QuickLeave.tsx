"use client";

// Booking time off from the attendance sheet.
//
// Leave was only bookable on the Rota page, which is the wrong place for the
// commonest version of the job: it is 09:15, someone has phoned in sick, and
// you are looking at the attendance sheet with their empty row in front of you.
// Sending you to another page to record that — and then back — is how a day
// ends up marked ABSENT when the person was ill.
//
// The two pages are the same fact seen twice, so this writes to the same
// endpoint the rota uses. Book leave here and the rota stops scheduling them;
// book it there and this sheet stops calling them absent. Neither page owns it.
//
// A clash with shifts already rota'd does not block the booking — plans change,
// and the leave is the newer decision — but it is always SAID, because a rota
// still showing someone on holiday is worse than a refusal.

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Select } from "@/components/Select";

const KINDS = [
  { value: "ANNUAL", label: "Annual leave" },
  { value: "SICK", label: "Sick" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "OTHER", label: "Other" },
];

/** Fired after leave is booked or cancelled, so anything else on screen showing
 *  the same fact can re-read it rather than sit there stale. */
export const LEAVE_CHANGED = "mise:leave-changed";

export function QuickLeave({
  employeeId,
  employeeName,
  day,
  onBooked,
  className = "",
}: {
  employeeId: string;
  employeeName: string;
  /** The day being viewed — the leave defaults to it, which is right nearly
   *  every time somebody reaches for this button. */
  day: string;
  onBooked: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("SICK");
  const [from, setFrom] = useState(day);
  const [to, setTo] = useState(day);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(day);
    setTo(day);
  }, [open, day]);

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent) {
      if (!panel.current?.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  async function book() {
    setSaving(true);
    setError(null);
    setWarning(null);
    try {
      const res = await api.post<{ warning: string | null }>("/employees/leave", {
        employee_id: employeeId,
        start_date: from,
        end_date: to,
        kind,
        // Booked by a manager on the attendance sheet: it is a decision, not a
        // request. Only APPROVED leave stops the rota and attendance, so
        // anything less would look recorded while changing nothing.
        status: "APPROVED",
        reason: reason.trim() || null,
      });
      window.dispatchEvent(new CustomEvent(LEAVE_CHANGED));
      onBooked();
      if (res.warning) {
        // Keep the panel open: the clash needs reading, and closing it would
        // make the warning a flash nobody catches.
        setWarning(res.warning);
      } else {
        setOpen(false);
        setReason("");
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not book the leave.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Book time off for ${employeeName} — the rota will stop scheduling them`}
        className={className}
      >
        🌴 Leave
      </button>
      {open && (
        <div
          ref={panel}
          className="mise-pop absolute right-0 z-40 mt-1.5 w-72 rounded-xl border border-line bg-paper-2 p-3 text-left shadow-2xl shadow-black/40"
        >
          <p className="text-xs font-semibold text-fg">Time off — {employeeName}</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-fg-faint">
            Also removes them from the rota&apos;s expectations, so this sheet stops
            reading as absent.
          </p>
          <Select
            value={kind}
            onChange={setKind}
            options={KINDS}
            className="mt-2"
          />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] text-fg-faint">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mise-well mt-0.5 w-full rounded-lg px-2 py-1.5 text-xs outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-fg-faint">To</span>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="mise-well mt-0.5 w-full rounded-lg px-2 py-1.5 text-xs outline-none"
              />
            </label>
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="mise-well mt-2 w-full rounded-lg px-2 py-1.5 text-xs outline-none"
          />
          {warning && (
            <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[11px] leading-relaxed text-amber-300">
              ⚠ {warning}
            </p>
          )}
          {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={book}
              disabled={saving}
              className="mise-press rounded-lg border border-brand-400/40 bg-brand-400/10 px-2.5 py-1 text-[11px] font-medium text-brand-300 disabled:opacity-50"
            >
              {saving ? "Booking…" : warning ? "Book again" : "Book leave"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setWarning(null); }}
              className="rounded-lg px-2.5 py-1 text-[11px] text-fg-faint hover:text-fg"
            >
              {warning ? "Done" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

/** What every marker on the attendance sheet means.
 *
 *  Colour without a key is decoration. Green/amber/rose were carrying real
 *  information — chase this person, do not chase that one — and the only way to
 *  learn it was to guess. */
export function AttendanceLegend() {
  const items: { chip: React.ReactNode; label: string; hint: string }[] = [
    {
      chip: <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">Working</span>,
      label: "Clocked in",
      hint: "in the building now",
    },
    {
      chip: <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">On break</span>,
      label: "Break running",
      hint: "over-run is deducted",
    },
    {
      chip: <span className="rounded-full bg-glass/10 px-2 py-0.5 text-[10px] font-medium text-fg-soft">Clocked out</span>,
      label: "Day finished",
      hint: "hours are final",
    },
    {
      chip: <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">🌴 On leave</span>,
      label: "Booked off",
      hint: "not absent — nobody to chase",
    },
    {
      chip: <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300">Not in yet</span>,
      label: "Rota'd, no clock-in",
      hint: "this is the one to phone",
    },
    {
      chip: <span className="rounded-full border border-line-2 px-2 py-0.5 text-[10px] font-medium text-fg-faint">—</span>,
      label: "Not scheduled",
      hint: "no shift on the rota today",
    },
  ];
  return (
    <div className="mise-well mb-4 rounded-xl p-3">
      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
        What the markers mean
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {items.map((it) => (
          <span key={it.label} className="flex items-center gap-2">
            {it.chip}
            <span className="text-[11px] leading-tight text-fg-soft">
              {it.label}
              <span className="block text-[10px] text-fg-faint">{it.hint}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
