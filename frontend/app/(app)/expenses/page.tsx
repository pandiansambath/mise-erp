"use client";

import Link from "next/link";
import { fmtQty } from "@/lib/quantity";
import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type Expense,
  type ExpenseCategory,
  type ExpenseSummary,
  type Item,
} from "@/lib/api";
import { Badge, Button, Card, PageHeader, Skeleton, StatCard } from "@/components/ui";
import { SheetPopup } from "@/components/SheetPopup";
import { SubNav } from "@/components/SubNav";
import { Bars, Donut, Treemap, Waffle, type DonutSegment } from "@/components/charts";
import { Select } from "@/components/Select";
import { SortBar, useSort } from "@/components/sortable";
import { useConfirm } from "@/components/confirm";
import { ListManager } from "@/components/ListManager";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { RangeControls, rangeCaption } from "@/components/RangeControls";
import { localISODate } from "@/lib/date";
import { numeric } from "@/lib/sanitize";
import { spotlight, useDeepLink } from "@/components/fx";

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

  // "in expense section we need to return to today's in filter even when it is
  //  changed for investigation... always show today's expense."
  //
  // NOTE, because this REVERSES something he asked for earlier: remembering the
  // range for the session was itself his request, and it still holds everywhere
  // else — Reports, Attendance, Sales. Expenses is the exception he has now
  // named, and the reason is sound: you widen it to chase one thing down, and
  // then every later glance is quietly answering a question you stopped asking.
  // So this page always opens on today and the range is a deliberate act each
  // time, rather than a state you can be left in without noticing.
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const sort = useSort<"date" | "category" | "amount">("date", "desc");
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // recurring detection: the last ~3 months, scanned quietly once
  const [recurring, setRecurring] = useState<{ name: string; amount: number; months: number }[]>([]);
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
  const [repeats, setRepeats] = useState(false); // auto-log again every month
  const [editingId, setEditingId] = useState<string | null>(null);
  /** The category popup, and the fold for the fields nobody fills in most
   *  days. Both exist so the form stays SHORT: its Save button must never be
   *  below the fold on the page whose job is logging a spend. */
  const [catPick, setCatPick] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // ⌘K "Add an expense" (?new=1) → scroll, ring-pulse and focus the form
  useDeepLink({ new: () => spotlight("expense-form") }, !loading);

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
    // Deliberately NOT remembered — see the range initialiser above.
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

  // Recurring detection: same category, near-same amount, in 2+ different
  // months of the last 90 days -> "this looks like a standing bill".
  useEffect(() => {
    const start = new Date();
    start.setDate(start.getDate() - 90);
    api
      .get<Expense[]>(`/expenses?date_from=${localISODate(start)}&date_to=${today()}`)
      .then((all) => {
        const groups = new Map<string, { amount: number; months: Set<string> }>();
        for (const e of all) {
          const amt = parseFloat(e.amount) || 0;
          if (amt <= 0) continue;
          // bucket amounts to +/-5% so a small VAT wobble still matches
          const bucket = Math.round(Math.log(amt) / Math.log(1.05));
          const key = `${e.category_name}|${bucket}`;
          const g = groups.get(key) ?? { amount: amt, months: new Set<string>() };
          g.months.add(e.date.slice(0, 7));
          groups.set(key, g);
        }
        setRecurring(
          [...groups.entries()]
            .filter(([, g]) => g.months.size >= 2)
            .map(([key, g]) => ({ name: key.split("|")[0], amount: g.amount, months: g.months.size }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 4),
        );
      })
      .catch(() => {});
  }, []);

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
      const body = {
        category_id: categoryId,
        date,
        amount: total,
        vat_amount: vat || "0",
        payment_method: method,
        description: desc,
        is_recurring: repeats,
        recurrence: repeats ? "MONTHLY" : null,
      };
      if (editingId) {
        await api.patch(`/expenses/${editingId}`, body);
      } else {
        try {
          await api.post<Expense>("/expenses", body);
        } catch (err) {
          // Same fixed cost twice in a month → the server warns. Human decides.
          if (err instanceof ApiError && err.status === 409) {
            const sure = await confirm({
              title: "Possible double-count",
              message: `${err.message} Log it anyway?`,
              confirmText: "Log anyway",
              tone: "danger",
            });
            if (!sure) return;
            await api.post<Expense>(`/expenses?force=true`, body);
          } else {
            throw err;
          }
        }
      }
      setAmount("");
      setVat("");
      setDescription("");
      setExtra("");
      setExtraReason("");
      setRepeats(false);
      setEditingId(null);
      await loadData(from, to);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add expense");
    }
  }

  function startEdit(exp: Expense) {
    setEditingId(exp.id);
    setCategoryId(exp.category_id);
    setDate(exp.date);
    setAmount(exp.amount);
    setVat(exp.vat_amount !== "0.00" && exp.vat_amount !== "0" ? exp.vat_amount : "");
    setMethod(exp.payment_method);
    setDescription(exp.description ?? "");
    setRepeats(exp.is_recurring);
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  if (loading || !summary) {
    return (
      <div>
        <PageHeader title="Expenses" subtitle="Fixed overheads and variable costs — what's going out." />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-24" />
            </Card>
          ))}
        </div>
        <Card className="mt-6">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-4 h-40" />
        </Card>
      </div>
    );
  }

  const inputCls =
    "mise-well mt-1 w-full rounded-xl px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-faint";

  const grandTotal = parseFloat(summary.grand_total) || 0;
  const donutSegs: DonutSegment[] = (() => {
    const sorted = [...summary.by_category].sort((a, b) => (parseFloat(b.total) || 0) - (parseFloat(a.total) || 0));
    const top = sorted.slice(0, 5).map((c) => ({ label: c.category_name, value: parseFloat(c.total) || 0 }));
    const rest = sorted.slice(5).reduce((s, c) => s + (parseFloat(c.total) || 0), 0);
    return rest > 0 ? [...top, { label: "Other", value: rest, color: "#94a3b8" }] : top;
  })();

  const sortedExpenses = sort.sortRows(expenses, (x, k) =>
    k === "amount" ? parseFloat(x.amount || "0") : k === "category" ? x.category_name : x.date,
  );

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Fixed overheads and variable costs — what's going out." />

      <SubNav
        items={[
          {
            key: "add",
            label: "Add expense",
            icon: "＋",
            onSelect: () => spotlight("expense-form"),
          },
          {
            key: "scan",
            label: "Upload a bill",
            icon: "📷",
            // Hands the file straight to the AI rather than making you read a
            // receipt and retype it. One gesture: the bubble opens and the file
            // chooser opens with it.
            onSelect: () =>
              window.dispatchEvent(
                new CustomEvent("mise:attach", { detail: { mode: "chat:receipt" } }),
              ),
          },
          {
            key: "month",
            label: "This month",
            icon: "📅",
            onSelect: () => applyRange(monthStart(), today()),
          },
          {
            key: "recurring",
            label: "Standing bills",
            icon: "🔁",
            // Costs that repeat monthly are the ones worth reviewing; they were
            // detected already but only mentioned in a paragraph.
            count: recurring.length,
            onSelect: () => spotlight("recurring-hint"),
          },
        ]}
      />

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
        {/* LEFT — the analysis, then the entries. All of it reads top-down
            while the form stays pinned beside it. */}
        <div className="order-2 min-w-0 space-y-6 lg:order-1 lg:col-span-2">

        {(() => {
          // The petty-cash drawer: every small cash spend in this range, largest first.
          const petty = expenses.filter((e) => e.category_name.toLowerCase() === "petty cash");
          if (petty.length === 0) return null;
          const total = petty.reduce((t, e) => t + (parseFloat(e.amount) || 0), 0);
          return (
            <Card className="mise-feel mt-6">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-fg">🪙 Petty-cash drawer</h2>
                <span className="font-mono text-sm text-fg-soft">{format(String(total))} total</span>
              </div>
              <p className="text-xs text-fg-faint">small cash spends this period, largest first</p>
              <div className="mise-well mt-4 rounded-xl p-3">
                <Bars
                  formatValue={(v) => format(String(v))}
                  items={[...petty]
                    .sort((a, b) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))
                    .slice(0, 8)
                    .map((e) => ({
                      label: `${e.date.slice(5)} · ${(e.description || "petty cash").slice(0, 28)}`,
                      value: parseFloat(e.amount) || 0,
                      color: "#f59e0b",
                    }))}
                />
                {petty.length > 8 && (
                  <p className="mt-2 text-[11px] text-fg-faint">+{petty.length - 8} more smaller spends</p>
                )}
              </div>
            </Card>
          );
        })()}

          {summary && summary.by_category.length > 0 && (
            <Card className="p-0">
              <div className="border-b border-line px-5 py-3">
                <h2 className="text-sm font-semibold text-fg">By category</h2>
                <p className="text-xs text-fg-faint">Click a category to see its entries and the stock items it covers.</p>
              </div>
              <div className="mise-stagger space-y-2 p-3">
                {summary.by_category.map((c) => {
                  const open = expanded.has(c.category_id);
                  const entries = expenses.filter((e) => e.category_id === c.category_id);
                  const stock = items.filter(
                    (i) => (i.category || "").toLowerCase() === c.category_name.toLowerCase()
                  );
                  return (
                    /* The Roles & Access card, verbatim: inset shadow, a tinted
                       stripe down the left, and press feedback. "please take
                       /staff and /purchasing as reference for the UI — the
                       cards, shadow, popup." These were flat rows divided by
                       hairlines, which is the one thing those two pages never
                       do. The stripe carries fixed-vs-variable, so the badge is
                       no longer the only thing saying it. */
                    <div key={c.category_id}>
                      <button
                        type="button"
                        onClick={() => toggleCat(c.category_id)}
                        className={`mise-card-inset mise-press relative w-full overflow-hidden px-4 py-3 pl-5 text-left ${
                          open ? "ring-1 ring-brand-400/40" : ""
                        }`}
                      >
                        <span
                          aria-hidden
                          className={`absolute inset-y-0 left-0 w-1 ${
                            c.kind === "FIXED" ? "bg-slate-400/70" : "bg-amber-400/80"
                          }`}
                        />
                        <span className="flex items-center gap-3">
                          <span className={`text-fg-faint transition-transform duration-200 ${open ? "rotate-90" : ""}`}>▸</span>
                          <span className="font-display font-semibold text-fg">{c.category_name}</span>
                          <Badge tone={c.kind === "FIXED" ? "slate" : "amber"}>
                            {c.kind === "FIXED" ? "Fixed" : "Variable"}
                          </Badge>
                          <span className="ml-auto font-mono font-semibold text-fg">{format(c.total)}</span>
                        </span>
                        {/* share of the period's spend, at a glance */}
                        <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-glass/10">
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${grandTotal > 0 ? Math.max(1.5, ((parseFloat(c.total) || 0) / grandTotal) * 100) : 0}%`,
                              background: c.kind === "FIXED" ? "#94a3b8" : "#f59e0b",
                              transition: "width 800ms cubic-bezier(0.22,1,0.36,1)",
                            }}
                          />
                        </span>
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
                                  {i.name} <span className="text-fg-faint">· {fmtQty(i.current_stock, i.unit)}</span>
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

          {/* Standing-bill suggestions come AFTER the entries, not before them.
              Same rule as every other page: the thing you came for leads. */}
        {recurring.length > 0 && (
          <Card id="recurring-hint" className="mise-feel mt-6 scroll-mt-24 border-copper-500/25">
            <h2 className="text-sm font-semibold text-fg">🔁 These look like standing bills</h2>
            <p className="text-xs text-fg-faint">
              Same category, near-same amount, seen in more than one of the last 3 months. Put them in{" "}
              <Link href="/profile" className="text-brand-400 underline">Profile → Monthly overheads</Link> and they post
              themselves — no more remembering the rent.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {recurring.map((r) => (
                <div key={r.name + r.amount} className="mise-well mise-feel flex items-baseline gap-2 rounded-lg px-3 py-2 text-sm">
                  <span className="text-fg">{r.name}</span>
                  <span className="mb-1 flex-1 border-b border-dotted border-line" />
                  <span className="font-mono text-fg-soft">~{format(String(r.amount))}</span>
                  <span className="text-[10px] text-fg-faint">× {r.months} months</span>
                </div>
              ))}
            </div>
          </Card>
        )}

          {/* THE ENTRIES, AS CARDS.
              "take /staff and /purchasing as reference for the UI — the cards,
              shadow, popup." This was a bare table: hairline rules, no depth,
              nothing you could press. It is the same card those two pages use —
              inset shadow, a stripe carrying fixed-vs-variable, press feedback —
              and the whole card still opens the entry for editing.

              The sort did not go with the table. `SortBar` is the same `Sort`
              object the column headers were driving, as chips, so ordering a
              ledger by date or amount survives the change of clothes. */}
          <Card className="p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
              <h2 className="text-sm font-semibold text-fg">Entries</h2>
              <SortBar
                sort={sort}
                options={[
                  { k: "date", label: "Date" },
                  { k: "category", label: "Category" },
                  { k: "amount", label: "Amount" },
                ]}
              />
            </div>
            {expenses.length === 0 ? (
              <p className="px-5 py-8 text-center text-fg-faint">No expenses in this range.</p>
            ) : (
              <div className="mise-stagger space-y-2 p-3">
                {sortedExpenses.map((x) => {
                  const editable = canWrite && !x.from_payroll;
                  return (
                    <div
                      key={x.id}
                      role={editable ? "button" : undefined}
                      tabIndex={editable ? 0 : undefined}
                      onClick={editable ? () => startEdit(x) : undefined}
                      onKeyDown={
                        editable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                startEdit(x);
                              }
                            }
                          : undefined
                      }
                      title={
                        editable
                          ? "Edit this entry"
                          : x.from_payroll
                            ? "This came from payroll — edit it there"
                            : undefined
                      }
                      className={`mise-card-inset relative flex items-center gap-3 overflow-hidden px-4 py-3 pl-5 ${
                        editable ? "mise-press cursor-pointer" : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`absolute inset-y-0 left-0 w-1 ${
                          x.kind === "FIXED" ? "bg-slate-400/70" : "bg-amber-400/80"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-display font-semibold text-fg">
                            {x.category_name}
                          </span>
                          <Badge tone={x.kind === "FIXED" ? "slate" : "amber"}>
                            {x.kind === "FIXED" ? "Fixed" : "Variable"}
                          </Badge>
                          {x.payment_method && (
                            <Badge tone="slate">
                              {METHOD_LABEL[x.payment_method] ?? x.payment_method}
                            </Badge>
                          )}
                          {x.from_payroll && <Badge tone="green">💷 from payroll</Badge>}
                          {x.auto_added && <Badge tone="green">🔁 auto-added</Badge>}
                          {x.is_recurring && !x.auto_added && (
                            <Badge tone="amber">🔁 repeats monthly</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-fg-faint">
                          {x.date}
                          {x.description ? ` · ${x.description}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono font-semibold tabular-nums text-fg">
                        {format(x.amount)}
                      </span>
                      {canWrite && (
                        /* Without stopPropagation, removing would ALSO open the
                           entry for editing behind the confirm — editing the
                           thing you are being asked whether to destroy. */
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            remove(x.id);
                          }}
                          title="Remove this entry"
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

        {/* The breakdown charts sit at the BOTTOM of this column.
            "core numbers first, pie charts last." The totals answer "what did
            we spend"; the entries are what you came to read or correct. A pie
            of the split is worth having and worth having LAST. */}
        {donutSegs.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card className="mise-feel">
              <div className="flex items-baseline justify-between">
                <h2 className="text-sm font-semibold text-fg">Where it went</h2>
                <span className="text-xs text-fg-faint">{rangeCaption({ from, to })}</span>
              </div>
              <Donut
                segments={donutSegs}
                centerValue={format(summary.grand_total)}
                centerLabel="total spend"
                className="mt-4"
                formatValue={(v) => format(String(v))}
              />
            </Card>
            <Card className="mise-feel">
              <div className="mise-well mb-4 rounded-xl p-4">
                <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                  Fixed bills vs variable costs — each square is 1%
                </p>
                <Waffle
                  formatValue={(v) => format(String(v))}
                  segments={[
                    { label: "Variable (moves with sales)", value: parseFloat(summary.variable_total) || 0, color: "#f59e0b" },
                    { label: "Fixed (arrives regardless)", value: parseFloat(summary.fixed_total) || 0, color: "#94a3b8" },
                  ].filter((x) => x.value > 0)}
                />
              </div>
              <h2 className="text-sm font-semibold text-fg">The expense map</h2>
              <p className="text-xs text-fg-faint">bigger box = more money — spot the heavy categories in one glance</p>
              <Treemap
                className="mt-4"
                items={summary.by_category.map((c) => ({
                  label: c.category_name,
                  value: parseFloat(c.total) || 0,
                }))}
                formatValue={(v) => format(String(v))}
              />
            </Card>
          </div>
        )}

        </div>

        {/* RIGHT — the form. Pinned, and level with the top of the page:
            "the main part is placed very bottom" was exactly right. */}
        <div className="order-1 space-y-4 self-start lg:order-2 lg:sticky lg:top-4">
          {canWrite && (
            <Card id="expense-form">
              <h3 className="mb-3 font-semibold text-fg">{editingId ? "✏️ Edit expense" : "Add expense"}</h3>
              {editingId && (
                <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                  Editing an existing entry — Save updates it in place.{" "}
                  <button type="button" className="underline" onClick={() => { setEditingId(null); setAmount(""); setDescription(""); setRepeats(false); }}>cancel</button>
                </p>
              )}
              {/* SHORT BY DEFAULT.
                  "I need to scrollllll till down to reach that expense entering
                   card." The card was already beside the entries — the problem
                  was its HEIGHT: twenty category tiles, then date, payment,
                  amount, VAT, surcharge, a reason and a description, so Save sat
                  far below the fold. My category tiles made that worse.

                  Most expenses are three facts: what it was for, how much, and
                  it happened today. Those three are the form. The other six are
                  real and stay — behind one toggle, where they cost nothing
                  until you need them. */}
              <form onSubmit={addExpense} className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-fg-soft">What for</label>
                  <button
                    type="button"
                    onClick={() => setCatPick(true)}
                    className="mise-card-inset mise-press relative mt-1 flex w-full items-center gap-2 overflow-hidden px-3 py-2.5 text-left"
                  >
                    {(() => {
                      const c = categories.find((x) => x.id === categoryId);
                      return (
                        <>
                          <span
                            aria-hidden
                            className={`absolute inset-y-0 left-0 w-1 ${
                              c?.kind === "FIXED" ? "bg-slate-400/60" : "bg-amber-400/70"
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate pl-1 text-sm font-medium text-fg">
                            {c?.name ?? "Pick a category"}
                          </span>
                          <span aria-hidden className="shrink-0 text-fg-faint">▾</span>
                        </>
                      );
                    })()}
                  </button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-fg-soft">
                    Amount <span className="text-fg-faint">(incl VAT)</span>
                  </label>
                  <input
                    value={amount}
                    onChange={(e) => setAmount(numeric(e.target.value))}
                    inputMode="decimal"
                    required
                    placeholder="0.00"
                    className="mise-well mt-1 w-full rounded-lg px-3 py-3 text-right font-display text-xl tabular-nums outline-none"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={!categoryId || !(parseFloat(amount) > 0)}
                    data-tone="brand"
                    className="mise-btn-flat mise-press flex-1 px-4 py-3 text-sm font-bold text-brand-300 disabled:opacity-40"
                  >
                    {/* "Save expense", not "Add expense" — the SubNav already
                        has an "＋ Add expense" that TAKES YOU HERE. Two controls
                        with the same words doing different things is ambiguous
                        for a person, and it silently picked the wrong one for a
                        selector: a test reported this form broken when it had
                        clicked the navigation shortcut and submitted nothing. */}
                    {editingId ? "Save changes" : "Save expense"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMoreOpen((v) => !v)}
                    aria-expanded={moreOpen}
                    className="mise-btn-flat mise-press px-3 py-3 text-sm text-fg-soft"
                  >
                    {moreOpen ? "Less ▲" : "More ▾"}
                  </button>
                </div>

                {/* Everything that is real but rarely touched. Nothing was
                    removed — it is one tap away instead of eight rows tall. */}
                <div className={moreOpen ? "grid grid-cols-2 gap-3 pt-1" : "hidden"}>
                  <div>
                    <label className="block text-sm font-medium text-fg-soft">Date</label>
                    <input type="date" value={date} max={localISODate()} onChange={(e) => setDate(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-fg-soft">Payment</label>
                    <Select value={method} onChange={setMethod} className="mt-1" options={METHODS} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-fg-soft">of which VAT</label>
                    <input value={vat} onChange={(e) => setVat(numeric(e.target.value))} inputMode="decimal" placeholder="0.00" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-fg-soft">Extra / surcharge (+)</label>
                    <input value={extra} onChange={(e) => setExtra(numeric(e.target.value))} inputMode="decimal" placeholder="0.00" className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-fg-soft">Why the extra?</label>
                    <input value={extraReason} onChange={(e) => setExtraReason(e.target.value)} placeholder="optional reason" className={inputCls} />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-fg-soft">Description</label>
                    <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="optional" className={inputCls} />
                  </div>
                  <label className="col-span-2 flex items-center gap-2 text-sm text-fg-soft">
                    <input
                      type="checkbox"
                      checked={repeats}
                      onChange={(e) => setRepeats(e.target.checked)}
                      className="h-4 w-4 accent-brand-500"
                    />
                    Repeats every month
                  </label>
                </div>
              </form>
            </Card>
          )}

          {/* Every category, over the page — the picker that used to be twenty
              tiles nailed above the amount box. */}
          {catPick && (
            <SheetPopup
              onClose={() => setCatPick(false)}
              title="What was it for?"
              subtitle="fixed costs carry the grey stripe, variable the amber"
              columns={3}
            >
              <div className="mise-stagger grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {categories
                  .filter((c) => c.is_active)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setCategoryId(c.id);
                        setCatPick(false);
                      }}
                      className={`mise-card-inset mise-press relative flex items-center gap-2 overflow-hidden p-3 pl-4 text-left ${
                        categoryId === c.id ? "ring-1 ring-brand-400/50" : ""
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`absolute inset-y-0 left-0 w-1 ${
                          c.kind === "FIXED" ? "bg-slate-400/60" : "bg-amber-400/70"
                        }`}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                        {c.name}
                      </span>
                      {categoryId === c.id && (
                        <span className="shrink-0 text-[11px] text-brand-300">current</span>
                      )}
                    </button>
                  ))}
              </div>
            </SheetPopup>
          )}

          {isSuper && (
            <button
              onClick={() => setCatModal(true)}
              className="mise-raised mise-press flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm text-fg-soft"
            >
              <span className="flex items-center gap-2"><span aria-hidden>⚙</span> Manage categories</span>
              <span className="text-fg-faint">{categories.length} →</span>
            </button>
          )}
        </div>
      </div>

      {catModal && (
        <SheetPopup
          onClose={() => setCatModal(false)}
          title="Manage expense categories"
          subtitle="Archiving only hides a category from new entries — past records keep it"
          columns={2}
        >
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
        </SheetPopup>
      )}
    </div>
  );
}
