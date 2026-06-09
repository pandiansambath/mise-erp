"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Item, type Recipe, type RecipeCostBreakdown } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { ComboBox } from "@/components/ComboBox";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

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

type IngLine = { item_id: string; qty: string };
type IngredientOut = { item_id: string; quantity: string; unit: string };

const DEFAULT_CATEGORIES = [
  "Main", "Starter", "Dessert", "Beverage", "Side", "Bread", "Rice", "Snack", "Soup", "Salad",
];

export default function RecipesPage() {
  const { user } = useAuth();
  const canWrite = can(user?.role, "recipes:write");

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  // New/edit-recipe form
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [servings, setServings] = useState("1");
  const [price, setPrice] = useState("");
  const [ings, setIngs] = useState<IngLine[]>([{ item_id: "", qty: "" }]);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    return api.get<Recipe[]>("/recipes").then(setRecipes);
  }

  useEffect(() => {
    Promise.all([
      reload(),
      api.get<Item[]>("/inventory/items").then((i) => {
        setItems(i);
        setIngs([{ item_id: i[0]?.id ?? "", qty: "" }]);
      }),
    ]).finally(() => setLoading(false));
  }, []);

  // Autofill: typing a dish name that already exists copies its ingredients in
  // (editable) — so the same dish at a new serve-size doesn't need re-entry.
  useEffect(() => {
    if (editId) return;
    const match = recipes.find(
      (r) => r.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (!match) {
      setCopiedFrom(null);
      return;
    }
    if (copiedFrom === match.id) return;
    setCopiedFrom(match.id);
    setCategory((c) => c || match.category || "");
    setPrice((p) => p || match.selling_price || "");
    api
      .get<IngredientOut[]>(`/recipes/${match.id}/ingredients`)
      .then((list) => {
        if (list.length) setIngs(list.map((i) => ({ item_id: i.item_id, qty: String(i.quantity) })));
      })
      .catch(() => {});
  }, [name, recipes, editId, copiedFrom]);

  function resetForm() {
    setEditId(null);
    setName("");
    setCategory("");
    setServings("1");
    setPrice("");
    setIngs([{ item_id: items[0]?.id ?? "", qty: "" }]);
    setCopiedFrom(null);
    setError(null);
    setShowForm(false);
  }

  async function startEdit(r: Recipe) {
    setEditId(r.id);
    setShowForm(true);
    setName(r.name);
    setCategory(r.category || "");
    setServings(String(r.servings_default));
    setPrice(r.selling_price || "");
    setError(null);
    const list = await api
      .get<IngredientOut[]>(`/recipes/${r.id}/ingredients`)
      .catch(() => [] as IngredientOut[]);
    setIngs(
      list.length
        ? list.map((i) => ({ item_id: i.item_id, qty: String(i.quantity) }))
        : [{ item_id: items[0]?.id ?? "", qty: "" }]
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function createRecipe(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Give the dish a name.");
      return;
    }
    // Validate ingredients up-front so nothing is silently dropped.
    const rows = ings.filter((ln) => ln.item_id && ln.qty.trim());
    const incomplete = ings.some((ln) => ln.item_id && !(parseFloat(ln.qty) > 0));
    if (incomplete) {
      setError("Enter a quantity greater than 0 for every ingredient.");
      return;
    }
    if (!editId && rows.length === 0) {
      setError("Add at least one ingredient (pick an item and a quantity).");
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: name.trim(),
      servings_default: parseInt(servings || "1", 10),
      category: category || null,
      selling_price: price || null,
    };
    try {
      const recipe = editId
        ? await api.patch<Recipe>(`/recipes/${editId}`, body)
        : await api.post<Recipe>("/recipes", body);
      for (const ln of rows) {
        const item = items.find((it) => it.id === ln.item_id);
        await api.post(`/recipes/${recipe.id}/ingredients`, {
          item_id: ln.item_id,
          quantity: ln.qty,
          unit: item?.unit ?? "unit",
        });
      }
      if (editId) {
        // remove ingredients the user deleted from the form
        const keep = new Set(rows.map((r) => r.item_id));
        const existing = await api
          .get<IngredientOut[]>(`/recipes/${editId}/ingredients`)
          .catch(() => [] as IngredientOut[]);
        for (const ex of existing) {
          if (!keep.has(ex.item_id)) {
            await api.delete(`/recipes/${editId}/ingredients/${ex.item_id}`).catch(() => {});
          }
        }
      }
      await reload();
      const newId = recipe.id;
      resetForm();
      setOpenId(newId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save recipe");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";
  const categoryOptions = [
    ...new Set([...DEFAULT_CATEGORIES, ...(recipes.map((r) => r.category).filter(Boolean) as string[])]),
  ];
  const recipeNames = [...new Set(recipes.map((r) => r.name))].sort();

  // group recipes by name so a dish with several serves-variants shows as one card
  const groups = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const g = groups.get(r.name) ?? [];
    g.push(r);
    groups.set(r.name, g);
  }

  return (
    <div>
      <PageHeader title="Recipes" subtitle="Cost per plate and profit margin for each dish." />

      {canWrite && (
        <div className="mb-6">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              + New recipe
            </button>
          ) : (
            <Card>
              <p className="mb-3 text-sm font-medium text-slate-700">
                {editId ? "Edit recipe" : "New recipe"}
              </p>
              <form onSubmit={createRecipe} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-slate-700">Dish name</label>
                    <div className="mt-1">
                      <ComboBox
                        value={name}
                        onChange={setName}
                        options={recipeNames}
                        placeholder="Search a dish or type a new one…"
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Same dish at different serves? Pick the existing name to keep spelling consistent.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Category</label>
                    <div className="mt-1">
                      <ComboBox
                        value={category}
                        onChange={setCategory}
                        options={categoryOptions}
                        placeholder="Select category…"
                        className="w-full"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Serves</label>
                    <input value={servings} onChange={(e) => setServings(e.target.value)} inputMode="numeric" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Selling price (optional)</label>
                    <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="per serving" className={inputCls} />
                  </div>
                </div>

                <p className="pt-1 text-sm font-medium text-slate-700">Ingredients</p>
                {ings.map((l, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select
                      value={l.item_id}
                      onChange={(e) => setIngs(ings.map((x, i) => (i === idx ? { ...x, item_id: e.target.value } : x)))}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>
                      ))}
                    </select>
                    <input
                      value={l.qty}
                      onChange={(e) => setIngs(ings.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                      inputMode="decimal"
                      placeholder="qty"
                      className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                    {ings.length > 1 && (
                      <button type="button" onClick={() => setIngs(ings.filter((_, i) => i !== idx))} className="rounded-lg border border-slate-200 px-2 text-slate-400 hover:bg-slate-50">×</button>
                    )}
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setIngs([...ings, { item_id: items[0]?.id ?? "", qty: "" }])} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                    + Add ingredient
                  </button>
                  <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                    {saving ? "Saving…" : editId ? "Save changes" : "Save recipe"}
                  </button>
                  <button type="button" onClick={resetForm} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                </div>
                {error && <p className="text-sm text-rose-600">{error}</p>}
                <p className="text-xs text-slate-400">
                  Cost/serving &amp; margin are calculated automatically from current vendor prices.
                </p>
              </form>
            </Card>
          )}
        </div>
      )}

      {recipes.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-slate-400">No recipes yet.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {[...groups.entries()].map(([dishName, variants]) => {
            const sorted = [...variants].sort(
              (a, b) => a.servings_default - b.servings_default
            );
            return (
              <Card key={dishName}>
                <div className="mb-1">
                  <p className="font-semibold text-slate-900">{dishName}</p>
                  <p className="text-sm text-slate-500">
                    {sorted[0].category || "Dish"}
                    {sorted.length > 1 && ` · ${sorted.length} serving sizes`}
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {sorted.map((r) => {
                    const pct = r.profit_margin ? parseFloat(r.profit_margin) : null;
                    const open = openId === r.id;
                    return (
                      <div key={r.id}>
                        <div className="flex items-center gap-2 py-2.5">
                          <button
                            onClick={() => setOpenId(open ? null : r.id)}
                            className="flex flex-1 items-center justify-between text-left"
                          >
                            <span className="text-sm font-medium text-slate-700">
                              serves {r.servings_default}
                            </span>
                            <span className="flex items-center gap-3">
                              {pct !== null && <Badge tone={marginTone(pct)}>{pct}% margin</Badge>}
                              <span className="text-slate-400">{open ? "▲" : "▼"}</span>
                            </span>
                          </button>
                          {canWrite && (
                            <button
                              onClick={() => startEdit(r)}
                              className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                        {open && (
                          <div className="border-t border-slate-100 pb-2 pt-3">
                            <CostDetail recipeId={r.id} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
