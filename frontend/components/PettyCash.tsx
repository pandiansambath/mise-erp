"use client";

// Money that left the till in someone's hand.
//
// A staff member takes 50 for greens, spends 10, returns 40. Until they are
// back the drawer is 50 light and no amount of counting will balance — which is
// the moment people decide the software is wrong and stop using it.
//
// The panel is built around the fact that those three numbers are known at
// DIFFERENT times. Taking money is one action; settling is another, later. So
// there are two states per row, and settling refuses to complete unless
// spent + returned equals what was taken. That refusal is the whole point: the
// difference is money nobody can account for, and quietly accepting it is
// exactly how a till goes wrong without anyone noticing.

import { useState } from "react";
import { api, ApiError, type ExpenseCategory, type PettyCashRow } from "@/lib/api";
import { useCurrency } from "@/lib/currency";
import { Select } from "@/components/Select";
import { numeric } from "@/lib/sanitize";

export function PettyCash({
  day,
  rows,
  categories,
  canWrite,
  onChanged,
}: {
  day: string;
  rows: PettyCashRow[];
  categories: ExpenseCategory[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { format } = useCurrency();
  const [taking, setTaking] = useState(false);
  const [amount, setAmount] = useState("");
  const [who, setWho] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settling, setSettling] = useState<string | null>(null);

  const open = rows.filter((r) => r.status === "OPEN");
  const stillOut = open.reduce((sum, r) => sum + (parseFloat(r.taken_amount) || 0), 0);

  async function take(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/sales/days/${day}/petty`, {
        taken_amount: amount || "0",
        taken_by: who || null,
        purpose: why || null,
      });
      setAmount(""); setWho(""); setWhy(""); setTaking(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-fg">
          Petty cash
          {stillOut > 0 && (
            <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
              {format(String(stillOut))} still out
            </span>
          )}
        </h4>
        {canWrite && !taking && (
          <button
            type="button"
            onClick={() => setTaking(true)}
            className="mise-press rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2"
          >
            + Take from till
          </button>
        )}
      </div>

      {stillOut > 0 && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint">
          This is why the drawer looks short. It balances again when they come back and you settle it.
        </p>
      )}

      {taking && (
        <form onSubmit={take} className="mise-pop mt-3 space-y-2 rounded-xl border border-line bg-paper-2/40 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-fg-faint">Amount taken</span>
              <input
                value={amount}
                onChange={(e) => setAmount(numeric(e.target.value))}
                inputMode="decimal"
                autoFocus
                required
                placeholder="50.00"
                className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-fg-faint">Who took it</span>
              <input
                value={who}
                onChange={(e) => setWho(e.target.value)}
                placeholder="e.g. Ravi"
                className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] text-fg-faint">What for</span>
            <input
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="e.g. greens from the market"
              className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
            />
          </label>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !amount}
              className="mise-press rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Record"}
            </button>
            <button
              type="button"
              onClick={() => { setTaking(false); setError(null); }}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {rows.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id}>
              <div
                className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                  r.status === "OPEN"
                    ? "border-amber-400/30 bg-amber-400/[0.06]"
                    : "border-line bg-paper-2/40"
                }`}
              >
                <span className="font-medium text-fg">{format(r.taken_amount)}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg-faint">
                  {r.taken_by ? <b className="text-fg-soft">{r.taken_by}</b> : "someone"}
                  {r.purpose ? ` · ${r.purpose}` : ""}
                </span>
                {r.status === "OPEN" ? (
                  canWrite ? (
                    <button
                      type="button"
                      onClick={() => setSettling(settling === r.id ? null : r.id)}
                      className="mise-press rounded-md border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-[11px] font-medium text-amber-300"
                    >
                      Settle
                    </button>
                  ) : (
                    <span className="text-[11px] text-amber-300">still out</span>
                  )
                ) : (
                  <span className="text-[11px] text-fg-faint">
                    spent {format(r.spent_amount ?? "0")} · returned {format(r.returned_amount ?? "0")}
                  </span>
                )}
              </div>
              {settling === r.id && (
                <SettleForm
                  row={r}
                  categories={categories}
                  onDone={() => { setSettling(null); onChanged(); }}
                  onCancel={() => setSettling(null)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Settling: what was actually spent, and what came back. */
function SettleForm({
  row, categories, onDone, onCancel,
}: {
  row: PettyCashRow;
  categories: ExpenseCategory[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { format } = useCurrency();
  const [spent, setSpent] = useState("");
  const [category, setCategory] = useState(categories[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taken = parseFloat(row.taken_amount) || 0;
  const spentNum = parseFloat(spent) || 0;
  // Derived, not typed. Asking for all three invites a combination that does
  // not add up; asking for the spend and showing the change is how the person
  // actually experiences it.
  const change = taken - spentNum;
  const valid = spent !== "" && spentNum >= 0 && change >= 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/sales/petty/${row.id}/settle`, {
        spent_amount: spent,
        returned_amount: change.toFixed(2),
        category_id: category || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not settle that.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mise-pop mt-1.5 space-y-2 rounded-lg border border-line bg-paper-2/60 p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="block text-[11px] text-fg-faint">Actually spent</span>
          <input
            value={spent}
            onChange={(e) => setSpent(numeric(e.target.value))}
            inputMode="decimal"
            autoFocus
            placeholder="10.00"
            className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
          />
        </label>
        <div>
          <span className="block text-[11px] text-fg-faint">Change back to till</span>
          <p className={`mt-1 rounded-lg px-2.5 py-1.5 text-sm font-medium ${
            change < 0 ? "text-rose-400" : "text-emerald-300"
          }`}>
            {change < 0 ? "more than was taken" : format(change.toFixed(2))}
          </p>
        </div>
      </div>
      {categories.length > 0 && (
        <label className="block">
          <span className="block text-[11px] text-fg-faint">Book the spend as</span>
          <Select
            value={category}
            onChange={setCategory}
            className="mt-1"
            options={categories.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))}
          />
        </label>
      )}
      {error && <p className="text-xs text-rose-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || !valid}
          className="mise-press rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Settle"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg">
          Cancel
        </button>
      </div>
    </form>
  );
}
