"use client";

// Paying for an order that has already arrived (§70).
//
//   "receive stock into our stock but payment is still pending so that it wont
//    added in expense ... once payment done then we can added in expense"
//
// ONE popup, used by the purchase order AND the supplier page, so the two can
// never drift into asking different questions about the same money. Marking an
// order paid is the moment its cost reaches Expenses — dated the day it was
// paid, not the day it came.

import { useState } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import { api, ApiError } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { localISODate } from "@/lib/date";
import { numeric } from "@/lib/sanitize";

export type PayMethod = "CASH" | "BANK" | "CARD";

/** How a supplier is paid. Shared with the supplier page's payment form. */
export const PAY_METHODS: { value: PayMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "BANK", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
];

export function payMethodLabel(m: string | null | undefined): string {
  return PAY_METHODS.find((x) => x.value === m)?.label ?? (m || "");
}

/** "30 Oct" — how a person says a day. */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function MarkPaidPopup({
  po,
  depth = 2,
  onClose,
  onPaid,
}: {
  po: {
    id: string;
    po_number: string;
    vendor_name: string;
    amount_due: string | number | null | undefined;
    received_on?: string | null;
  };
  depth?: 1 | 2 | 3;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { format } = useCurrency();
  const today = localISODate();
  const due = Number(po.amount_due ?? 0) || 0;
  const [paidOn, setPaidOn] = useState(today);
  // NO DEFAULT METHOD. A wrong "cash" takes money out of the till that never
  // left it; a wrong "bank" leaves real cash unexplained. Either is a drawer
  // that will not balance, so the person says which.
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [payingNow, setPayingNow] = useState(due.toFixed(2));
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cash leaves the till on that day as ONE expense, so it is always the whole
  // amount — there is no "part of it earlier" for cash.
  const partAllowed = method === "BANK" || method === "CARD";

  async function submit() {
    if (!method) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/purchasing/purchase-orders/${po.id}/mark-paid`, {
        paid_on: paidOn,
        method,
        paying_now: partAllowed && payingNow.trim() !== "" ? payingNow : null,
        reference: reference.trim() || null,
      });
      onPaid();
    } catch (err) {
      // Stay open: the person was halfway through saying something true, and
      // closing would make them say it all again.
      setError(err instanceof ApiError ? err.message : "Could not mark that paid.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetPopup
      depth={depth}
      onClose={onClose}
      title={`Mark ${po.po_number} paid`}
      subtitle={`${po.vendor_name || "Supplier"}${po.received_on ? ` · arrived ${dayLabel(po.received_on)}` : ""}`}
      footer={
        <div className="grid grid-cols-1 gap-2 sm:flex sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="mise-btn-flat mise-press px-4 py-2 text-sm text-fg-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !method || !paidOn}
            className="mise-btn-key mise-press px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {busy
              ? "Saving…"
              : method
                ? `Mark paid — ${format(due)} into Expenses on ${dayLabel(paidOn)}`
                : "Choose how it was paid"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="mise-card-inset px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-fg-faint">Owed for what arrived</p>
          <p className="font-display text-3xl font-semibold leading-tight tabular-nums text-fg">
            {format(due)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-fg-soft">
            In stock already, not in Expenses yet. It goes in on the day you say it was paid.
          </p>
        </div>

        <label className="block">
          <span className="block text-[11px] text-fg-faint">Paid on</span>
          <input
            type="date"
            value={paidOn}
            max={today}
            onChange={(e) => setPaidOn(e.target.value)}
            className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm text-fg outline-none"
          />
        </label>

        <div>
          <span className="block text-[11px] text-fg-faint">Paid how?</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {PAY_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMethod(m.value)}
                aria-pressed={method === m.value}
                className={`mise-press rounded-lg px-2 py-2 text-sm ${
                  method === m.value ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {method === "CASH" && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint">
              Cash comes out of the till on that day, so it is the whole {format(due)}.
            </p>
          )}
        </div>

        {partAllowed && (
          <label className="block">
            <span className="block text-[11px] text-fg-faint">Paying now</span>
            <input
              value={payingNow}
              onChange={(e) => setPayingNow(numeric(e.target.value))}
              inputMode="decimal"
              className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm tabular-nums text-fg outline-none"
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-fg-faint">
              Paid part of it earlier on the supplier page? Enter only what you&apos;re paying now.
              Expenses still gets the whole {format(due)}, once.
            </span>
          </label>
        )}

        <label className="block">
          <span className="block text-[11px] text-fg-faint">Reference (optional)</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. bank ref"
            className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm text-fg outline-none"
          />
        </label>

        {error && <p className="text-xs text-rose-400">{error}</p>}
      </div>
    </SheetPopup>
  );
}
