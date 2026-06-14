"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  ApiError,
  type DishMarginRow,
  type DishSalesOut,
  type MenuEngineering,
  type MoneyCentre,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const CLASS_META: Record<string, { emoji: string; label: string; tone: "green" | "amber" | "slate" | "red" }> = {
  star: { emoji: "⭐", label: "Star", tone: "green" },
  plowhorse: { emoji: "🐎", label: "Plowhorse", tone: "amber" },
  puzzle: { emoji: "🧩", label: "Puzzle", tone: "slate" },
  dog: { emoji: "🐕", label: "Dog", tone: "red" },
  none: { emoji: "·", label: "—", tone: "slate" },
};

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
    <Card className="mt-6">
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
          <button
            type="button"
            onClick={() => setEntry((v) => !v)}
            className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
          >
            {entry ? "Close" : "✎ Record dishes sold (today)"}
          </button>
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
                  className="w-16 rounded-lg border border-line-2 bg-glass/5 px-2 py-1 text-center text-sm outline-none focus:border-brand-500"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save"}
          </button>
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

export default function MoneyPage() {
  const { format } = useCurrency();
  const [data, setData] = useState<MoneyCentre | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MoneyCentre>("/reports/money")
      .then(setData)
      .catch(() => setErr("Could not load money insights — refresh to retry."));
  }, []);

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

      {/* Break-even */}
      <Card className="mt-6">
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
            {/* progress: net sales vs break-even */}
            <div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-glass/10">
                <div
                  className={`h-full rounded-full ${gap != null && gap >= 0 ? "bg-brand-500" : "bg-amber-500"}`}
                  style={{
                    width: `${Math.min(100, (parseFloat(be.net_sales) / parseFloat(beSales || "1")) * 100 || 0)}%`,
                  }}
                />
              </div>
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
          <Card className="mt-6">
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
                <div className="mt-3 grid grid-cols-3 gap-4">
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
      <Card className="mt-6 flex flex-wrap items-center justify-between gap-3">
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
            className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
          >
            Log waste →
          </Link>
        </div>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Stock value by category */}
        <Card>
          <h3 className="font-semibold text-fg">Stock value by category</h3>
          <p className="text-xs text-fg-faint">{format(data.stock_value.total)} total, at weighted-average cost</p>
          {data.stock_value.by_category.length === 0 ? (
            <p className="mt-3 text-sm text-fg-faint">No stock recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.stock_value.by_category.map((c) => {
                const pct =
                  parseFloat(data.stock_value.total) > 0
                    ? (parseFloat(c.value) / parseFloat(data.stock_value.total)) * 100
                    : 0;
                return (
                  <li key={c.category}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-fg-soft">{c.category}</span>
                      <span className="font-medium text-fg">{format(c.value)}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-glass/10">
                      <div className="h-full rounded-full bg-copper-400" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Dish margins */}
        <Card>
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
      <Card className="mt-6">
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
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{a.item_name}</span>
                  <span className="block text-xs text-fg-faint">
                    {format(a.prev_price)} → {format(a.latest_price)}
                    {a.vendor_name ? ` · ${a.vendor_name}` : ""} · {a.last_ordered}
                  </span>
                </span>
                <Badge tone="red">▲ {a.change_pct}%</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Menu engineering (popularity × margin) + dishes-sold entry */}
      <MenuEngineeringCard />
    </div>
  );
}
