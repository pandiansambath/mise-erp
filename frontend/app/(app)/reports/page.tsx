"use client";

import { useCallback, useEffect, useState } from "react";
import { api, downloadFile, type PnL } from "@/lib/api";
import { Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { useCurrency } from "@/lib/currency";

const monthStart = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

function PnlLine({
  label,
  value,
  sign,
  bold,
  tone,
}: {
  label: string;
  value: string;
  sign?: "minus";
  bold?: boolean;
  tone?: "profit";
}) {
  const { format } = useCurrency();
  const profit =
    tone === "profit" ? (parseFloat(value) >= 0 ? "text-brand-600" : "text-rose-600") : "";
  return (
    <div
      className={`flex items-center justify-between py-2.5 ${bold ? "border-t border-slate-200" : ""}`}
    >
      <span className={bold ? "font-semibold text-slate-900" : "text-slate-600"}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""} ${profit}`}>
        {sign === "minus" ? "−" : ""}
        {format(value)}
      </span>
    </div>
  );
}

export default function ReportsPage() {
  const { format } = useCurrency();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [pnl, setPnl] = useState<PnL | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (f: string, t: string) => {
    setPnl(await api.get<PnL>(`/reports/pnl?date_from=${f}&date_to=${t}`));
  }, []);

  useEffect(() => {
    load(from, to).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apply() {
    setLoading(true);
    await load(from, to).finally(() => setLoading(false));
  }

  return (
    <div>
      <PageHeader title="Reports" subtitle="Profit & Loss — did the restaurant make money?" />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button onClick={apply} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Apply
        </button>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => downloadFile(`/reports/pnl.xlsx?date_from=${from}&date_to=${to}`, `mise-pnl-${from}-to-${to}.xlsx`)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            ⬇ Excel
          </button>
          <button
            onClick={() => downloadFile(`/reports/pnl.csv?date_from=${from}&date_to=${to}`, `mise-pnl-${from}-to-${to}.csv`)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ⬇ CSV
          </button>
        </div>
      </div>

      {loading || !pnl ? (
        <Spinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Net sales" value={format(pnl.net_sales)} />
            <StatCard label="Net profit" value={format(pnl.net_profit)} accent={parseFloat(pnl.net_profit) >= 0 ? "brand" : "rose"} />
            <StatCard label="Net margin" value={`${pnl.net_margin_pct}%`} accent="brand" />
            <StatCard label="Food cost" value={`${pnl.food_cost_pct}%`} hint="target 25-35%" accent="amber" />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <h3 className="mb-2 font-semibold text-slate-900">Profit &amp; Loss</h3>
              <div className="text-sm">
                <PnlLine label="Gross sales" value={pnl.gross_sales} />
                <PnlLine label="Delivery commission" value={pnl.commission} sign="minus" />
                <PnlLine label="Net sales" value={pnl.net_sales} bold />
                <PnlLine label="Cost of sales (food)" value={pnl.cost_of_sales} sign="minus" />
                <PnlLine label="Gross profit" value={pnl.gross_profit} bold />
                <PnlLine label="Operating expenses" value={pnl.operating_expenses} sign="minus" />
                <PnlLine label="Net profit" value={pnl.net_profit} bold tone="profit" />
              </div>
            </Card>

            <Card>
              <h3 className="font-semibold text-slate-900">Expense breakdown</h3>
              {pnl.expense_breakdown.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-400">No expenses in range.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {pnl.expense_breakdown.map((c) => (
                    <li key={c.category_id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-slate-700">{c.category_name}</span>
                      <span className="font-medium text-slate-900">{format(c.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
