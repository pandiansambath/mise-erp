"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, type Recipe } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { Select } from "@/components/Select";
import { useCurrency } from "@/lib/currency";

type Line = { recipe_id: string; qty: number };

export default function PartyOrderPage() {
  const { format } = useCurrency();
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("1");
  const [customer, setCustomer] = useState("");
  const [when, setWhen] = useState("");

  useEffect(() => {
    api
      .get<Recipe[]>("/recipes")
      .then((r) => {
        const active = r.filter((x) => x.is_active);
        setRecipes(active);
        if (active.length) setPick(active[0].id);
      })
      .catch(() => setRecipes([]));
  }, []);

  const byId = useMemo(
    () => Object.fromEntries((recipes ?? []).map((r) => [r.id, r] as const)),
    [recipes]
  );

  function addLine() {
    const q = parseInt(qty, 10);
    if (!pick || !q || q <= 0) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.recipe_id === pick);
      if (existing) return prev.map((l) => (l.recipe_id === pick ? { ...l, qty: l.qty + q } : l));
      return [...prev, { recipe_id: pick, qty: q }];
    });
    setQty("1");
  }

  const rows = lines.map((l) => {
    const r = byId[l.recipe_id];
    const cost = r ? Number(r.calculated_cost) * l.qty : 0;
    const hasPrice = !!(r && r.selling_price);
    const price = hasPrice ? Number(r!.selling_price) * l.qty : 0;
    return { l, r, cost, price, profit: price - cost, hasPrice };
  });
  const totalCost = rows.reduce((s, x) => s + x.cost, 0);
  const totalPrice = rows.reduce((s, x) => s + x.price, 0);
  const totalProfit = totalPrice - totalCost;
  const margin = totalPrice > 0 ? (totalProfit / totalPrice) * 100 : 0;
  const anyUnpriced = rows.some((x) => !x.hasPrice);

  if (!recipes) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Party Order"
        subtitle="Build a bulk/party order from your recipes and see the full cost, price and profit instantly."
      />

      {recipes.length === 0 ? (
        <Card className="mt-4">
          <p className="text-sm text-fg-soft">
            You don&apos;t have any recipes yet. Add some on the{" "}
            <Link href="/recipes" className="text-brand-400 underline">Recipes</Link> page and they&apos;ll
            appear here, costed to the gram.
          </p>
        </Card>
      ) : (
        <>
          {/* Builder */}
          <Card className="mt-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
              <div className="sm:col-span-7">
                <label className="block text-sm font-medium text-fg-soft">Dish</label>
                <Select
                  value={pick}
                  onChange={setPick}
                  className="mt-1"
                  options={recipes.map((r) => ({
                    value: r.id,
                    label: r.selling_price ? `${r.name} — ${format(r.selling_price)}/plate` : `${r.name} (no price set)`,
                  }))}
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-sm font-medium text-fg-soft">Quantity (plates)</label>
                <input
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  onClick={addLine}
                  className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                >
                  Add
                </button>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-fg-soft">Customer / party (optional)</label>
                <input
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  placeholder="e.g. Sharma wedding"
                  className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg-soft">Date (optional)</label>
                <input
                  type="date"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm"
                />
              </div>
            </div>
          </Card>

          {/* Lines */}
          <Card className="mt-4 p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                    <th className="px-5 py-3">Dish</th>
                    <th className="px-5 py-3 text-right">Qty</th>
                    <th className="px-5 py-3 text-right">Price</th>
                    <th className="px-5 py-3 text-right">Cost</th>
                    <th className="px-5 py-3 text-right">Profit</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-fg-faint">
                        Add dishes above to build the order.
                      </td>
                    </tr>
                  ) : (
                    rows.map((x) => (
                      <tr key={x.l.recipe_id} className="border-b border-line">
                        <td className="px-5 py-3 font-medium text-fg">
                          {x.r?.name ?? "—"}
                          {!x.hasPrice && <Badge tone="amber">no price</Badge>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <input
                            value={x.l.qty}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((l) =>
                                  l.recipe_id === x.l.recipe_id
                                    ? { ...l, qty: Math.max(1, parseInt(e.target.value, 10) || 1) }
                                    : l
                                )
                              )
                            }
                            inputMode="numeric"
                            className="w-16 rounded-md border border-line-2 bg-transparent px-2 py-1 text-right text-sm"
                          />
                        </td>
                        <td className="px-5 py-3 text-right text-fg-soft">{x.hasPrice ? format(x.price) : "—"}</td>
                        <td className="px-5 py-3 text-right text-fg-soft">{format(x.cost)}</td>
                        <td className={`px-5 py-3 text-right ${x.profit >= 0 ? "text-fg" : "text-rose-400"}`}>
                          {x.hasPrice ? format(x.profit) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => setLines((prev) => prev.filter((l) => l.recipe_id !== x.l.recipe_id))}
                            className="rounded-md border border-line px-2 py-1 text-xs text-fg-faint hover:bg-paper-2"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Totals / quote */}
          {rows.length > 0 && (
            <Card className="mt-4">
              {(customer || when) && (
                <p className="mb-3 text-sm text-fg-soft">
                  Quote{customer ? ` for ${customer}` : ""}{when ? ` · ${when}` : ""}
                </p>
              )}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Total price</p>
                  <p className="mt-1 text-xl font-bold text-fg">{format(totalPrice)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Total cost</p>
                  <p className="mt-1 text-xl font-semibold text-fg-soft">{format(totalCost)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Profit</p>
                  <p className={`mt-1 text-xl font-bold ${totalProfit >= 0 ? "text-brand-400" : "text-rose-400"}`}>
                    {format(totalProfit)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-fg-faint">Margin</p>
                  <p className="mt-1 text-xl font-semibold text-fg">{totalPrice > 0 ? `${margin.toFixed(1)}%` : "—"}</p>
                </div>
              </div>
              {anyUnpriced && (
                <p className="mt-3 text-xs text-amber-300">
                  Some dishes have no selling price set, so the total price/profit excludes them. Set prices on{" "}
                  <Link href="/recipes" className="underline">Recipes</Link> for a complete quote.
                </p>
              )}
              <div className="mt-4">
                <button
                  onClick={() => window.print()}
                  className="rounded-lg border border-line-2 px-4 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
                >
                  🖨 Print quote
                </button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
