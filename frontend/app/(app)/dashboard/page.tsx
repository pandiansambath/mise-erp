"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Item, type Recipe } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner, StatCard } from "@/components/ui";

interface LowStock {
  item_id: string;
  name: string;
  current_stock: string;
  min_stock_level: string;
  shortfall: string;
}

export default function DashboardPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [low, setLow] = useState<LowStock[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<Item[]>("/inventory/items"),
      api.get<LowStock[]>("/inventory/alerts/low-stock"),
      api.get<Recipe[]>("/recipes"),
    ])
      .then(([i, l, r]) => {
        setItems(i);
        setLow(l);
        setRecipes(r);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  const margins = recipes
    .map((r) => (r.profit_margin ? parseFloat(r.profit_margin) : null))
    .filter((m): m is number => m !== null);
  const avgMargin = margins.length
    ? (margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(1)
    : "—";

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Your restaurant at a glance" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Tracked items" value={String(items.length)} />
        <StatCard
          label="Low stock"
          value={String(low.length)}
          accent={low.length ? "rose" : "brand"}
          hint={low.length ? "Need reordering" : "All good"}
        />
        <StatCard label="Recipes" value={String(recipes.length)} />
        <StatCard
          label="Avg margin"
          value={avgMargin === "—" ? "—" : `${avgMargin}%`}
          accent="brand"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
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

        <Card>
          <h3 className="mb-4 font-semibold text-slate-900">Quick actions</h3>
          <div className="grid gap-3">
            <Link
              href="/price-comparison"
              className="rounded-lg border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50"
            >
              <p className="font-medium text-slate-900">⚖ Compare vendor prices</p>
              <p className="mt-1 text-sm text-slate-500">Find the cheapest supplier for any item.</p>
            </Link>
            <Link
              href="/recipes"
              className="rounded-lg border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50"
            >
              <p className="font-medium text-slate-900">🍲 Check dish margins</p>
              <p className="mt-1 text-sm text-slate-500">See cost per plate and profit margin.</p>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
