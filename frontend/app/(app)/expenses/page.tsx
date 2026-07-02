"use client";

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type Expense,
  type ExpenseCategory,
  type ExpenseSummary,
  type Item,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { Select } from "@/components/Select";
import { SortTh, useSort } from "@/components/sortable";
import { useConfirm } from "@/components/confirm";
import { ListManager } from "@/components/ListManager";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { RangeControls, rangeCaption } from "@/components/RangeControls";
import { localISODate } from "@/lib/date";

// Payment methods the owner actually uses. Stored as the value; shown as the label.
const METHODS: { value: string; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "CARD_ONLINE", label: "Card – online" },
  { value: "CARD_SHOP", label: "Card – in shop" },
  { value: "GIFTCARD", label: "Gift card" },
  { value: "BANK", label: "Bank transfer" },
];
// Label any stored code (incl. older BANK/CARD/ONLINE) for display.
const METHOD_LABEL: Record<string, string> = {
  ...Object.fromEntries(METHODS.map((m) => [m.value, m.label])),
  CARD: "Card",
  ONLINE: "Online",
};
const monthStart = () => localISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const today = () => localISODate();

export default function ExpensesPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "expenses:write");
  const isSuper = user?.role === "SUPER_ADMIN";
  const [catModal, setCatModal] = useState(false);

  const reloadCategories = async () => {
    setCategories(await api.get<ExpenseCategory[]>("/expenses/categories"));
  };

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const sort = useSort<"date" | "category" | "amount">("date", "desc");
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // form
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [vat, setVat] = useState("");
  const [method, setMethod] = useState("CASH");
  const [description, setDescription] = useState("");
  // Optional top-up on top of the base amount (e.g. £900 gas + £50 surcharge). Both
  // are summed into the saved total, and the split is recorded in the description.
  const [extra, setExtra] = useState("");
  const [extraReason, setExtraReason] = useState("");

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
      api.get<Item[]>("/inventory/items").then(setItems).catch(() => setItems([])),
      loadData(from, to),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyRange(f: string, t: string) {
    setFrom(f);
    setTo(t);
    setLoading(true);
    loadData(f, t).finally(() => setLoading(false));
  }

  function toggleCat(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Petty cash = small ad-hoc cash spends (cash to staff, bought something outside).
  // It's just a cash expense in a "Petty cash" category, so it flows into the P&L.
  async function startPettyCash() {
    setError(null);
    let cat = categories.find((c) => c.name.toLowerCase() === "petty cash");
    if (!cat) {
      try {
        cat = await api.post<ExpenseCategory>("/expenses/categories", { name: "Petty cash", kind: "VARIABLE" });
        setCategories((prev) => [...prev, cat as ExpenseCategory]);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not set up petty cash");
        return;
      }
    }
    setCategoryId(cat.id);
    setMethod("CASH");
    setDescription((d) => d || "Petty cash");
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const base = parseFloat(amount || "0");
      const ex = parseFloat(extra || "0");
      const total = (base + (isNaN(ex) ? 0 : ex)).toFixed(2);
      // Record the split in the description so the £900 + £50 stays explainable later.
      const desc =
        ex > 0
          ? `${description ? description + " — " : ""}£${base.toFixed(2)} base + £${ex.toFixed(2)} extra${extraReason ? ` (${extraReason})` : ""}`
          : description || null;
      await api.post<Expense>("/expenses", {
        category_id: categoryId,
        date,
        amount: total,
        vat_amount: vat || "0",
        payment_method: method,
        description: desc,
      });
      setAmount("");
      setVat("");
      setDescription("");
      setExtra("");
      setExtraReason("");
      await loadData(from, to);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add expense");
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Delete this expense?",
      message: "It will be removed from your records and the P&L.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await api.delete(`/expenses/${id}`);
    await loadData(from, to);
  }

  if (loading || !summary) return <Spinner />;

  const inputCls =
    "mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25";

  const sortedExpenses = sort.sortRows(expenses, (x, k) =>
    k === "amount" ? parseFloat(x.amount || "0") : k === "category" ? x.category_name : x.date,
  );

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Fixed overheads and variable costs — what's going out." />

      <RangeControls range={{ from, to }} onChange={(r) => applyRange(r.from, r.to)} className="mb-2" />
      <p className="mb-6 text-sm text-fg-faint">
        Showing spends for <b className="text-fg-soft">{rangeCaption({ from, to })}</b>. The totals and list
        below are just this period — switch the range to compare months.
      </p>

      <div className="mise-stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Fixed costs" value={format(summary.fixed_total)} />
        <StatCard label="Variable costs" value={format(summary.variable_total)} />
        <StatCard label="VAT" value={format(summary.vat_total)} hint="reclaimable if VAT-registered" />
        <StatCard label="Total spend" value={format(summary.grand_total)} accent="rose" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* LEFT — the data (breakdown + entries) */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {summary && summary.by_category.length > 0 && (
            <Card className="p-0">
              <div className="border-b border-line px-5 py-3">
                <h2 className="text-sm font-semibold text-fg">By category</h2>
                <p className="text-xs text-fg-faint">Click a category to see its entries and the stock items it covers.</p>
              </div>
              <div>
                {summary.by_category.map((c) => {
                  const open = expanded.has(c.category_id);
                  const entries = expenses.filter((e) => e.category_id === c.category_id);
                  const stock = items.filter(
                    (i) => (i.category || "").toLowerCase() === c.category_name.toLowerCase()
                  );
                  return (
                    <div key={c.category_id} className="border-b border-line last:border-0">
                      <button
                        type="button"
                        onClick={() => toggleCat(c.category_id)}
                        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-paper-2"
                      >
                        <span className={`text-fg-faint transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
                        <span className="font-medium text-fg">{c.category_name}</span>
                        <Badge tone={c.kind === "FIXED" ? "slate" : "amber"}>
                          {c.kind === "FIXED" ? "Fixed" : "Variable"}
                        </Badge>
                        <span className="ml-auto font-semibold text-fg">{format(c.total)}</span>
                      </button>
                      {open && (
                        <div className="bg-paper-2/40 px-5 pb-4 pt-1 text-sm">
                          <p className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
                            Entries ({entries.length})
                          </p>
                          {entries.length === 0 ? (
                            <p className="text-fg-faint">No entries in this range.</p>
                          ) : (
                            entries.map((e) => (
                              <div key={e.id} className="flex justify-between gap-3 border-b border-line/40 py-1 last:border-0">
                                <span className="text-fg-soft">
                                  {e.date}
                                  {e.description ? ` · ${e.description}` : ""}{" "}
                                  <span className="text-fg-faint">({METHOD_LABEL[e.payment_method] ?? e.payment_method})</span>
                                </span>
                                <span className="text-fg">{format(e.amount)}</span>
                              </div>
                            ))
                          )}
                          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-fg-faint">
                            Stock items ({stock.length})
                          </p>
                          {stock.length === 0 ? (
                            <p className="text-fg-faint">No stock items in a matching category.</p>
                          ) : (
                            stock.map((i) => (
                              <div key={i.id} className="flex justify-between gap-3 border-b border-line/40 py-1 last:border-0">
                                <span className="text-fg-soft">
                                  {i.name} <span className="text-fg-faint">· {i.current_stock} {i.unit}</span>
                                </span>
                                <span className="text-fg">
                                  {i.average_cost && Number(i.average_cost) > 0 ? `${format(i.average_cost)}/${i.unit}` : "—"}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                    <SortTh k="date" label="Date" sort={sort} />
                    <SortTh k="category" label="Category" sort={sort} />
                    <SortTh k="amount" label="Amount" sort={sort} right />
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-8 text-center text-fg-faint">
                        No expenses in this range.
                      </td>
                    </tr>
                  ) : (
                    sortedExpenses.map((x) => (
                      <tr key={x.id} className="border-b border-line">
                        <td className="px-5 py-3 text-fg-faint">{x.date}</td>
                        <td className="px-5 py-3">
                          <span className="font-medium text-fg">{x.category_name}</span>
                          {x.description && <span className="ml-2 text-fg-faint">{x.description}</span>}
                          <Badge tone={x.kind === "FIXED" ? "slate" : "amber"}>
                            {x.kind === "FIXED" ? "Fixed" : "Variable"}
                          </Badge>
                          {x.payment_method && (
                            <Badge tone="slate">{METHOD_LABEL[x.payment_method] ?? x.payment_method}</Badge>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-fg">{format(x.amount)}</td>
                        <td className="px-5 py-3 text-right">
                          {canWrite && (
                            <button onClick={() => remove(x.id)} className="rounded-md border border-line px-2 py-1 text-xs text-fg-faint hover:bg-paper-2">
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

        {/* RIGHT — add expense + manage (superadmin), sticky on desktop */}
        <div className="space-y-4 self-start lg:sticky lg:top-4">
          {canWrite && (
            <Card>
              <h3 className="mb-3 font-semibold text-fg">Add expense</h3>
              <form onSubmit={addExpense} className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-fg-soft">Category</label>
                  <Select
                    value={categoryId}
                    onChange={setCategoryId}
                    className="mt-1"
                    options={categories
                      .filter((c) => c.is_active)
                      .map((c) => ({
                        value: c.id,
                        label: `${c.name} · ${c.kind === "FIXED" ? "Fixed" : "Variable"}`,
                      }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">Payment</label>
                  <Select value={method} onChange={setMethod} className="mt-1" options={METHODS} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">Amount (incl VAT)</label>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">of which VAT</label>
                  <input value={vat} onChange={(e) => setVat(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">Extra / surcharge (+)</label>
                  <input value={extra} onChange={(e) => setExtra(e.target.value)} inputMode="decimal" placeholder="0.00" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">Why the extra?</label>
                  <input value={extraReason} onChange={(e) => setExtraReason(e.target.value)} placeholder="optional reason" className={inputCls} />
                </div>
                {parseFloat(extra || "0") > 0 && (
                  <p className="col-span-2 -mt-1 text-xs text-fg-faint">
                    Total saved = <b className="text-fg-soft">{format(String((parseFloat(amount || "0") + parseFloat(extra || "0")).toFixed(2)))}</b>{" "}
                    ({format(amount || "0")} base + {format(extra)} extra). Use this when you pay a bit more than the
                    usual amount (e.g. £900 gas + £50 surcharge) — both are added together and the split is noted.
                  </p>
                )}
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-fg-soft">Description</label>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" className={inputCls} />
                </div>
                <div className="col-span-2 flex flex-wrap items-center gap-2">
                  <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                    Add expense
                  </button>
                  <button type="button" onClick={startPettyCash} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2" title="Cash to staff, or something bought outside">
                    ＋ Petty cash
                  </button>
                </div>
                {error && <p className="col-span-2 text-sm text-rose-400">{error}</p>}
              </form>
            </Card>
          )}

          {isSuper && (
            <button
              onClick={() => setCatModal(true)}
              className="flex w-full items-center justify-between rounded-xl border border-line bg-paper-2/60 px-4 py-3 text-sm text-fg-soft transition hover:border-brand-400/50 hover:bg-paper-2"
            >
              <span className="flex items-center gap-2"><span aria-hidden>⚙</span> Manage categories</span>
              <span className="text-fg-faint">{categories.length} →</span>
            </button>
          )}
        </div>
      </div>

      {catModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setCatModal(false)} aria-hidden />
          <div className="mise-pop-lg relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-paper-2 p-5 shadow-2xl shadow-black/50">
            <div className="mb-1 flex items-start justify-between">
              <h3 className="text-lg font-semibold text-fg">Manage expense categories</h3>
              <button onClick={() => setCatModal(false)} className="-mr-1 -mt-1 rounded-lg p-1 text-fg-faint hover:bg-paper hover:text-fg" aria-label="Close">✕</button>
            </div>
            <p className="mb-4 text-sm text-fg-faint">
              Add, rename or archive the categories you sort spending into. Archiving only hides a
              category from new entries — past records keep it.
            </p>
            <ListManager
              embedded
              title=""
              noun="category"
              usageNoun="expense"
              items={categories.map((c) => ({
                id: c.id,
                name: c.name,
                is_active: c.is_active,
                usage_count: c.usage_count ?? 0,
                badge: c.kind === "FIXED" ? "Fixed" : "Variable",
              }))}
              addFields={[
                {
                  key: "kind",
                  label: "Type",
                  type: "select",
                  default: "VARIABLE",
                  options: [
                    { value: "VARIABLE", label: "Variable cost" },
                    { value: "FIXED", label: "Fixed cost" },
                  ],
                },
              ]}
              onAdd={async (name, extra) => {
                await api.post("/expenses/categories", { name, kind: extra.kind });
              }}
              onRename={async (id, name) => {
                await api.patch(`/expenses/categories/${id}`, { name });
              }}
              onSetActive={async (id, active) => {
                await api.patch(`/expenses/categories/${id}`, { is_active: active });
              }}
              reload={reloadCategories}
            />
          </div>
        </div>
      )}
    </div>
  );
}
