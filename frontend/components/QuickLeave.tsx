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

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Select } from "@/components/Select";
import { SheetPopup } from "@/components/SheetPopup";

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
  depth = 1,
}: {
  employeeId: string;
  employeeName: string;
  /** The day being viewed — the leave defaults to it, which is right nearly
   *  every time somebody reaches for this button. */
  day: string;
  onBooked: () => void;
  className?: string;
  /** 2 when this button lives inside another sheet, so the leave popup stacks
   *  over it instead of fighting it for the same layer. */
  depth?: 1 | 2;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("SICK");
  const [from, setFrom] = useState(day);
  const [to, setTo] = useState(day);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFrom(day);
    setTo(day);
  }, [open, day]);

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

  // A PANEL HANGING OFF A BUTTON, INSIDE A SHEET THAT CANNOT GROW.
  //
  //   "that leave — if i click leave see what happening, its opening inside
  //    that area which making a scroll bar appear... better keep as a section
  //    or separate popup... here there is no back option... also this popup is
  //    small."
  //
  // All one fault. This was an `absolute` dropdown 288px wide, anchored to its
  // button — and its button sits at the bottom of a popup whose body is
  // `overflow-y: auto`. An absolutely positioned child still counts towards its
  // scroll container's content, so opening the panel grew the scroll height of
  // the sheet it was sitting in and a scrollbar appeared under it. Two date
  // fields and a reason box then had 288px to live in, which is why it read as
  // cramped.
  //
  // It is its own popup now, stacked over the sheet that opened it. It gets the
  // width it needs, it cannot affect anything below it, and ← puts you back on
  // the person you were looking at rather than on the page behind them.
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Book time off for ${employeeName} — the rota will stop scheduling them`}
        className={className}
      >
        🌴 Leave
      </button>
      {open && (
        <SheetPopup
          depth={depth}
          columns={2}
          onClose={() => {
            setOpen(false);
            setWarning(null);
          }}
          onBack={
            depth === 2
              ? () => {
                  setOpen(false);
                  setWarning(null);
                }
              : undefined
          }
          title="Book time off"
          subtitle={employeeName}
          footer={
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={book}
                disabled={saving}
                data-tone="brand"
                data-testid="leave-book"
                className="mise-btn-flat mise-press min-h-[44px] flex-1 px-4 text-sm font-bold text-brand-300 disabled:opacity-40"
              >
                {saving ? "Booking…" : warning ? "Book it anyway" : "Book leave"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setWarning(null);
                }}
                className="mise-btn-flat mise-press min-h-[44px] px-4 text-sm font-semibold text-fg-soft"
              >
                {warning ? "Done" : "Cancel"}
              </button>
            </div>
          }
        >
          <div className="space-y-3.5">
            <p className="text-sm text-fg-soft">
              This also removes them from the rota&apos;s expectations, so the attendance
              sheet stops reading as absent.
            </p>

            <section className="mise-card-inset rounded-2xl p-3.5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
                What kind
              </p>
              <Select value={kind} onChange={setKind} options={KINDS} />
            </section>

            <section className="mise-card-inset rounded-2xl p-3.5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Which days
              </p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] text-fg-soft">From</span>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    data-testid="leave-from"
                    className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2.5 text-sm outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-fg-soft">To</span>
                  <input
                    type="date"
                    value={to}
                    min={from}
                    onChange={(e) => setTo(e.target.value)}
                    data-testid="leave-to"
                    className="mise-well mt-1 min-h-[42px] w-full rounded-lg px-2.5 text-sm outline-none"
                  />
                </label>
              </div>
              <p className="mt-2 text-[11px] text-fg-faint">
                {dayCount(from, to) === 1
                  ? "One day off."
                  : `${dayCount(from, to)} days off, inclusive.`}
              </p>
            </section>

            <section className="mise-card-inset rounded-2xl p-3.5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Why — optional
              </p>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Doctor's appointment, family, …"
                className="mise-well min-h-[42px] w-full rounded-lg px-2.5 text-sm outline-none"
              />
            </section>

            {warning && (
              <p className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2.5 text-sm font-medium leading-relaxed text-amber-300">
                ⚠ {warning}
              </p>
            )}
            {error && (
              <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-sm font-semibold text-rose-300">
                {error}
              </p>
            )}
          </div>
        </SheetPopup>
      )}
    </>
  );
}

/** Inclusive day count — "3 days off" is what a manager counts, not the two
 *  dates it took to say it. */
function dayCount(from: string, to: string): number {
  const a = new Date(from + "T00:00:00");
  const b = new Date(to + "T00:00:00");
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1);
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
