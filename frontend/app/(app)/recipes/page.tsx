"use client";

import { useEffect, useState } from "react";
import { api, type Recipe, type RecipeCostBreakdown } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useCurrency } from "@/lib/currency";

function marginTone(pct: number): "green" | "amber" | "red" {
  if (pct >= 65) return "green";
  if (pct >= 40) return "amber";
  return "red";
}

function CostDetail({ recipeId }: { recipeId: string }) {
  const [data, setData] = useState<RecipeCostBreakdown | null>(null);
  const { format } = useCurrency();
  useEffect(() => {
    api.get<RecipeCostBreakdown>(`/recipes/${recipeId}/cost`).then(setData);
  }, [recipeId]);

  if (!data) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase text-slate-500">Cost / serving</p>
          <p className="text-lg font-semibold text-slate-900">{format(data.cost_per_serving)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Sells at</p>
          <p className="text-lg font-semibold text-slate-900">
            {data.selling_price ? format(data.selling_price) : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Margin</p>
          <p className="text-lg font-semibold text-brand-600">
            {data.profit_margin_pct ? `${data.profit_margin_pct}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase text-slate-500">Batch ({data.servings})</p>
          <p className="text-lg font-semibold text-slate-900">{format(data.total_cost)}</p>
        </div>
      </div>

      {data.has_missing_prices && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Some ingredients have no price yet — margin may be understated.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-4 font-medium">Ingredient</th>
              <th className="py-2 pr-4 text-right font-medium">Qty</th>
              <th className="py-2 pr-4 text-right font-medium">Unit price</th>
              <th className="py-2 pr-4 text-right font-medium">Line cost</th>
              <th className="py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {data.ingredients.map((ing) => (
              <tr key={ing.item_id} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-800">{ing.item_name}</td>
                <td className="py-2 pr-4 text-right text-slate-600">
                  {ing.quantity} {ing.unit}
                </td>
                <td className="py-2 pr-4 text-right text-slate-600">{format(ing.unit_price)}</td>
                <td className="py-2 pr-4 text-right font-medium text-slate-800">
                  {format(ing.line_cost)}
                </td>
                <td className="py-2 text-slate-500">
                  {ing.price_source === "preferred"
                    ? `★ ${ing.vendor_name}`
                    : ing.price_source === "cheapest"
                      ? ing.vendor_name
                      : ing.price_source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Recipe[]>("/recipes")
      .then(setRecipes)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Recipes" subtitle="Cost per plate and profit margin for each dish." />

      {recipes.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-slate-400">No recipes yet.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {recipes.map((r) => {
            const pct = r.profit_margin ? parseFloat(r.profit_margin) : null;
            const open = openId === r.id;
            return (
              <Card key={r.id}>
                <button
                  onClick={() => setOpenId(open ? null : r.id)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{r.name}</p>
                    <p className="text-sm text-slate-500">
                      {r.category || "Dish"} · serves {r.servings_default}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {pct !== null && <Badge tone={marginTone(pct)}>{pct}% margin</Badge>}
                    <span className="text-slate-400">{open ? "▲" : "▼"}</span>
                  </div>
                </button>
                {open && (
                  <div className="mt-4 border-t border-slate-100 pt-4">
                    <CostDetail recipeId={r.id} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
