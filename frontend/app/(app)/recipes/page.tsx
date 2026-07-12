"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, postForm, type Item, type Recipe, type RecipeCostBreakdown } from "@/lib/api";
import { Badge, Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { Bars, Donut, Treemap } from "@/components/charts";
import { Select } from "@/components/Select";
import { ALLERGENS, parseAllergens } from "@/lib/allergens";
import { ComboBox } from "@/components/ComboBox";
import { fmtQty, ItemPicker, type PickedLine } from "@/components/ItemPicker";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { spotlight, useDeepLink } from "@/components/fx";

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

// Cache cost breakdowns so re-opening a dish is INSTANT (the first open still
// fetches). Cleared by reload() whenever recipes change, so it never goes stale.
const _costCache = new Map<string, RecipeCostBreakdown>();
export function clearCostCache() { _costCache.clear(); }

function CostDetail({
  recipeId,
  items,
  onTag,
}: {
  recipeId: string;
  items: Item[];
  onTag: (itemId: string, csv: string) => void;
}) {
  const [data, setData] = useState<RecipeCostBreakdown | null>(() => _costCache.get(recipeId) ?? null);
  const [whatIf, setWhatIf] = useState<number | null>(null); // what-if price slider
  const [costView, setCostView] = useState<"donut" | "map">("donut");
  const { format } = useCurrency();
  useEffect(() => {
    const cached = _costCache.get(recipeId);
    if (cached) { setData(cached); return; }
    let alive = true;
    api.get<RecipeCostBreakdown>(`/recipes/${recipeId}/cost`).then((d) => {
      _costCache.set(recipeId, d);
      if (alive) setData(d);
    });
    return () => { alive = false; };
  }, [recipeId]);

  // Tag an ingredient's allergens right here (saves instantly to the Inventory
  // item; the Allergens sheet inherits it). code=null marks "reviewed, none".
  const toggleAllergen = (item: Item | undefined, code: string | null) => {
    if (!item) return;
    if (code === null) return onTag(item.id, "");
    const set = new Set(parseAllergens(item.allergens));
    if (set.has(code)) set.delete(code);
    else set.add(code);
    onTag(item.id, [...set].join(","));
  };

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
          <div key={kpi.label} className="mise-well mise-feel rounded-xl p-3">
            <p className="text-xs uppercase tracking-wide text-fg-faint">{kpi.label}</p>
            <p className={`mt-1 text-lg font-semibold ${kpi.cls}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* What-if: drag the price, watch the margin move — pricing decisions in seconds */}
      {(() => {
        const cost = parseFloat(data.cost_per_serving) || 0;
        if (cost <= 0) return null;
        const current = parseFloat(data.selling_price || "0") || cost * 3;
        const price = whatIf ?? current;
        const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
        const tone = margin >= 65 ? "text-brand-400" : margin >= 40 ? "text-amber-400" : "text-rose-400";
        return (
          <div className="mise-well mise-feel rounded-xl p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                What-if pricing — drag it
              </p>
              <p className="text-sm">
                <span className="font-mono font-semibold text-fg">{format(String(price))}</span>
                <span className="mx-2 text-fg-faint">→</span>
                <span className={`font-mono font-bold ${tone}`}>{margin.toFixed(1)}% margin</span>
                <span className="ml-2 text-xs text-fg-faint">({format(String(price - cost))}/plate)</span>
              </p>
            </div>
            <input
              type="range"
              min={Math.max(0.5, cost).toFixed(2)}
              max={(Math.max(current, cost) * 2.5).toFixed(2)}
              step="0.05"
              value={price}
              onChange={(e) => setWhatIf(parseFloat(e.target.value))}
              className="mt-3 w-full accent-emerald-500"
              aria-label="What-if selling price"
            />
            <div className="mt-1 flex justify-between text-[10px] text-fg-faint">
              <span>cost {format(String(cost))}</span>
              {whatIf != null && (
                <button type="button" onClick={() => setWhatIf(null)} className="mise-press rounded px-1.5 text-brand-400 hover:underline">
                  reset to current price
                </button>
              )}
              <span>{format(String(Math.max(current, cost) * 2.5))}</span>
            </div>
          </div>
        );
      })()}

      {data.ingredients.length >= 2 && (
        <div className="mise-well rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
              Where the plate cost goes
            </p>
            <Segmented
              value={costView}
              onChange={setCostView}
              options={[
                { value: "donut", label: "◔" },
                { value: "map", label: "▦" },
              ]}
            />
          </div>
          {costView === "map" ? (
            <Treemap
              height={190}
              formatValue={(v) => format(String(v))}
              items={data.ingredients
                .map((ing) => ({ label: ing.item_name, value: parseFloat(ing.line_cost) || 0 }))
                .filter((x) => x.value > 0)}
            />
          ) : (
          <Donut
            centerLabel="per batch"
            centerValue={format(data.total_cost)}
            formatValue={(v) => format(String(v))}
            segments={(() => {
              const sorted = [...data.ingredients]
                .map((ing) => ({ label: ing.item_name, value: parseFloat(ing.line_cost) || 0 }))
                .filter((s) => s.value > 0)
                .sort((a, b) => b.value - a.value);
              const top = sorted.slice(0, 5);
              const rest = sorted.slice(5).reduce((s, x) => s + x.value, 0);
              const palette = ["#d97742", "#10b981", "#38bdf8", "#f59e0b", "#a78bfa"];
              const segs = top.map((s, i) => ({ ...s, color: palette[i] }));
              if (rest > 0) segs.push({ label: "Other", value: rest, color: "#94a3b8" });
              return segs;
            })()}
          />
          )}
        </div>
      )}

      {(() => {
        const cps = parseFloat(data.cost_per_serving) || 0;
        if (cps <= 0) return null;
        const at = (gp: number) => format(String(Math.round((cps / (1 - gp)) * 100) / 100));
        return (
          <p className="rounded-lg bg-glass/5 px-3 py-2 text-sm text-fg-soft">
            💡 Suggested price — for <b className="text-brand-400">70% GP</b> sell at{" "}
            <b className="text-fg">{at(0.7)}</b> · 65% → {at(0.65)} · 60% → {at(0.6)}
          </p>
        );
      })()}

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

      {/* Allergens — tag each ingredient straight from the dish (Natasha's Law).
          Saves instantly to the Inventory item; the Allergens sheet inherits it. */}
      <div className="rounded-xl border border-line bg-paper-2/40 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-faint">
          🥜 Allergens — tag each ingredient
        </p>
        <ul className="space-y-2.5">
          {data.ingredients.map((ing) => {
            const item = items.find((it) => it.id === ing.item_id);
            const reviewed = item?.allergens != null;
            const current = new Set(parseAllergens(item?.allergens));
            return (
              <li key={ing.item_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="w-36 shrink-0 truncate text-sm text-fg">{ing.item_name}</span>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => toggleAllergen(item, null)}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                      reviewed && current.size === 0
                        ? "bg-brand-600 text-white"
                        : "border border-line-2 text-fg-faint hover:bg-glass/5"
                    }`}
                  >
                    none
                  </button>
                  {ALLERGENS.map((a) => {
                    const on = current.has(a.code);
                    return (
                      <button
                        key={a.code}
                        type="button"
                        onClick={() => toggleAllergen(item, a.code)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition ${
                          on
                            ? "bg-rose-500 text-white"
                            : "border border-line-2 text-fg-soft hover:bg-glass/5"
                        }`}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                  {!reviewed && <span className="self-center text-[11px] text-amber-300">not reviewed</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

type IngLine = PickedLine;

type NotePreviewLine = {
  raw: string; name: string; qty: string | null; unit: string | null;
  item_id: string | null; item_name: string | null; matched_unit: string | null; confidence: number;
};
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

  // ⌘K "Create a recipe" lands here with ?new=1 → open + spotlight the form
  useDeepLink({ new: () => { setShowForm(true); spotlight("recipe-form"); } }, !loading);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [servings, setServings] = useState("1");
  const [price, setPrice] = useState("");
  const [ings, setIngs] = useState<IngLine[]>([]);
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handwritten-note OCR (Textract): upload → editable preview → add to ingredients.
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);
  const [notePreview, setNotePreview] = useState<NotePreviewLine[] | null>(null);

  async function scanNote(file: File) {
    setNoteBusy(true);
    setNoteMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await postForm<{ lines: NotePreviewLine[] }>("/recipes/scan-note", fd);
      if (!res.lines.length) {
        setNoteMsg("Couldn't read any lines — try a clearer, well-lit photo.");
        return;
      }
      setNotePreview(res.lines);
    } catch (err) {
      setNoteMsg(err instanceof ApiError ? err.message : "Could not read the note.");
    } finally {
      setNoteBusy(false);
    }
  }

  function confirmNote() {
    if (!notePreview) return;
    const additions = notePreview
      .filter((l) => l.item_id)
      .map((l) => ({ item_id: l.item_id as string, qty: l.qty ?? "" }));
    // merge, keeping the newest qty for any duplicate item
    const byId = new Map(ings.map((l) => [l.item_id, l]));
    for (const a of additions) byId.set(a.item_id, a);
    setIngs([...byId.values()]);
    setNotePreview(null);
    setNoteMsg(`Added ${additions.length} ingredient${additions.length === 1 ? "" : "s"} — review & save.`);
  }

  const [showArchived, setShowArchived] = useState(false);
  const [sort, setSort] = useState<"name" | "margin-desc" | "margin-asc">("name");
  const confirm = useConfirm();

  function reload(includeInactive = showArchived) {
    clearCostCache(); // recipes changed → drop cached cost breakdowns
    return api
      .get<Recipe[]>(`/recipes${includeInactive ? "?include_inactive=true" : ""}`)
      .then(setRecipes);
  }

  async function archiveRecipe(r: Recipe) {
    const ok = await confirm({
      title: `Archive “${r.name}”?`,
      message:
        "It will be hidden from recipes and costing. You can bring it back anytime via “Show archived”.",
      confirmText: "Archive",
    });
    if (!ok) return;
    await api.patch(`/recipes/${r.id}`, { is_active: false });
    await reload();
  }

  async function reactivateRecipe(r: Recipe) {
    await api.patch(`/recipes/${r.id}`, { is_active: true });
    await reload();
  }

  // Tag an ingredient's allergens from the recipe view (updates the Inventory
  // item; every dish using it inherits the change on the Allergens sheet).
  async function tagAllergens(itemId: string, csv: string) {
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, allergens: csv } : it)));
    await api.patch(`/inventory/items/${itemId}`, { allergens: csv }).catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      reload(),
      api.get<Item[]>("/inventory/items").then(setItems),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep link: /recipes?open=<id> (e.g. tapping a dish on the Money page) opens
  // that recipe's cost breakdown and scrolls to it. One-shot.
  const didDeepLink = useRef(false);
  useEffect(() => {
    if (didDeepLink.current || recipes.length === 0) return;
    const id = new URLSearchParams(window.location.search).get("open");
    if (!id || !recipes.some((r) => r.id === id)) return;
    didDeepLink.current = true;
    setOpenId(id);
    setTimeout(
      () => document.getElementById(`recipe-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
      120,
    );
  }, [recipes]);

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

  // group recipes by name so a dish with several serves-variants shows as one
  // card — and keep ACTIVE and ARCHIVED in separate maps so the page can show
  // archived dishes in their own clearly-labelled section (not mixed in).
  const activeGroups = new Map<string, Recipe[]>();
  const archivedGroups = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const map = r.is_active ? activeGroups : archivedGroups;
    const g = map.get(r.name) ?? [];
    g.push(r);
    map.set(r.name, g);
  }

  // A dish's margin = its best variant's margin; used for the margin sort.
  const dishMargin = (variants: Recipe[]) =>
    Math.max(...variants.map((v) => (v.profit_margin ? parseFloat(v.profit_margin) : -Infinity)));
  const sortEntries = (entries: [string, Recipe[]][]) => {
    const arr = [...entries];
    if (sort === "name") arr.sort((a, b) => a[0].localeCompare(b[0]));
    else
      arr.sort((a, b) =>
        sort === "margin-desc" ? dishMargin(b[1]) - dishMargin(a[1]) : dishMargin(a[1]) - dishMargin(b[1]),
      );
    return arr;
  };

  const dishCard = (dishName: string, variants: Recipe[]) => {
    const sorted = [...variants].sort((a, b) => a.servings_default - b.servings_default);
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
              <div key={r.id} id={`recipe-${r.id}`} className={r.is_active ? "" : "opacity-70"}>
                <div className="flex items-center gap-2 py-2.5">
                  <button
                    onClick={() => setOpenId(open ? null : r.id)}
                    className="flex flex-1 items-center justify-between text-left"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-fg-soft">
                      serves {r.servings_default}
                    </span>
                    <span className="flex items-center gap-3">
                      {pct !== null && <Badge tone={marginTone(pct)}>{pct}% margin</Badge>}
                      <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                        aria-hidden
                        className={`text-fg-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </span>
                  </button>
                  {canWrite &&
                    (r.is_active ? (
                      <>
                        <button
                          onClick={() => startEdit(r)}
                          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => archiveRecipe(r)}
                          title="Archive (hide from recipes & costing)"
                          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-faint hover:bg-rose-400/10 hover:text-rose-300"
                        >
                          Archive
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => reactivateRecipe(r)}
                        title="Restore this recipe to your active list + costing"
                        className="rounded-md border border-brand-400/30 bg-brand-400/10 px-2.5 py-1 text-xs font-medium text-brand-300 hover:bg-brand-400/20"
                      >
                        ↩ Restore
                      </button>
                    ))}
                </div>
                {open && (
                  <div className="border-t border-line pb-2 pt-3">
                    <CostDetail recipeId={r.id} items={items} onTag={tagAllergens} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  return (
    <div>
      <PageHeader title="Recipes" subtitle="Cost per plate and profit margin for each dish." />

      {canWrite && (
        <div className="mb-6">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              + New recipe
            </button>
          ) : (
            <Card id="recipe-form">
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

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p className="text-sm font-medium text-fg-soft">Ingredients</p>
                  <label className="cursor-pointer rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-300 transition hover:bg-brand-500/20">
                    {noteBusy ? "Reading…" : "📷 From handwritten note"}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      className="hidden"
                      disabled={noteBusy}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) scanNote(f); e.currentTarget.value = ""; }}
                    />
                  </label>
                </div>
                <p className="-mt-1 text-[11px] text-fg-faint">
                  Snap your chef&apos;s handwritten list — Mise reads it, matches each line to an
                  inventory item, and lets you review before adding. Nothing is added until you confirm.
                </p>
                {noteMsg && <p className="text-xs text-fg-soft">{noteMsg}</p>}
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

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-fg-faint">
          Sort by
          <Select
            value={sort}
            onChange={(v) => setSort(v as typeof sort)}
            className="w-52"
            options={[
              { value: "name", label: "Name (A–Z)" },
              { value: "margin-desc", label: "Margin — highest first" },
              { value: "margin-asc", label: "Margin — lowest first" },
            ]}
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-faint">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={() => {
              const next = !showArchived;
              setShowArchived(next);
              reload(next);
            }}
            className="h-4 w-4 accent-brand-500"
          />
          Show archived
        </label>
      </div>

      {/* Margin ladder — the whole menu's health, best to thinnest */}
      {(() => {
        const priced = recipes
          .filter((r) => r.is_active && r.profit_margin != null)
          .map((r) => ({ name: r.name, m: parseFloat(r.profit_margin!) }))
          .filter((x) => Number.isFinite(x.m))
          .sort((a, b) => b.m - a.m);
        if (priced.length < 2) return null;
        return (
          <Card className="mise-feel mb-6">
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold text-fg">Margin ladder</h3>
              <span className="text-xs text-fg-faint">every priced dish, best → thinnest</span>
            </div>
            <div className="mise-well mt-4 rounded-xl p-3">
              <Bars
                formatValue={(v) => `${v.toFixed(1)}%`}
                items={priced.slice(0, 10).map((x) => ({
                  label: x.name,
                  value: Math.max(0, x.m),
                  color: x.m >= 65 ? "#10b981" : x.m >= 40 ? "#f59e0b" : "#f43f5e",
                }))}
              />
              {priced.length > 10 && (
                <p className="mt-2 text-[11px] text-fg-faint">+ {priced.length - 10} more below — sort the list by margin to see them all</p>
              )}
            </div>
          </Card>
        );
      })()}

      {activeGroups.size === 0 && archivedGroups.size === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-fg-faint">No recipes yet.</p>
        </Card>
      ) : (
        <div className="gap-4 [column-fill:_balance] sm:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {sortEntries([...activeGroups.entries()]).map(([dishName, variants]) => dishCard(dishName, variants))}
          {activeGroups.size === 0 && (
            <Card>
              <p className="py-6 text-center text-sm text-fg-faint">
                No active recipes{showArchived ? " — your archived ones are below." : "."}
              </p>
            </Card>
          )}
        </div>
      )}

      {showArchived && archivedGroups.size > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold text-fg">📦 Archived</h3>
            <span className="text-xs text-fg-faint">
              {archivedGroups.size} dish{archivedGroups.size === 1 ? "" : "es"} · hidden from costing &amp; the menu — Restore to bring back
            </span>
          </div>
          <div className="gap-4 rounded-2xl border border-dashed border-line-2 bg-glass/[0.02] p-3 [column-fill:_balance] sm:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
            {sortEntries([...archivedGroups.entries()]).map(([dishName, variants]) => dishCard(dishName, variants))}
          </div>
        </div>
      )}

      {/* Handwritten-note OCR preview — review/fix each line, then add to ingredients. */}
      {notePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setNotePreview(null)} aria-hidden />
          <div className="mise-pop-lg relative max-h-[85dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-line bg-paper-2 p-5 shadow-2xl shadow-black/50">
            <div className="mb-1 flex items-start justify-between">
              <h3 className="text-lg font-semibold text-fg">Review the scanned note</h3>
              <button onClick={() => setNotePreview(null)} className="-mr-1 -mt-1 rounded-lg p-1 text-fg-faint hover:bg-paper hover:text-fg" aria-label="Close">✕</button>
            </div>
            <p className="mb-4 text-sm text-fg-faint">
              We matched each line to an inventory item. Fix any mismatches, set quantities, then add
              them. Lines with no item selected are skipped. Handwriting varies — always double-check.
            </p>
            <div className="space-y-2">
              {notePreview.map((l, i) => (
                <div key={i} className="rounded-lg border border-line px-3 py-2">
                  <p className="mb-1 truncate text-[11px] text-fg-faint" title={l.raw}>
                    &ldquo;{l.raw}&rdquo;{l.confidence < 0.5 && <span className="ml-1 text-amber-300">· low match</span>}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[10rem] flex-1">
                      <Select
                        value={l.item_id ?? ""}
                        onChange={(v) => setNotePreview((p) => p && p.map((x, k) => (k === i ? { ...x, item_id: v || null } : x)))}
                        placeholder="— skip this line —"
                        options={[
                          { value: "", label: "— skip this line —" },
                          ...items.map((it) => ({ value: it.id, label: it.name })),
                        ]}
                      />
                    </div>
                    <input
                      value={l.qty ?? ""}
                      onChange={(e) => setNotePreview((p) => p && p.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))}
                      inputMode="decimal"
                      placeholder="qty"
                      aria-label={`Quantity for ${l.name}`}
                      className="w-24 rounded-md border border-line-2 bg-transparent px-2 py-1.5 text-right text-sm"
                    />
                    <span className="text-xs text-fg-faint">
                      {l.item_id ? (items.find((it) => it.id === l.item_id)?.unit ?? l.unit) : l.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setNotePreview(null)} className="rounded-lg border border-line px-4 py-2 text-sm text-fg-soft hover:bg-paper">Cancel</button>
              <button onClick={confirmNote} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Add {notePreview.filter((l) => l.item_id).length} to ingredients
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
