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
//
// Since pay-later (§70) it also shows WHICH deliveries are still waiting to be
// paid — "even in that vendor page also it need to show payment pending" — and
// a payment here pays them off oldest first, whole orders only. The preview
// says exactly which before anything is saved; the server is the authority.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  api, ApiError,
  type AwaitingOrder, type ExpenseCategory, type PaymentPlan, type PaymentResult,
  type VendorStatement,
} from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { Select } from "@/components/Select";
import { MarkPaidPopup, PAY_METHODS, dayLabel, type PayMethod } from "@/components/MarkPaidPopup";
import { localISODate } from "@/lib/date";
import { numeric } from "@/lib/sanitize";

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
  const [method, setMethod] = useState<PayMethod>("BANK");
  const [when, setWhen] = useState(localISODate());
  const [reference, setReference] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** What the payment being typed WOULD pay off. */
  const [plan, setPlan] = useState<PaymentPlan | null>(null);
  const [planState, setPlanState] = useState<"idle" | "loading" | "failed">("idle");
  /** What the last saved payment actually paid off, as the server said. */
  const [result, setResult] = useState<string | null>(null);
  const [markPaid, setMarkPaid] = useState<AwaitingOrder | null>(null);
  // Only the newest preview may land: an answer for "18" must not overwrite
  // the one for "180" just because it came back second.
  const planSeq = useRef(0);

  const load = useCallback(async () => {
    try {
      setData(await api.get<VendorStatement>(`/vendors/${vendorId}/statement`));
    } catch {
      setData(null);
    }
  }, [vendorId]);

  useEffect(() => { load(); }, [load]);

  // Ask what this payment pays off, a moment after the typing stops.
  useEffect(() => {
    if (!paying) return;
    const value = parseFloat(amount);
    const seq = ++planSeq.current;
    if (!(value > 0)) {
      setPlan(null);
      setPlanState("idle");
      return;
    }
    setPlanState("loading");
    const t = window.setTimeout(async () => {
      try {
        const p = await api.post<PaymentPlan>(`/vendors/${vendorId}/payments/preview`, {
          date: when,
          amount,
          method,
        });
        if (seq !== planSeq.current) return;
        setPlan(p);
        setPlanState("idle");
      } catch {
        if (seq !== planSeq.current) return;
        setPlan(null);
        setPlanState("failed");
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [paying, amount, method, when, vendorId]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<PaymentResult>(`/vendors/${vendorId}/payments`, {
        date: when,
        amount,
        method,
        reference: reference.trim() || null,
        // Only for cash, and only for what is LEFT OVER once no order is
        // waiting: that money also leaves the till, so it is booked as a cash
        // expense. The orders a cash payment settles carry their own.
        category_id: method === "CASH" ? category || null : null,
      });
      setResult(
        res.settled.length
          ? `Paid ${format(amount)} — paid off ${res.settled
              .map((s) => `${s.po_number} (${format(s.amount)})`)
              .join(", ")}, into Expenses on ${dayLabel(when)}.`
          : `Recorded ${format(amount)} against the balance.`,
      );
      setAmount(""); setReference(""); setPaying(false); setPlan(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record that payment.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;

  const owed = parseFloat(data.outstanding) || 0;
  const awaiting = data.awaiting ?? [];
  const awaitingTotal = parseFloat(data.awaiting_total ?? "0") || 0;
  const leftover = plan ? parseFloat(plan.leftover) || 0 : 0;
  // Before pay-later, every delivery was booked when it arrived, so a balance
  // can be older than any order waiting here. Say where the rest came from.
  const older = owed - awaitingTotal;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Delivered", value: data.delivered, tone: "text-fg", note: null },
          { label: "Paid", value: data.paid, tone: "text-emerald-300", note: null },
          {
            label: owed < 0 ? "In credit" : "Outstanding",
            value: String(Math.abs(owed)),
            // Owing money is not a problem, it is the arrangement. Amber only,
            // never red — red says "something is wrong", and nothing is.
            tone: owed > 0 ? "text-amber-300" : "text-emerald-300",
            note: null,
          },
          {
            label: "Waiting for payment",
            value: data.awaiting_total ?? "0",
            tone: awaitingTotal > 0 ? "text-amber-300" : "text-fg-soft",
            note: `${awaiting.length} order${awaiting.length === 1 ? "" : "s"}`,
          },
        ].map((s) => (
          <div key={s.label} className="mise-card-inset px-3 py-2">
            <p className="truncate text-[10px] font-medium uppercase tracking-wide text-fg-faint">{s.label}</p>
            <p className={`mt-0.5 truncate font-display text-lg font-semibold tabular-nums ${s.tone}`}>
              {format(s.value)}
            </p>
            {s.note && <p className="truncate text-[10px] text-fg-faint">{s.note}</p>}
          </div>
        ))}
      </div>

      {result && !paying && (
        <p className="mise-pop text-xs leading-relaxed text-emerald-300">{result}</p>
      )}

      {canWrite && !paying && (
        <button
          type="button"
          onClick={() => {
            setPaying(true);
            setResult(null);
            setAmount(owed > 0 ? owed.toFixed(2) : "");
          }}
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
              <Select
                value={method}
                onChange={(v) => setMethod(v as PayMethod)}
                className="mt-1"
                options={PAY_METHODS}
              />
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

          {/* What this payment pays off — said BEFORE it is saved, so a lump
              payment is never a surprise. */}
          {planState === "loading" && (
            <p className="text-xs text-fg-faint">Working out what this pays off…</p>
          )}
          {planState === "failed" && (
            <p className="text-xs text-fg-faint">
              We&apos;ll work out which orders this pays off when you save.
            </p>
          )}
          {planState === "idle" && plan && (
            plan.refusal ? (
              <div className="space-y-1.5">
                <p className="text-xs leading-relaxed text-rose-400">{plan.refusal}</p>
                {plan.clear_amounts.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-fg-faint">Pay exactly:</span>
                    {plan.clear_amounts.map((c) => (
                      <button
                        key={c.through}
                        type="button"
                        onClick={() => setAmount(c.amount)}
                        className="mise-btn-flat mise-press px-2.5 py-1 text-[11px] font-semibold text-fg-soft"
                        title={`Clears every waiting order up to ${c.through}`}
                      >
                        {format(c.amount)} <span className="font-normal text-fg-faint">to {c.through}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-fg-soft">
                {plan.settles.length > 0 ? (
                  <>
                    Pays off{" "}
                    {plan.settles.map((s, i) => (
                      <span key={s.po_id}>
                        {i > 0 ? ", " : ""}
                        <b className="text-fg">{s.po_number}</b> ({format(s.amount)})
                      </span>
                    ))}{" "}
                    → <b className="text-fg">{format(plan.settled_total)}</b> into Expenses on{" "}
                    {dayLabel(when)}.
                  </>
                ) : (
                  <>No waiting order is paid off by this.</>
                )}
                {leftover > 0 && (
                  <>
                    {" "}
                    {plan.next_waiting
                      ? `${format(plan.leftover)} goes against the balance — not enough to pay off ${plan.next_waiting.po_number} (${format(plan.next_waiting.amount_due)}).`
                      : `${format(plan.leftover)} goes against the balance.`}
                  </>
                )}
              </p>
            )
          )}

          {/* With posting OFF no order carries an expense, so the WHOLE cash
              payment is booked to this category — the picker must stay on
              screen (review, §70). */}
          {method === "CASH" && categories.length > 0 && (plan ? leftover > 0 || plan.posting === false : true) && (
            <label className="block">
              <span className="block text-[11px] text-fg-faint">
                {plan?.posting === false
                  ? "Book this cash as — so the till balances"
                  : plan
                    ? `Book the ${format(plan.leftover)} left over as — so the till balances`
                    : "Book any cash left over as — so the till balances"}
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
              disabled={busy || !amount || !!plan?.refusal}
              className="mise-btn-key mise-press px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {busy ? "Saving…" : "Record payment"}
            </button>
            <button
              type="button"
              onClick={() => { setPaying(false); setError(null); setPlan(null); }}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Waiting for payment — received, owed, and NOT in Expenses yet. */}
      {awaiting.length > 0 ? (
        <div className="mise-card-inset space-y-1.5 p-3">
          <p className="text-sm font-semibold text-fg">Waiting for payment</p>
          <ul className="space-y-1.5">
            {awaiting.map((o) => (
              <li key={o.po_id} className="mise-well flex items-center gap-3 rounded-lg px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate text-fg-soft">
                  <b className="text-fg">{o.po_number}</b>
                  {o.received_on ? ` · received ${dayLabel(o.received_on)}` : ""}
                  {` · ${o.days_waiting} day${o.days_waiting === 1 ? "" : "s"}`}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-amber-300">
                  {format(o.amount_due)}
                </span>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => setMarkPaid(o)}
                    className="mise-btn-key mise-press shrink-0 px-2.5 py-1 text-[11px] font-semibold"
                  >
                    Mark paid
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-relaxed text-fg-faint">
            In stock, not in Expenses yet. Marking one paid books it on the day you paid.
          </p>
          {older > 0.005 && (
            <p className="text-[11px] leading-relaxed text-fg-faint">
              The other {format(older)} is from deliveries booked before pay-later existed — record a
              payment to clear it.
            </p>
          )}
        </div>
      ) : data.entries.some((e) => e.kind === "delivery") ? (
        <p className="text-[11px] text-fg-faint">Nothing waiting for payment.</p>
      ) : null}

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

      {markPaid && (
        <MarkPaidPopup
          po={{
            id: markPaid.po_id,
            po_number: markPaid.po_number,
            vendor_name: vendorName,
            amount_due: markPaid.amount_due,
            received_on: markPaid.received_on,
          }}
          onClose={() => setMarkPaid(null)}
          onPaid={() => {
            setResult(`${markPaid.po_number} is paid — into Expenses on the day you paid it.`);
            setMarkPaid(null);
            load();
          }}
        />
      )}
    </div>
  );
}
