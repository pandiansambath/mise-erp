"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type DashboardKpis, type PnL } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner, StatCard } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

interface LowStock {
  item_id: string;
  name: string;
  current_stock: string;
  min_stock_level: string;
}

/** One week-over-week metric with a ▲▼ delta coloured by whether the move is good. */
function WowStat({
  label,
  cur,
  prev,
  fmt,
  pct = false,
  higherBetter = true,
}: {
  label: string;
  cur: string;
  prev: string;
  fmt: (v: string) => string;
  pct?: boolean;
  higherBetter?: boolean;
}) {
  const c = parseFloat(cur) || 0;
  const p = parseFloat(prev) || 0;
  const diff = c - p;
  const pctChange = p !== 0 ? (diff / Math.abs(p)) * 100 : c !== 0 ? 100 : 0;
  const good = higherBetter ? diff >= 0 : diff <= 0;
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "→";
  const show = (v: string) => (pct ? `${v}%` : fmt(v));
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-fg-faint">{label}</p>
      <p className="mt-1 text-xl font-semibold text-fg">{show(cur)}</p>
      <p className={`text-xs ${diff === 0 ? "text-fg-faint" : good ? "text-brand-400" : "text-rose-400"}`}>
        {arrow} {Math.abs(pctChange).toFixed(0)}% vs {show(prev)} last week
      </p>
    </div>
  );
}

const ACTIONS = [
  { href: "/reports", perm: "reports:read", icon: "📈", title: "View P&L", desc: "Profit, margins, downloadable report." },
  { href: "/sales", perm: "sales:read", icon: "🧾", title: "Enter sales", desc: "Record today's takings by channel." },
  { href: "/price-comparison", perm: "vendors:read", icon: "⚖", title: "Compare prices", desc: "Find the cheapest supplier." },
  { href: "/recipes", perm: "recipes:read", icon: "🍲", title: "Dish margins", desc: "Cost per plate and profit." },
  { href: "/expenses", perm: "expenses:read", icon: "💸", title: "Log expenses", desc: "Track fixed & variable costs." },
];

export default function DashboardPage() {
  const { user, hotel } = useAuth();
  const { format } = useCurrency();
  const role = user?.role;
  const seeFinance = can(role, "reports:read");
  const seeInventory = can(role, "inventory:read");

  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [low, setLow] = useState<LowStock[]>([]);
  const [wow, setWow] = useState<{ cur: PnL; prev: PnL } | null>(null);
  const [setupDone, setSetupDone] = useState(true); // assume done → no flash; corrected in effect
  useEffect(() => {
    try { setSetupDone(localStorage.getItem("mise.setup.done") === "1"); } catch { /* ignore */ }
  }, []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const jobs: Promise<unknown>[] = [];
    if (seeFinance) {
      jobs.push(api.get<DashboardKpis>("/reports/dashboard").then(setKpis).catch(() => {}));
      const iso = (d: Date) => d.toISOString().slice(0, 10);
      const ago = (n: number) => {
        const x = new Date();
        x.setDate(x.getDate() - n);
        return iso(x);
      };
      jobs.push(
        Promise.all([
          api.get<PnL>(`/reports/pnl?date_from=${ago(6)}&date_to=${iso(new Date())}`),
          api.get<PnL>(`/reports/pnl?date_from=${ago(13)}&date_to=${ago(7)}`),
        ])
          .then(([cur, prev]) => setWow({ cur, prev }))
          .catch(() => {}),
      );
    }
    if (seeInventory)
      jobs.push(api.get<LowStock[]>("/inventory/alerts/low-stock").then(setLow).catch(() => {}));
    Promise.all(jobs).finally(() => setLoading(false));
  }, [seeFinance, seeInventory]);

  if (loading) return <Spinner />;

  const actions = ACTIONS.filter((a) => can(role, a.perm));

  return (
    <div>
      <PageHeader
        title={hotel ? hotel.name : "Dashboard"}
        subtitle="Your restaurant at a glance"
      />

      {!setupDone && kpis && kpis.recipe_count === 0 && Number(kpis.month_net_sales) === 0 && Number(kpis.month_expenses) === 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-500/30 bg-brand-500/10 px-4 py-3">
          <p className="text-sm text-fg">
            👋 Let&apos;s finish setting up — import your items, suppliers, menu &amp; team so your dashboard fills with real numbers.
          </p>
          <div className="flex items-center gap-2">
            <Link href="/onboarding" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500">
              Finish setup →
            </Link>
            <button
              onClick={() => { try { localStorage.setItem("mise.setup.done", "1"); } catch { /* ignore */ } setSetupDone(true); }}
              className="rounded-lg px-2 py-2 text-sm text-fg-faint hover:text-fg"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {seeFinance && kpis && (
        <div className="mise-slide-stagger grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Today's net sales" value={format(kpis.today_net_sales)} href="/sales" />
          <StatCard label="Month net sales" value={format(kpis.month_net_sales)} href="/reports" />
          <StatCard
            label="Month profit"
            value={format(kpis.month_net_profit)}
            accent={parseFloat(kpis.month_net_profit) >= 0 ? "brand" : "rose"}
            hint={`${kpis.month_net_margin_pct}% margin`}
            href="/reports"
          />
          <StatCard
            label="Low stock"
            value={String(kpis.low_stock_count)}
            accent={kpis.low_stock_count ? "rose" : "brand"}
            hint={kpis.low_stock_count ? "Tap to see & reorder" : "All good"}
            href="/inventory?filter=low"
          />
        </div>
      )}

      {seeFinance && wow && (
        <Card className="mt-6">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-fg">This week vs last week</h3>
            <span className="text-xs text-fg-faint">rolling 7 days</span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <WowStat label="Net sales" cur={wow.cur.net_sales} prev={wow.prev.net_sales} fmt={format} />
            <WowStat label="Net profit" cur={wow.cur.net_profit} prev={wow.prev.net_profit} fmt={format} />
            <WowStat
              label="Food cost"
              cur={wow.cur.food_cost_pct}
              prev={wow.prev.food_cost_pct}
              fmt={format}
              pct
              higherBetter={false}
            />
          </div>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {seeInventory && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-fg">Low stock alerts</h3>
              <Link href="/inventory" className="text-sm font-medium text-brand-400 hover:underline">
                View all
              </Link>
            </div>
            {low.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-faint">
                Nothing low — stock levels are healthy.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {low.slice(0, 6).map((l) => (
                  <li key={l.item_id}>
                    <Link
                      href={`/purchasing?item=${l.item_id}`}
                      title="Order this item — opens Purchasing with it picked"
                      className="group flex items-center justify-between gap-2 py-2.5 text-sm transition hover:bg-glass/[0.03]"
                    >
                      <span className="font-medium text-fg-soft group-hover:text-fg">{l.name}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone="red">
                          {l.current_stock} left (min {l.min_stock_level})
                        </Badge>
                        <span className="text-xs font-medium text-brand-300 opacity-0 transition group-hover:opacity-100">
                          🛒 order →
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <h3 className="mb-4 font-semibold text-fg">Quick actions</h3>
          <div className="mise-stagger grid gap-3">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="rounded-lg border border-line p-4 transition hover:border-brand-400/40 hover:bg-brand-400/10"
              >
                <p className="font-medium text-fg">
                  {a.icon} {a.title}
                </p>
                <p className="mt-1 text-sm text-fg-faint">{a.desc}</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
