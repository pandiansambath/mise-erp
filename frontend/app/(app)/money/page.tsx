"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  ApiError,
  type BudgetTargets,
  type BudgetVsActual,
  type DishMarginRow,
  type DishSalesOut,
  type MenuEngineering,
  type MoneyCentre,
  type PnL,
} from "@/lib/api";
import { Badge, Button, Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { Bars, Donut, Meter, Waffle, Sparkline } from "@/components/charts";
import { AnimatedNumber } from "@/components/fx";
import { useAuth } from "@/lib/auth";
import { CURRENCIES, useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const CLASS_META: Record<string, { emoji: string; label: string; tone: "green" | "amber" | "slate" | "red" }> = {
  star: { emoji: "⭐", label: "Star", tone: "green" },
  plowhorse: { emoji: "🐎", label: "Plowhorse", tone: "amber" },
  puzzle: { emoji: "🧩", label: "Puzzle", tone: "slate" },
  dog: { emoji: "🐕", label: "Dog", tone: "red" },
  none: { emoji: "·", label: "—", tone: "slate" },
};

/** Budget vs actual (this month): targets you set vs live actuals, with on-track ticks. */
function BudgetCard() {
  const { format } = useCurrency();
  const { user } = useAuth();
  const canWrite = can(user?.role, "reports:write");
  const [b, setB] = useState<BudgetVsActual | null>(null);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<BudgetTargets>({
    monthly_sales: null,
    food_cost_pct: null,
    labour_pct: null,
    net_margin_pct: null,
  });
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api.get<BudgetVsActual>("/reports/budget");
    setB(r);
    setForm(r.targets);
  }
  useEffect(() => {
    load().catch(() => {});
  }, []);

  async function save() {
    setBusy(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, v === "" || v == null ? null : v]),
      );
      const r = await api.put<BudgetVsActual>("/reports/budget", payload);
      setB(r);
      setForm(r.targets);
      setEdit(false);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  if (!b) return null;
  const ROWS: { key: keyof BudgetTargets; label: string; money?: boolean; higherBetter: boolean }[] = [
    { key: "monthly_sales", label: "Sales (this month)", money: true, higherBetter: true },
    { key: "food_cost_pct", label: "Food cost %", higherBetter: false },
    { key: "labour_pct", label: "Labour %", higherBetter: false },
    { key: "net_margin_pct", label: "Net margin %", higherBetter: true },
  ];
  const show = (v: string | null, money?: boolean) =>
    v == null ? "—" : money ? format(v) : `${v}%`;

  // % targets that are set → live gauges (needle animates in)
  const meterRows = ROWS.filter((r) => !r.money && b.targets[r.key] != null);

  return (
    <Card className="mise-feel mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-fg">Budget vs actual — this month</h3>
        {canWrite && (
          <Button variant="soft" size="sm" onClick={() => setEdit((v) => !v)}>
            {edit ? "Close" : "✎ Set targets"}
          </Button>
        )}
      </div>

      {edit && (
        <div className="mise-pop mt-3 grid grid-cols-2 gap-3 rounded-xl border border-line bg-paper-2/60 p-3 sm:grid-cols-4">
          {ROWS.map((r) => (
            <label key={r.key} className="block">
              <span className="block text-xs text-fg-faint">{r.label}{r.money ? "" : " %"}</span>
              <input
                inputMode="decimal"
                value={form[r.key] ?? ""}
                onChange={(e) => setForm({ ...form, [r.key]: e.target.value })}
                placeholder="—"
                className="mise-well mt-1 w-full rounded-lg px-2 py-1.5 text-sm text-fg outline-none"
              />
            </label>
          ))}
          <div className="col-span-2 sm:col-span-4">
            <Button variant="primary" onClick={save} busy={busy} busyLabel="Saving…">
              Save targets
            </Button>
          </div>
        </div>
      )}

      {meterRows.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {meterRows.map((r) => (
            <div key={r.key} className="mise-well mise-feel rounded-xl p-3">
              <Meter
                label={r.label}
                value={parseFloat(b.actual[r.key] ?? "0")}
                target={parseFloat(b.targets[r.key] ?? "0")}
                goodBelow={!r.higherBetter}
              />
            </div>
          ))}
        </div>
      )}

      <ul className="mt-3 divide-y divide-line">
        {ROWS.map((r) => {
          const target = b.targets[r.key];
          const actual = b.actual[r.key];
          const a = parseFloat(actual);
          const t = target == null ? null : parseFloat(target);
          const onTrack = t == null ? null : r.higherBetter ? a >= t : a <= t;
          return (
            <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-fg-soft">{r.label}</span>
              <span className="flex items-center gap-3">
                <span className="text-fg">{show(actual, r.money)}</span>
                <span className="text-xs text-fg-faint">target {show(target, r.money)}</span>
                {onTrack == null ? (
                  <span className="text-xs text-fg-faint">set a target</span>
                ) : (
                  <Badge tone={onTrack ? "green" : "red"}>{onTrack ? "✓ on track" : "off track"}</Badge>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Menu engineering (popularity × margin) + a today's-dishes-sold quick entry. */
function MenuEngineeringCard() {
  const { format } = useCurrency();
  const { user } = useAuth();
  const canWrite = can(user?.role, "sales:write");
  const today = new Date().toISOString().slice(0, 10);

  const [me, setMe] = useState<MenuEngineering | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [entry, setEntry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadMe() {
    setMe(await api.get<MenuEngineering>("/reports/menu-engineering"));
  }
  async function loadToday() {
    const d = await api.get<DishSalesOut>(`/sales/dishes/${today}`);
    setCounts(Object.fromEntries(d.counts.map((c) => [c.recipe_id, String(c.qty)])));
  }
  useEffect(() => {
    loadMe().catch(() => {});
    loadToday().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const payload = {
        counts: Object.entries(counts)
          .map(([recipe_id, q]) => ({ recipe_id, qty: parseInt(q) || 0 }))
          .filter((c) => c.qty >= 0),
      };
      await api.post(`/sales/dishes/${today}`, payload);
      await loadMe();
      setMsg("Saved today's dishes sold.");
      setEntry(false);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  if (!me) return null;

  return (
    <Card className="mise-feel mt-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-fg">Menu engineering</h3>
          <p className="text-xs text-fg-faint">
            Popularity × margin — what to promote (⭐), re-price (🐎), reposition (🧩) or cut (🐕).
            {me.has_data &&
              ` · ${me.total_units} sold · theoretical food cost ${me.theoretical_food_cost_pct}%`}
          </p>
        </div>
        {canWrite && (
          <Button variant="soft" size="sm" onClick={() => setEntry((v) => !v)}>
            {entry ? "Close" : "✎ Record dishes sold (today)"}
          </Button>
        )}
      </div>

      {msg && <p className="mt-2 text-sm text-brand-400">{msg}</p>}

      {entry && (
        <div className="mise-pop mt-3 rounded-xl border border-line bg-paper-2/60 p-3">
          <p className="mb-2 text-xs text-fg-faint">How many of each dish sold today ({today})?</p>
          <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {me.dishes.map((d) => (
              <label key={d.recipe_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-fg-soft">{d.name}</span>
                <input
                  inputMode="numeric"
                  value={counts[d.recipe_id] ?? ""}
                  onChange={(e) => setCounts({ ...counts, [d.recipe_id]: e.target.value })}
                  placeholder="0"
                  className="mise-well w-16 rounded-lg px-2 py-1 text-center text-sm outline-none"
                />
              </label>
            ))}
          </div>
          <Button variant="primary" className="mt-3" onClick={save} busy={busy} busyLabel="Saving…">
            Save
          </Button>
        </div>
      )}

      {!me.has_data ? (
        <p className="mt-3 rounded-lg bg-glass/5 px-3 py-3 text-sm text-fg-soft">
          No dishes-sold recorded for this month yet. {canWrite ? "Tap “Record dishes sold” above" : "Ask a manager to record dishes sold"} to
          unlock the matrix (which dishes are Stars vs Dogs) and your theoretical food cost.
        </p>
      ) : (
        <ul className="mt-3 max-h-[26rem] space-y-0.5 overflow-y-auto pr-1">
          {me.dishes.filter((d) => d.qty_sold > 0).map((d) => {
            const c = CLASS_META[d.klass] ?? CLASS_META.none;
            return (
              <li key={d.recipe_id} className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">
                    {c.emoji} {d.name}
                  </span>
                  <span className="block text-xs text-fg-faint">
                    {d.qty_sold} sold · {format(d.revenue)} revenue · {d.margin_pct}% margin
                  </span>
                </span>
                <Badge tone={c.tone}>{c.label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** GP% colour: healthy ≥ 65, watch 45–65, thin < 45 (rough kitchen rule of thumb). */
function marginCls(pct: number): string {
  if (pct >= 65) return "text-brand-400";
  if (pct >= 45) return "text-amber-400";
  return "text-rose-400";
}

function pctNum(v: string | null): number | null {
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

function DishRow({ d }: { d: DishMarginRow }) {
  const { format } = useCurrency();
  const m = pctNum(d.margin_pct);
  return (
    <li className="border-b border-line last:border-0">
      <Link
        href={`/recipes?open=${d.recipe_id}`}
        title={`Open ${d.name}`}
        className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition hover:bg-glass/5"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{d.name}</span>
          <span className="block text-xs text-fg-faint">
            {d.selling_price ? format(d.selling_price) : "—"} sell ·{" "}
            {d.cost_per_serving ? format(d.cost_per_serving) : "—"} cost
          </span>
        </span>
        <span className={`shrink-0 text-sm font-semibold ${m == null ? "text-fg-faint" : marginCls(m)}`}>
          {m == null ? "—" : `${d.margin_pct}%`}
        </span>
      </Link>
    </li>
  );
}

// A tiny "ⓘ" that pops a plain-English explanation — so even a beginner gets it.
function InfoDot({
  id, text, open, onToggle,
}: { id: string; text: string; open: boolean; onToggle: (id: string | null) => void }) {
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(open ? null : id); }}
        aria-label="What's this?"
        className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] font-semibold leading-none text-fg-faint hover:border-brand-400 hover:text-brand-300"
      >
        i
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-10" onClick={() => onToggle(null)} aria-hidden />
          <span className="fixed inset-x-4 top-24 z-50 block rounded-xl border border-line bg-paper-2 p-3 text-left text-xs font-normal normal-case leading-relaxed text-fg-soft shadow-xl shadow-black/40 sm:absolute sm:inset-x-auto sm:left-0 sm:top-6 sm:z-20 sm:w-64 sm:rounded-lg">
            {text}
          </span>
        </>
      )}
    </span>
  );
}

export default function MoneyPage() {
  const router = useRouter();
  const { format, currency } = useCurrency();
  const rate = CURRENCIES[currency].rate;
  const symbol = CURRENCIES[currency].symbol;
  const [data, setData] = useState<MoneyCentre | null>(null);
  const [pnl, setPnl] = useState<PnL | null>(null);
  // order-by-order paid prices behind each price-rise alert
  const [alertSparks, setAlertSparks] = useState<Record<string, number[]>>({});
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // chart → sub-chart: the items inside the tapped stock category
  const [catItems, setCatItems] = useState<Record<string, { label: string; value: number }[]>>({});
  const [selCat, setSelCat] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MoneyCentre>("/reports/money")
      .then((m) => {
        setData(m);
        // Same month-to-date range → the full in−out−profit waterfall.
        return api.get<PnL>(`/reports/pnl?date_from=${m.date_from}&date_to=${m.date_to}`);
      })
      .then(setPnl)
      .catch(() => setErr("Could not load money insights — refresh to retry."));
    // Per-item stock values, grouped by category — feeds the donut's sub-chart.
    api
      .get<{ name: string; category: string | null; current_stock: string; average_cost: string; is_active: boolean }[]>("/inventory/items")
      .then((items) => {
        const by: Record<string, { label: string; value: number }[]> = {};
        for (const i of items) {
          if (!i.is_active) continue;
          const v = (parseFloat(i.current_stock) || 0) * (parseFloat(i.average_cost) || 0);
          if (v <= 0) continue;
          const cat = i.category?.trim() || "Uncategorised";
          (by[cat] ??= []).push({ label: i.name, value: v });
        }
        for (const k of Object.keys(by)) by[k].sort((a, b) => b.value - a.value);
        setCatItems(by);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const alerts = data?.price_alerts?.slice(0, 6) ?? [];
    if (!alerts.length) return;
    Promise.all(
      alerts.map((a) =>
        api
          .get<{ date: string; price: string }[]>(`/reports/price-history/${a.item_id}`)
          .then((pts) => [a.item_id, pts.map((x) => parseFloat(x.price) || 0)] as const)
          .catch(() => [a.item_id, []] as const),
      ),
    ).then((entries) => setAlertSparks(Object.fromEntries(entries)));
  }, [data?.price_alerts]);

  if (err) return <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{err}</p>;
  if (!data) return <Spinner />;

  const be = data.break_even;
  const beSales = be.break_even_sales;
  const gap = be.gap == null ? null : parseFloat(be.gap);
  const dm = data.dish_margins;

  return (
    <div>
      <PageHeader
        title="Money"
        subtitle={`Every plate, every penny — where profit is made and lost. Month to date: ${data.date_from} → ${data.date_to}.`}
      />

      {/* Headline KPIs */}
      <div className="mise-stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Stock on hand"
          value={format(data.stock_value.total)}
          hint={`${data.stock_value.item_count} items at avg cost`}
          accent="copper"
          href="/inventory"
        />
        <StatCard
          label="Food cost"
          value={`${data.food_cost_pct}%`}
          hint="target 25–35%"
          accent="amber"
        />
        <StatCard label="Gross margin" value={`${data.gross_margin_pct}%`} accent="brand" />
        <StatCard
          label="Net profit (MTD)"
          value={format(data.net_profit)}
          hint={`${data.net_margin_pct}% margin`}
          accent={parseFloat(data.net_profit) >= 0 ? "brand" : "rose"}
        />
      </div>

      {/* Profit after everything — the plain in − out = profit picture */}
      {pnl && (
        <Card className="mise-feel mt-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-fg">Profit — after everything</h3>
            <span className="text-xs text-fg-faint">month to date</span>
          </div>
          <p className="mt-1 text-xs text-fg-faint">
            Follow it top to bottom: money in, take away what you spent, and the green box is what you keep.
          </p>

          {/* The same story as one picture — bars draw in when scrolled to */}
          <div className="mise-well mt-4 rounded-xl p-3">
            <Bars
              formatValue={(v) => format(String(v))}
              items={[
                { label: "Money in", value: Math.max(0, parseFloat(pnl.net_sales)), color: "#10b981" },
                { label: "Food cost", value: Math.max(0, parseFloat(pnl.cost_of_sales)), color: "#f43f5e" },
                { label: "Running costs", value: Math.max(0, parseFloat(pnl.operating_expenses)), color: "#f59e0b" },
                { label: "You keep", value: Math.max(0, parseFloat(pnl.net_profit)), color: "#38bdf8" },
              ]}
            />
          </div>

          {/* Every £1 as 100 squares — only when there IS money to split */}
          {parseFloat(pnl.net_sales) > 0 && (
          <div className="mise-well mt-4 rounded-xl p-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
              Every £1 you took in — square by square
            </p>
            <Waffle
              formatValue={(v) => format(String(v))}
              segments={[
                { label: "Food", value: Math.max(0, parseFloat(pnl.cost_of_sales)), color: "#f43f5e" },
                { label: "Running costs", value: Math.max(0, parseFloat(pnl.operating_expenses)), color: "#f59e0b" },
                { label: "You keep", value: Math.max(0, parseFloat(pnl.net_profit)), color: "#10b981" },
              ]}
            />
          </div>
          )}

          {/* The month's money story — the numbers as four plain sentences */}
          <div className="mise-well mt-4 rounded-xl p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">This month&apos;s money story</p>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("mise:ask", {
                      detail: { prompt: "Tell me this month's money story — how are sales, costs and profit going, and what should I watch?" },
                    }),
                  )
                }
                className="mise-press shrink-0 rounded-full border border-brand-400/30 bg-brand-400/10 px-2.5 py-1 text-[11px] font-medium text-brand-300"
              >
                ✨ Ask Mise to dig deeper
              </button>
            </div>
            <div className="mt-2 space-y-1.5 text-sm leading-relaxed text-fg-soft">
              <p>
                You took in <b className="text-fg">{format(pnl.net_sales)}</b> so far
                {parseFloat(pnl.commission) > 0 && (
                  <> (after the delivery apps kept <b className="text-fg">{format(pnl.commission)}</b>)</>
                )}
                .
              </p>
              <p>
                The kitchen ate <b className="text-fg">{format(pnl.cost_of_sales)}</b> of it ({pnl.food_cost_pct}% food cost
                {parseFloat(pnl.food_cost_pct) <= 35 ? " — inside the healthy 25–35% band" : " — above the 35% line, worth a look"}
                ), and running the place cost <b className="text-fg">{format(pnl.operating_expenses)}</b>.
              </p>
              {parseFloat(pnl.waste_total) > 0 && (
                <p>
                  <b className="text-rose-400">{format(pnl.waste_total)}</b> went in the bin as logged waste.
                </p>
              )}
              <p>
                That leaves{" "}
                <b className={parseFloat(pnl.net_profit) >= 0 ? "text-brand-400" : "text-rose-400"}>{format(pnl.net_profit)}</b>{" "}
                in your pocket — <b className="text-fg">{Math.round(parseFloat(pnl.net_margin_pct) || 0)}p of every £1</b>{" "}
                {parseFloat(pnl.net_profit) >= 0 ? "stays with you." : "— the month is currently loss-making."}
              </p>
            </div>
          </div>

          <div className="mise-well mt-3 space-y-2.5 rounded-2xl p-3 text-sm">
            {/* 1 — money in */}
            <div className="mise-raised mise-feel flex items-center justify-between rounded-xl border-l-4 border-brand-500/60 px-3 py-2.5">
              <span className="flex items-center text-fg">
                <span className="mr-2 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-300">1</span>
                Money in <span className="ml-1 text-xs text-fg-faint">· sales</span>
                <InfoDot id="sales" open={openInfo === "sales"} onToggle={setOpenInfo} text="Your takings from Sales & Cash — already after delivery apps (Deliveroo, Uber Eats…) take their commission." />
              </span>
              <span className="font-semibold text-fg">+{format(pnl.net_sales)}</span>
            </div>

            {/* 2 — cost of food */}
            <div className="mise-raised mise-feel flex items-center justify-between rounded-xl border-l-4 border-rose-400/50 px-3 py-2.5">
              <span className="flex items-center text-fg">
                <span className="mr-2 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-400/15 text-xs font-semibold text-rose-300">2</span>
                Cost of the food you sold
                <InfoDot id="food" open={openInfo === "food"} onToggle={setOpenInfo} text="What the ingredients cost — your 'Variable' expenses (meat, veg, packaging). They go up and down with how much you sell." />
              </span>
              <span className="font-medium text-rose-300">−{format(pnl.cost_of_sales)}</span>
            </div>
            {pnl.expense_breakdown.filter((c) => c.kind === "VARIABLE").length > 0 && (
              <div className="ml-9 space-y-1 border-l border-line pl-3">
                {pnl.expense_breakdown.filter((c) => c.kind === "VARIABLE").map((c) => (
                  <div key={c.category_id} className="flex items-center justify-between text-xs text-fg-faint">
                    <span>{c.category_name}</span>
                    <span>−{format(c.total)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* = gross */}
            <div className="mise-raised mise-feel flex items-center justify-between rounded-xl px-3 py-2.5">
              <span className="flex flex-wrap items-center font-semibold text-fg">
                = Gross profit
                <InfoDot id="gross" open={openInfo === "gross"} onToggle={setOpenInfo} text="What's left after the direct cost of the food — but BEFORE rent and bills. (Money in − food cost.)" />
                <span className="ml-2 rounded-full bg-brand-500/10 px-2 py-0.5 text-[11px] font-medium text-brand-300">{pnl.gross_margin_pct}% margin</span>
              </span>
              <span className="font-bold text-fg">{format(pnl.gross_profit)}</span>
            </div>

            {/* 3 — running costs */}
            <div className="mise-raised mise-feel flex items-center justify-between rounded-xl border-l-4 border-rose-400/50 px-3 py-2.5">
              <span className="flex items-center text-fg">
                <span className="mr-2 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-rose-400/15 text-xs font-semibold text-rose-300">3</span>
                Running costs
                <InfoDot id="run" open={openInfo === "run"} onToggle={setOpenInfo} text="Your 'Fixed' bills that stay about the same whatever you sell — rent, gas, internet, subscriptions." />
              </span>
              <span className="font-medium text-rose-300">−{format(pnl.operating_expenses)}</span>
            </div>
            {pnl.expense_breakdown.filter((c) => c.kind === "FIXED").length > 0 && (
              <div className="ml-9 space-y-1 border-l border-line pl-3">
                {pnl.expense_breakdown.filter((c) => c.kind === "FIXED").map((c) => (
                  <div key={c.category_id} className="flex items-center justify-between text-xs text-fg-faint">
                    <span>{c.category_name}</span>
                    <span>−{format(c.total)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* = net (hero) */}
            <div className="mise-raised mise-feel flex items-center justify-between rounded-xl bg-brand-500/10 px-4 py-3.5 ring-1 ring-brand-500/30">
              <span className="flex items-center">
                <span className="text-base font-bold text-fg">Net profit</span>
                <InfoDot id="net" open={openInfo === "net"} onToggle={setOpenInfo} text="What you actually keep after EVERYTHING — food and running costs. This is your real bottom line." />
                <span className="ml-2 text-xs text-fg-faint">what you keep</span>
              </span>
              <span className={`text-2xl font-bold ${parseFloat(pnl.net_profit) >= 0 ? "text-brand-400" : "text-rose-400"}`}>
                <AnimatedNumber value={parseFloat(pnl.net_profit) * rate} prefix={symbol} decimals={2} />
              </span>
            </div>
          </div>
          {parseFloat(pnl.waste_total || "0") > 0 && (
            <div className="mise-well mise-feel mt-3 flex items-center justify-between rounded-xl border border-amber-400/30 px-4 py-3 text-sm">
              <span className="flex items-center">
                <span aria-hidden className="mr-2">🗑️</span>
                <span className="font-medium text-fg">Stock wasted this period</span>
                <InfoDot
                  id="waste"
                  open={openInfo === "waste"}
                  onToggle={setOpenInfo}
                  text="Value of stock you binned (spoiled / over-prepped). It is NOT subtracted from profit again here — the money already left when you bought the stock, so counting it twice would understate your profit. Shown so you can see and cut the leak. Log it on the Waste page."
                />
              </span>
              <span className="font-semibold text-amber-300">{format(pnl.waste_total)}</span>
            </div>
          )}
          <p className="mt-3 text-xs text-fg-faint">
            Record takings on <Link href="/sales" className="text-brand-400 underline">Sales</Link> and spends on{" "}
            <Link href="/expenses" className="text-brand-400 underline">Expenses</Link>; this updates automatically.
            New here? See <Link href="/how-it-works" className="text-brand-400 underline">How it works</Link>.
          </p>
        </Card>
      )}

      {/* Break-even */}
      <Card className="mise-feel mt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-fg">Break-even</h3>
          <span className="text-xs text-fg-faint">based on this period&apos;s recorded fixed costs</span>
        </div>
        {beSales == null ? (
          <p className="mt-3 rounded-lg bg-glass/5 px-3 py-3 text-sm text-fg-soft">
            Add some <Link href="/sales" className="text-brand-400 underline">sales</Link> and{" "}
            <Link href="/expenses" className="text-brand-400 underline">fixed expenses</Link> (rent, salaries…)
            and we&apos;ll show the sales you need to cover your costs.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-faint">Fixed costs</p>
                <p className="mt-1 text-xl font-semibold text-fg">{format(be.fixed_costs)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-faint">Contribution margin</p>
                <p className="mt-1 text-xl font-semibold text-fg">{be.contribution_margin_pct}%</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-faint">Break-even sales</p>
                <p className="mt-1 text-xl font-semibold text-brand-400">{format(beSales)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-faint">≈ per day</p>
                <p className="mt-1 text-xl font-semibold text-fg">
                  {be.break_even_per_day ? format(be.break_even_per_day) : "—"}
                </p>
              </div>
            </div>
            {/* bullet chart: the actual bar racing a break-even target tick */}
            <div>
              {(() => {
                const sold = parseFloat(be.net_sales) || 0;
                const target = parseFloat(beSales || "0") || 0;
                const max = Math.max(sold, target) * 1.15 || 1;
                const soldPct = Math.min(100, (sold / max) * 100);
                const targetPct = Math.min(97, (target / max) * 100);
                return (
                  <div>
                    <div className="mise-well relative h-6 w-full overflow-hidden rounded-full">
                      <div className="absolute inset-y-0 left-0 bg-amber-400/10" style={{ width: `${targetPct}%` }} />
                      <div className="absolute inset-y-0 bg-brand-400/10" style={{ left: `${targetPct}%`, right: 0 }} />
                      <div
                        className={`absolute left-1 top-1/2 h-2.5 -translate-y-1/2 rounded-full transition-[width] duration-700 ${
                          sold >= target ? "bg-brand-500" : "bg-amber-500"
                        }`}
                        style={{ width: `calc(${soldPct}% - 4px)` }}
                      />
                      <div
                        className="absolute bottom-0 top-0 w-[3px] rounded bg-fg/70"
                        style={{ left: `calc(${targetPct}% - 1.5px)` }}
                        title={`break-even: ${format(beSales || "0")}`}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-fg-faint">
                      <span>0</span>
                      <span style={{ marginLeft: `${Math.max(0, targetPct - 55)}%` }}>▲ break-even {format(beSales || "0")}</span>
                    </div>
                  </div>
                );
              })()}
              <p className="mt-2 text-sm text-fg-soft">
                You&apos;ve sold <b className="text-fg">{format(be.net_sales)}</b>{" "}
                {gap != null && gap >= 0 ? (
                  <span className="text-brand-400">— {format(String(gap))} above break-even ✓</span>
                ) : (
                  <span className="text-amber-400">
                    — {format(String(Math.abs(gap ?? 0)))} short of break-even
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Food-cost variance — ideal (menu) vs actual (books) */}
      {(() => {
        const fcv = data.food_cost_variance;
        const gap = parseFloat(fcv.gap_points);
        const gapTone = gap <= 2 ? "text-brand-400" : gap <= 5 ? "text-amber-400" : "text-rose-400";
        const note =
          gap < 0
            ? "Actual is below your menu's ideal — you may be running down existing stock, or dish-sales counts are incomplete for the period."
            : gap <= 2
              ? "✅ Tight — actual food cost closely matches what your menu implies."
              : gap <= 5
                ? "⚠ A few points of leak — check portion sizes and waste."
                : "🔴 Big leak — well above ideal. Likely over-portioning, waste, theft, or under-priced dishes.";
        return (
          <Card className="mise-feel mt-6">
            <h3 className="font-semibold text-fg">Food-cost variance — ideal vs actual</h3>
            <p className="text-xs text-fg-faint">
              What your menu <i>should</i> cost (dishes sold × recipe) vs what your books <i>actually</i> show
              (food expenses ÷ sales).
            </p>
            {!fcv.has_data ? (
              <p className="mt-3 rounded-lg bg-glass/5 px-3 py-3 text-sm text-fg-soft">
                Record <b>dishes sold</b> (Menu engineering, below) to unlock this — the gap is the single
                clearest sign of money leaking to waste, over-portioning or theft.
              </p>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-fg-faint">Ideal (menu)</p>
                    <p className="mt-1 text-2xl font-semibold text-fg">{fcv.ideal_pct}%</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-fg-faint">Actual (books)</p>
                    <p className="mt-1 text-2xl font-semibold text-fg">{fcv.actual_pct}%</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-fg-faint">Gap</p>
                    <p className={`mt-1 text-2xl font-semibold ${gapTone}`}>
                      {gap >= 0 ? "+" : ""}{fcv.gap_points} pts
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm text-fg-soft">{note}</p>
              </>
            )}
          </Card>
        );
      })()}

      {/* Waste — a pure profit leak */}
      <Card className="mise-feel mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-fg">🗑️ Waste this period</h3>
          <p className="text-xs text-fg-faint">
            Stock logged as spoiled / spilled / over-prepped — straight off your profit.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className={`text-2xl font-semibold ${parseFloat(data.waste.total) > 0 ? "text-rose-400" : "text-fg"}`}>
              {format(data.waste.total)}
            </p>
            <p className="text-xs text-fg-faint">
              {data.waste.entry_count} entr{data.waste.entry_count === 1 ? "y" : "ies"}
            </p>
          </div>
          <Link
            href="/waste"
            className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-fg-soft"
          >
            Log waste →
          </Link>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Stock value by category */}
        <Card className="mise-feel">
          <h3 className="font-semibold text-fg">Stock value by category</h3>
          <p className="text-xs text-fg-faint">{format(data.stock_value.total)} total, at weighted-average cost</p>
          {data.stock_value.by_category.length === 0 ? (
            <p className="mt-3 text-sm text-fg-faint">No stock recorded yet.</p>
          ) : (
            <>
            <p className="mt-1 text-[11px] text-fg-faint">tap a slice → what&apos;s inside it appears below · tap again to open Inventory</p>
            <div className="mt-4">
              <Donut
                centerLabel="on hand"
                centerValue={format(data.stock_value.total)}
                formatValue={(v) => format(String(v))}
                onSelect={(s) => setSelCat(s?.label ?? null)}
                onSegmentClick={(s) => router.push(`/inventory?cat=${encodeURIComponent(s.label)}`)}
                segments={data.stock_value.by_category.map((c, i) => ({
                  label: c.category,
                  value: parseFloat(c.value),
                  color: ["#d97742", "#10b981", "#38bdf8", "#f59e0b", "#a78bfa", "#f43f5e", "#94a3b8"][i % 7],
                }))}
              />
            </div>
            {selCat && (catItems[selCat]?.length ?? 0) > 0 && (
              <div className="mise-well mise-pop mt-4 rounded-xl p-3">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                    Inside {selCat} — {catItems[selCat].length} item{catItems[selCat].length === 1 ? "" : "s"}
                  </p>
                  <Link href={`/inventory?cat=${encodeURIComponent(selCat)}`} className="text-[11px] font-medium text-brand-400 hover:underline">
                    Open in Inventory →
                  </Link>
                </div>
                <Bars
                  items={catItems[selCat].slice(0, 8).map((x) => ({ ...x, color: "#d97742" }))}
                  formatValue={(v) => format(String(v))}
                />
                {catItems[selCat].length > 8 && (
                  <p className="mt-2 text-[11px] text-fg-faint">
                    + {catItems[selCat].length - 8} more — see them all in Inventory
                  </p>
                )}
              </div>
            )}
            </>
          )}
        </Card>

        {/* Dish margins */}
        <Card className="mise-feel">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-fg">Dish margins</h3>
            <Link href="/recipes" className="text-xs text-brand-400 hover:underline">
              Recipes →
            </Link>
          </div>
          <p className="text-xs text-fg-faint">
            {dm.priced_count} of {dm.total_count} dishes priced
            {dm.avg_margin_pct != null && ` · avg ${dm.avg_margin_pct}%`} · best margin → thinnest
          </p>
          {dm.priced_count === 0 ? (
            <p className="mt-3 text-sm text-fg-faint">Set a selling price on your recipes to see margins.</p>
          ) : (
            <ul className="mt-3 max-h-[24rem] space-y-0.5 overflow-y-auto pr-2">
              {dm.ranked.map((d) => <DishRow key={d.recipe_id} d={d} />)}
            </ul>
          )}
          {dm.no_price.length > 0 && (
            <p className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
              {dm.no_price.length} dish{dm.no_price.length === 1 ? "" : "es"} have no selling price set
              ({dm.no_price.slice(0, 4).map((d) => d.name).join(", ")}
              {dm.no_price.length > 4 ? "…" : ""}) — margin can&apos;t be tracked until you price them.
            </p>
          )}
        </Card>
      </div>

      {/* Price-rise alerts */}
      <Card className="mise-feel mt-6">
        <h3 className="font-semibold text-fg">Vendor price-rise alerts</h3>
        <p className="text-xs text-fg-faint">
          Items whose price climbed vs the last time you ordered — based on what you actually paid.
        </p>
        {data.price_alerts.length === 0 ? (
          <p className="mt-3 text-sm text-fg-faint">No price rises detected. 👍</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {data.price_alerts.map((a) => (
              <li key={a.item_id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{a.item_name}</span>
                  <span className="block text-xs text-fg-faint">
                    {format(a.prev_price)} → {format(a.latest_price)}
                    {a.vendor_name ? ` · ${a.vendor_name}` : ""} · {a.last_ordered}
                  </span>
                </span>
                {alertSparks[a.item_id] && alertSparks[a.item_id].length > 1 && (
                  <span className="mise-well hidden shrink-0 rounded-lg px-2 py-1 sm:block" title="what you paid, order by order">
                    <Sparkline
                      data={alertSparks[a.item_id]}
                      formatValue={(v) => format(String(v))}
                      height={20}
                      className="h-[20px] w-20"
                    />
                  </span>
                )}
                <Badge tone="red">▲ {a.change_pct}%</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Budget vs actual — targets vs live month-to-date */}
      <BudgetCard />

      {/* Menu engineering (popularity × margin) + dishes-sold entry */}
      <MenuEngineeringCard />
    </div>
  );
}
