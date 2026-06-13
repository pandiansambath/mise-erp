"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type DishMarginRow, type MoneyCentre } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { useCurrency } from "@/lib/currency";

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
    <li className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
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
            {dm.avg_margin_pct != null && ` · avg ${dm.avg_margin_pct}%`}
          </p>
          {dm.priced_count === 0 ? (
            <p className="mt-3 text-sm text-fg-faint">Set a selling price on your recipes to see margins.</p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-400">★ Best margin</p>
                <ul>{dm.leaders.map((d) => <DishRow key={d.recipe_id} d={d} />)}</ul>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-rose-400">⚠ Thinnest margin</p>
                <ul>{dm.laggards.map((d) => <DishRow key={d.recipe_id} d={d} />)}</ul>
              </div>
            </div>
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
    </div>
  );
}
