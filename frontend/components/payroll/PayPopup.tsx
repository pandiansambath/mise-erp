"use client";

// Marking people as paid: the day, how, and a reference.
//
//   "still we didn't click mark as paid button.. then what's the use of mark as
//    paid button"
//
// This is the use of it: here, and nowhere before here, the wages go into
// Expenses. The same three ways of paying as a supplier (`MarkPaidPopup`), and
// for the same reason none of them is chosen for you: a wrong "cash" takes money
// out of the till that never left it.

import { useState } from "react";

import { PAY_METHODS, type PayMethod } from "@/components/MarkPaidPopup";
import { SheetPopup } from "@/components/SheetPopup";
import { Choice, Said } from "@/components/payroll/bits";
import { people, type RunDetail, sayDay, type Slip, sumPence, today } from "@/components/payroll/lib";
import { api, ApiError } from "@/lib/api";
import { useCurrency } from "@/lib/currency";

export function PayPopup({
  runId,
  label,
  slips,
  depth = 2,
  onClose,
  onPaid,
}: {
  runId: string;
  label: string;
  slips: Slip[];
  depth?: 2 | 3;
  onClose: () => void;
  onPaid: (run: RunDetail) => void;
}) {
  const { format } = useCurrency();
  const now = today();
  const [paidOn, setPaidOn] = useState(now);
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = sumPence(slips.map((s) => s.net_pay));
  const names = slips.map((s) => s.employee_name);

  async function submit() {
    if (!method) return;
    setBusy(true);
    setError(null);
    try {
      onPaid(
        await api.post<RunDetail>(`/payroll/runs/${runId}/pay`, {
          payslip_ids: slips.map((s) => s.id),
          paid_on: paidOn,
          method,
          reference: reference.trim() || null,
        }),
      );
    } catch (err) {
      // Stay open: somebody was halfway through saying something true.
      setError(err instanceof ApiError ? err.message : "Could not mark that as paid.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetPopup
      depth={depth}
      onClose={onClose}
      title={`Mark ${slips.length === 1 ? names[0] : people(slips.length)} as paid`}
      subtitle={label}
      footer={
        <div className="grid grid-cols-1 gap-2 sm:flex sm:justify-end">
          <button type="button" onClick={onClose} className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm text-fg-soft">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !method || !paidOn}
            className="mise-btn-key mise-press min-h-[42px] px-4 text-sm font-semibold disabled:opacity-50"
          >
            {busy
              ? "Saving…"
              : method
                ? `Mark as paid: ${format(total)} into Expenses on ${sayDay(paidOn)}`
                : "Choose how it was paid"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="mise-card-inset px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-fg-faint">Going out</p>
          <p className="font-display text-3xl font-semibold leading-tight tabular-nums text-fg">{format(total)}</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-soft">
            {slips.length === 1
              ? "Approved, and not in Expenses yet. It goes in on the day you say it was paid."
              : `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}. One line each in Expenses, on the day you say they were paid.`}
          </p>
        </div>

        <label className="block">
          <span className="block text-[11px] text-fg-faint">Paid on</span>
          <input
            type="date"
            value={paidOn}
            max={now}
            onChange={(e) => setPaidOn(e.target.value)}
            className="mise-well mt-1 w-full rounded-lg px-2.5 py-2 text-sm text-fg outline-none"
          />
        </label>

        <div>
          <span className="mb-1 block text-[11px] text-fg-faint">Paid how?</span>
          <Choice value={method} options={PAY_METHODS} onChange={setMethod} />
          {method === "CASH" && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint">
              Cash comes out of the till on that day.
            </p>
          )}
        </div>

        <label className="block">
          <span className="block text-[11px] text-fg-faint">Reference (optional)</span>
          <input
            value={reference}
            maxLength={120}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. bank reference"
            className="mise-well mt-1 w-full rounded-lg px-2.5 py-2 text-sm text-fg outline-none"
          />
        </label>
        <Said error={error} />
      </div>
    </SheetPopup>
  );
}
