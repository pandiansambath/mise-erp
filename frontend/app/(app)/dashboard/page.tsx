"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type DashboardKpis } from "@/lib/api";
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const jobs: Promise<unknown>[] = [];
    if (seeFinance)
      jobs.push(api.get<DashboardKpis>("/reports/dashboard").then(setKpis).catch(() => {}));
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

      {seeFinance && kpis && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Today's net sales" value={format(kpis.today_net_sales)} />
          <StatCard label="Month net sales" value={format(kpis.month_net_sales)} />
          <StatCard
            label="Month profit"
            value={format(kpis.month_net_profit)}
            accent={parseFloat(kpis.month_net_profit) >= 0 ? "brand" : "rose"}
            hint={`${kpis.month_net_margin_pct}% margin`}
          />
          <StatCard
            label="Low stock"
            value={String(kpis.low_stock_count)}
            accent={kpis.low_stock_count ? "rose" : "brand"}
            hint={kpis.low_stock_count ? "Need reordering" : "All good"}
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {seeInventory && (
          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Low stock alerts</h3>
              <Link href="/inventory" className="text-sm font-medium text-brand-600 hover:underline">
                View all
              </Link>
            </div>
            {low.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                Nothing low — stock levels are healthy.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {low.slice(0, 6).map((l) => (
                  <li key={l.item_id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="font-medium text-slate-700">{l.name}</span>
                    <Badge tone="red">
                      {l.current_stock} left (min {l.min_stock_level})
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Quick actions</h3>
          <div className="grid gap-3">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="rounded-lg border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50"
              >
                <p className="font-medium text-slate-900">
                  {a.icon} {a.title}
                </p>
                <p className="mt-1 text-sm text-slate-500">{a.desc}</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
