"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Item, type Recipe, type RecipeCostBreakdown } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { ComboBox } from "@/components/ComboBox";
import { fmtQty, ItemPicker, type PickedLine } from "@/components/ItemPicker";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

function marginTone(pct: number): "green" | "amber" | "red" {
  if (pct >= 65) return "green";
  if (pct >= 40) return "amber";
  return "red";
}

/** Where the price came from — as a readable chip. A ★ means the admin actually
    chose this supplier; "cheapest" is only a provisional and nudges them to pick
    one so costing uses the vendor they trust (not a random low price). */
function SourceChip({ source, vendor }: { source: string; vendor: string | null }) {
  if (source === "preferred")
    return <Badge tone="green">★ {vendor ?? "chosen"}</Badge>;
  if (source === "cheapest")
    return <Badge tone="amber">⚠ {vendor ?? "?"} · choose ★</Badge>;
  if (source === "average_cost")
    return <Badge tone="slate">avg cost</Badge>;
  return <Badge tone="red">no price</Badge>;
}

function CostDetail({ recipeId }: { recipeId: string }) {
  const [data, setData] = useState<RecipeCostBreakdown | null>(null);
  const { format } = useCurrency();
  useEffect(() => {
    api.get<RecipeCostBreakdown>(`/recipes/${recipeId}/cost`).then(setData);
  }, [recipeId]);

  if (!data) return <Spinner />;

  const marginCls =
    data.profit_margin_pct == null
      ? "text-fg"
      : { green: "text-brand-400", amber: "text-amber-400", red: "text-rose-400" }[
          marginTone(parseFloat(data.profit_margin_pct))
        ];

  return (
    <div className="space-y-4">
      <div className="mise-stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Cost / serving", value: format(data.cost_per_serving), cls: "text-copper-300" },
          { label: "Sells at", value: data.selling_price ? format(data.selling_price) : "—", cls: "text-fg" },
          { label: "Margin", value: data.profit_margin_pct ? `${data.profit_margin_pct}%` : "—", cls: marginCls },
          { label: `Batch (${data.servings} serves)`, value: format(data.total_cost), cls: "text-fg" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-line bg-paper-2/60 p-3">
            <p className="text-xs uppercase tracking-wide text-fg-faint">{kpi.label}</p>
            <p className={`mt-1 text-lg font-semibold ${kpi.cls}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {data.has_missing_prices && (
        <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
          Some ingredients have no price yet — margin may be understated.
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-paper-2/60">
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-faint">
              <th className="px-3 py-2 font-medium">Ingredient</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              <th className="px-3 py-2 text-right font-medium">Line cost</th>
              <th className="px-3 py-2 font-medium">Priced from</th>
            </tr>
          </thead>
          <tbody>
            {data.ingredients.map((ing) => (
              <tr key={ing.item_id} className="border-b border-line transition hover:bg-glass/[0.03]">
                <td className="px-3 py-2 text-fg">{ing.item_name}</td>
                <td className="px-3 py-2 text-right text-fg-soft" title={`${ing.quantity} ${ing.unit}`}>
                  {fmtQty(ing.quantity, ing.unit)}
                </td>
                <td className="px-3 py-2 text-right text-fg-soft">{format(ing.unit_price)}</td>
                <td className="px-3 py-2 text-right font-medium text-copper-300">
                  {format(ing.line_cost)}
                </td>
                <td className="px-3 py-2">
                  <SourceChip source={ing.price_source} vendor={ing.vendor_name} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type IngLine = PickedLine;
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
  const [ings, setIngs] = useState<IngLine[]>([]);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    return api.get<Recipe[]>("/recipes").then(setRecipes);
  }

  useEffect(() => {
    Promise.all([
      reload(),
      api.get<Item[]>("/inventory/items").then(setItems),
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
    setIngs([]);
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
    setIngs(list.map((i) => ({ item_id: i.item_id, qty: String(i.quantity) })));
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
    "mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm outline-none focus:border-brand-500";
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
              <p className="mb-3 text-sm font-medium text-fg-soft">
                {editId ? "Edit recipe" : "New recipe"}
              </p>
              <form onSubmit={createRecipe} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium text-fg-soft">Dish name</label>
                    <div className="mt-1">
                      <ComboBox
                        value={name}
                        onChange={setName}
                        options={recipeNames}
                        placeholder="Search a dish or type a new one…"
                      />
                    </div>
                    <p className="mt-1 text-xs text-fg-faint">
                      Same dish at different serves? Pick the existing name to keep spelling consistent.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-fg-soft">Category</label>
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
                    <label className="block text-sm font-medium text-fg-soft">Serves</label>
                    <input value={servings} onChange={(e) => setServings(e.target.value)} inputMode="numeric" className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-fg-soft">Selling price (optional)</label>
                    <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="per serving" className={inputCls} />
                  </div>
                </div>

                <p className="pt-1 text-sm font-medium text-fg-soft">Ingredients</p>
                <ItemPicker
                  items={items}
                  lines={ings}
                  onChange={setIngs}
                  emptyHint="No inventory items yet — add ingredients in Inventory first."
                />

                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                    {saving ? "Saving…" : editId ? "Save changes" : "Save recipe"}
                  </button>
                  <button type="button" onClick={resetForm} className="rounded-lg border border-line-2 px-4 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2">
                    Cancel
                  </button>
                </div>
                {error && <p className="text-sm text-rose-400">{error}</p>}
                <p className="text-xs text-fg-faint">
                  Cost/serving &amp; margin are calculated automatically from current vendor prices.
                </p>
              </form>
            </Card>
          )}
        </div>
      )}

      {recipes.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-fg-faint">No recipes yet.</p>
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
                  <p className="font-semibold text-fg">{dishName}</p>
                  <p className="text-sm text-fg-faint">
                    {sorted[0].category || "Dish"}
                    {sorted.length > 1 && ` · ${sorted.length} serving sizes`}
                  </p>
                </div>
                <div className="divide-y divide-line">
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
                            <span className="text-sm font-medium text-fg-soft">
                              serves {r.servings_default}
                            </span>
                            <span className="flex items-center gap-3">
                              {pct !== null && <Badge tone={marginTone(pct)}>{pct}% margin</Badge>}
                              <span className="text-fg-faint">{open ? "▲" : "▼"}</span>
                            </span>
                          </button>
                          {canWrite && (
                            <button
                              onClick={() => startEdit(r)}
                              className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                        {open && (
                          <div className="border-t border-line pb-2 pt-3">
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
