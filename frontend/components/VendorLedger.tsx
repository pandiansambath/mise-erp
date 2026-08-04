"use client";

// What you owe a supplier, and where that came from.
//
// The rhythm: deliveries arrive daily, money leaves weekly. Between the two
// there is a balance, and until now the app could state neither it nor how it
// arose — you knew what every delivery cost and nothing about what had been
// paid.
//
// It shows the STATEMENT rather than only the total on purpose. "You owe £1,240"
// is unarguable and therefore useless when a supplier's invoice disagrees; a
// dated list of deliveries and payments with a running balance is something you
// can check against theirs, line by line.

import { useCallback, useEffect, useState } from "react";
import {
  api, ApiError,
  type ExpenseCategory, type VendorStatement,
} from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { Select } from "@/components/Select";
import { localISODate } from "@/lib/date";
import { numeric } from "@/lib/sanitize";

const METHODS = [
  { value: "BANK", label: "Bank transfer" },
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
];

export function VendorLedger({
  vendorId,
  vendorName,
  categories,
  canWrite,
}: {
  vendorId: string;
  vendorName: string;
  categories: ExpenseCategory[];
  canWrite: boolean;
}) {
  const { format } = useCurrency();
  const [data, setData] = useState<VendorStatement | null>(null);
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK");
  const [when, setWhen] = useState(localISODate());
  const [reference, setReference] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<VendorStatement>(`/vendors/${vendorId}/statement`));
    } catch {
      setData(null);
    }
  }, [vendorId]);

  useEffect(() => { load(); }, [load]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/vendors/${vendorId}/payments`, {
        date: when,
        amount,
        method,
        reference: reference.trim() || null,
        // Only for cash: that money also leaves the till, so it is booked as a
        // cash expense too. Without it the drawer is short with no explanation.
        category_id: method === "CASH" ? category || null : null,
      });
      setAmount(""); setReference(""); setPaying(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record that payment.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  const owed = parseFloat(data.outstanding) || 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Delivered", value: data.delivered, tone: "text-fg" },
          { label: "Paid", value: data.paid, tone: "text-emerald-300" },
          {
            label: owed < 0 ? "In credit" : "Outstanding",
            value: String(Math.abs(owed)),
            // Owing money is not a problem, it is the arrangement. Amber only,
            // never red — red says "something is wrong", and nothing is.
            tone: owed > 0 ? "text-amber-300" : "text-emerald-300",
          },
        ].map((s) => (
          <div key={s.label} className="mise-neo-raised rounded-xl px-3 py-2">
            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-fg-faint">{s.label}</p>
            <p className={`mt-0.5 truncate font-display text-lg font-semibold tabular-nums ${s.tone}`}>
              {format(s.value)}
            </p>
          </div>
        ))}
      </div>

      {canWrite && !paying && (
        <button
          type="button"
          onClick={() => { setPaying(true); setAmount(owed > 0 ? owed.toFixed(2) : ""); }}
          className="mise-press w-full rounded-lg border border-brand-400/30 bg-brand-400/10 px-3 py-2 text-xs font-semibold text-brand-300"
        >
          Record a payment
        </button>
      )}

      {paying && (
        <form onSubmit={pay} className="mise-pop space-y-2 rounded-xl border border-line bg-paper-2/40 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-fg-faint">Amount</span>
              <input
                value={amount}
                onChange={(e) => setAmount(numeric(e.target.value))}
                inputMode="decimal"
                autoFocus
                required
                className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-fg-faint">Date</span>
              <input
                type="date"
                value={when}
                max={localISODate()}
                onChange={(e) => setWhen(e.target.value)}
                className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-fg-faint">How</span>
              <Select value={method} onChange={setMethod} className="mt-1" options={METHODS} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-fg-faint">Reference (optional)</span>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. bank ref"
                className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
              />
            </label>
          </div>
          {method === "CASH" && categories.length > 0 && (
            <label className="block">
              <span className="block text-[11px] text-fg-faint">
                Book the cash as — so the till balances
              </span>
              <Select
                value={category}
                onChange={setCategory}
                className="mt-1"
                options={[
                  { value: "", label: "Don't book an expense" },
                  ...categories.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </label>
          )}
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !amount}
              className="mise-press rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Record payment"}
            </button>
            <button
              type="button"
              onClick={() => { setPaying(false); setError(null); }}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {data.entries.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left text-fg-faint">
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-3 py-2 text-right font-medium">Charged</th>
                <th className="px-3 py-2 text-right font-medium">Paid</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {/* Newest first for reading; the running balance was computed
                  forwards, which is the only direction it makes sense in. */}
              {[...data.entries].reverse().map((e, i) => (
                <tr key={`${e.date}-${e.reference}-${i}`} className="border-b border-line/60 last:border-0">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-fg-faint">{e.date}</td>
                  <td className="px-3 py-1.5">
                    <span className={e.kind === "payment" ? "text-emerald-300" : "text-fg-soft"}>
                      {e.kind === "payment" ? "Payment" : "Delivery"}
                    </span>
                    {e.reference && <span className="ml-1.5 text-fg-faint">{e.reference}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-fg-soft">
                    {parseFloat(e.charge) > 0 ? format(e.charge) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-emerald-300">
                    {parseFloat(e.payment) > 0 ? format(e.payment) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-fg">
                    {format(e.balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-xl border border-line bg-paper-2/40 px-3 py-3 text-xs leading-relaxed text-fg-faint">
          Nothing to show yet. Deliveries appear here once a purchase order from{" "}
          <b className="text-fg-soft">{vendorName}</b> is marked received — an order that has not
          arrived is not a debt.
        </p>
      )}
    </div>
  );
}
