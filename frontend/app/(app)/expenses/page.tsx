"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type Expense,
  type ExpenseCategory,
  type ExpenseSummary,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const METHODS = ["BANK", "CARD", "CASH", "ONLINE"];
const monthStart = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

export default function ExpensesPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const canWrite = can(user?.role, "expenses:write");

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [vat, setVat] = useState("");
  const [method, setMethod] = useState("BANK");
  const [description, setDescription] = useState("");

  const loadData = useCallback(
    async (f: string, t: string) => {
      const [list, sum] = await Promise.all([
        api.get<Expense[]>(`/expenses?date_from=${f}&date_to=${t}`),
        api.get<ExpenseSummary>(`/expenses/summary?date_from=${f}&date_to=${t}`),
      ]);
      setExpenses(list);
      setSummary(sum);
    },
    []
  );

  useEffect(() => {
    Promise.all([
      api.get<ExpenseCategory[]>("/expenses/categories").then((c) => {
        setCategories(c);
        if (c.length) setCategoryId(c[0].id);
      }),
      loadData(from, to),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function applyRange() {
    setLoading(true);
    await loadData(from, to).finally(() => setLoading(false));
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post<Expense>("/expenses", {
        category_id: categoryId,
        date,
        amount: amount || "0",
        vat_amount: vat || "0",
        payment_method: method,
        description: description || null,
      });
      setAmount("");
      setVat("");
      setDescription("");
      await loadData(from, to);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add expense");
    }
  }

  async function remove(id: string) {
    await api.delete(`/expenses/${id}`);
    await loadData(from, to);
  }

  if (loading || !summary) return <Spinner />;

  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Fixed overheads and variable costs — what's going out." />

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-500">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button onClick={applyRange} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Apply
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Fixed costs" value={format(summary.fixed_total)} />
        <StatCard label="Variable costs" value={format(summary.variable_total)} />
        <StatCard label="VAT" value={format(summary.vat_total)} hint="reclaimable if VAT-registered" />
        <StatCard label="Total spend" value={format(summary.grand_total)} accent="rose" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          {canWrite && (
            <Card className="mb-4">
              <form onSubmit={addExpense} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700">Category</label>
                  <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputCls}>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.kind === "FIXED" ? "Fixed" : "Variable"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Payment</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                    {METHODS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Amount (incl VAT)</label>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">of which VAT</label>
                  <input value={vat} onChange={(e) => setVat(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700">Description</label>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" className={inputCls} />
                </div>
                <div className="sm:col-span-2">
                  <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                    Add expense
                  </button>
                  {error && <span className="ml-3 text-sm text-rose-600">{error}</span>}
                </div>
              </form>
            </Card>
          )}

          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="px-5 py-3 font-medium">Date</th>
                    <th className="px-5 py-3 font-medium">Category</th>
                    <th className="px-5 py-3 text-right font-medium">Amount</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-slate-400">
                        No expenses in this range.
                      </td>
                    </tr>
                  ) : (
                    expenses.map((x) => (
                      <tr key={x.id} className="border-b border-slate-100">
                        <td className="px-5 py-3 text-slate-500">{x.date}</td>
                        <td className="px-5 py-3">
                          <span className="font-medium text-slate-800">{x.category_name}</span>
                          {x.description && <span className="ml-2 text-slate-400">{x.description}</span>}
                          <Badge tone={x.kind === "FIXED" ? "slate" : "amber"}>
                            {x.kind === "FIXED" ? "Fixed" : "Variable"}
                          </Badge>
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-slate-900">{format(x.amount)}</td>
                        <td className="px-5 py-3 text-right">
                          {canWrite && (
                            <button onClick={() => remove(x.id)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50">
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Breakdown by category */}
        <Card>
          <h3 className="font-semibold text-slate-900">By category</h3>
          {summary.by_category.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">No spend yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {summary.by_category.map((c) => (
                <li key={c.category_id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-700">{c.category_name}</span>
                  <span className="font-medium text-slate-900">{format(c.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
