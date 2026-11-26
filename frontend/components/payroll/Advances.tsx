"use client";

// Money given early, and how much of it has come back.

import { useCallback, useEffect, useState } from "react";

import { Select } from "@/components/Select";
import { SheetPopup } from "@/components/SheetPopup";
import { Badge } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { MoneyInput, Pager, Said } from "@/components/payroll/bits";
import { fromPence, monthName, pence, sayDay, today } from "@/components/payroll/lib";
import { api, ApiError, type Employee } from "@/lib/api";
import { useCurrency } from "@/lib/currency";

interface Advance {
  id: string;
  employee_id: string;
  amount: string;
  amount_recovered: string;
  reason: string | null;
  given_date: string;
  deduct_period: string;
  is_deducted: boolean;
}

const PAGE = 6;

export function Advances({ employees, onClose }: { employees: Employee[]; onClose: () => void }) {
  const { format } = useCurrency();
  const confirm = useConfirm();
  const [list, setList] = useState<Advance[] | null>(null);
  const [emp, setEmp] = useState("");
  const [amount, setAmount] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [form, setForm] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const name = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "Somebody who has left";

  const load = useCallback(async () => {
    setList(await api.get<Advance[]>("/payroll/advances").catch(() => []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!emp || !amount) return;
    const ok = await confirm({
      title: `Record ${format(amount)} to ${name(emp)}?`,
      message: `It comes off their pay from ${monthName(`${month}-01`)} on, as far as their pay covers it.`,
      confirmText: "Record the advance",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/payroll/advances", {
        employee_id: emp,
        amount,
        reason: reason.trim() || null,
        given_date: today(),
        deduct_period: month,
      });
      setEmp("");
      setAmount(null);
      setReason("");
      setForm((n) => n + 1);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the advance.");
    } finally {
      setBusy(false);
    }
  }

  const rows = list ?? [];
  const last = Math.max(0, Math.ceil(rows.length / PAGE) - 1);
  const here = Math.min(page, last);

  return (
    <SheetPopup
      onClose={onClose}
      title="Salary advances"
      subtitle="Money given early, taken back from their pay"
      columns={3}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <section className="space-y-2.5">
          <Select
            value={emp}
            onChange={setEmp}
            placeholder="Who was it given to?"
            options={employees.map((e) => ({ value: e.id, label: e.full_name, hint: e.employee_code }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0">
              <span className="block text-[11px] text-fg-faint">Amount</span>
              <MoneyInput key={form} value={null} onMoney={setAmount} label="Amount" className="mt-0.5 w-full" />
            </label>
            <label className="block min-w-0">
              <span className="block text-[11px] text-fg-faint">Take back from</span>
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="mise-well mt-0.5 w-full min-w-0 rounded-lg px-2.5 py-2 text-sm outline-none"
              />
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] text-fg-faint">Why (optional)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. emergency at home"
              className="mise-well mt-0.5 w-full rounded-lg px-3 py-2 text-sm outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || !emp || !amount}
            className="mise-btn-key mise-press min-h-[44px] w-full text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Saving…" : "Record the advance"}
          </button>
          <Said error={error} />
        </section>
        <section className="space-y-1.5">
          {list === null && <p className="py-4 text-center text-sm text-fg-faint">Opening…</p>}
          {list !== null && rows.length === 0 && (
            <p className="py-4 text-center text-sm text-fg-faint">No advances.</p>
          )}
          {rows.slice(here * PAGE, (here + 1) * PAGE).map((a) => {
            const left = Math.max(0, pence(a.amount) - pence(a.amount_recovered));
            return (
              <div key={a.id} className="mise-well flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate text-fg">
                    <b>{name(a.employee_id)}</b>
                    {` · ${format(a.amount)}`}
                  </span>
                  <span className="block truncate text-[11px] text-fg-faint">
                    {`${sayDay(a.given_date)}${a.reason ? ` · ${a.reason}` : ""}`}
                  </span>
                </span>
                {left === 0 ? (
                  <Badge tone="green">taken back</Badge>
                ) : (
                  <Badge tone="amber">{`${format(fromPence(left))} owed`}</Badge>
                )}
              </div>
            );
          })}
          <Pager page={here} size={PAGE} total={rows.length} onPage={setPage} />
        </section>
      </div>
    </SheetPopup>
  );
}
