"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Item } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { ComboBox } from "@/components/ComboBox";
import { useCurrency } from "@/lib/currency";

const STD_UNITS = ["kg", "g", "litre", "ml", "piece", "pack", "box", "bag", "dozen", "bottle"];

// Suggested item categories — these group the chef-friendly pickers on the
// Purchasing/Recipes/Price-Comparison pages, so consistent names matter.
// The ComboBox still lets you add a brand-new category any time.
const STD_CATEGORIES = [
  "Vegetables", "Fruits", "Meat", "Fish & Seafood", "Dairy", "Eggs", "Spices",
  "Grains & Rice", "Oil & Ghee", "Sauces & Tins", "Beverages", "Bakery",
  "Frozen", "Dry Goods", "Packaging", "Cleaning",
];

function isLow(item: Item): boolean {
  if (item.min_stock_level == null) return false;
  return parseFloat(item.current_stock) <= parseFloat(item.min_stock_level);
}

const EMPTY = { name: "", category: "", unit: "kg", min: "" };

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { format } = useCurrency();

  function load() {
    return api.get<Item[]>("/inventory/items").then(setItems);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  function startEdit(item: Item) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      category: item.category ?? "",
      unit: item.unit,
      min: item.min_stock_level ?? "",
    });
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name,
      unit: form.unit,
      category: form.category || null,
      min_stock_level: form.min || null,
    };
    try {
      if (editingId) {
        await api.patch<Item>(`/inventory/items/${editingId}`, payload);
      } else {
        await api.post<Item>("/inventory/items", payload);
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save item");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25";

  const categoryOptions = [
    ...new Set([...STD_CATEGORIES, ...(items.map((i) => i.category).filter(Boolean) as string[])]),
  ];
  const unitOptions = [...new Set([...STD_UNITS, ...items.map((i) => i.unit)])];

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Items, stock levels, and weighted-average cost." />

      <Card className="mb-6">
        <p className="mb-3 text-sm font-medium text-fg-soft">
          {editingId ? "Edit item" : "Add a new item"}
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex-1 sm:min-w-[12rem]">
            <label className="block text-sm font-medium text-fg-soft">Item name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="e.g. Basmati Rice"
              className={inputCls}
            />
          </div>
          <div className="w-full sm:w-44">
            <label className="block text-sm font-medium text-fg-soft">Category</label>
            <div className="mt-1">
              <ComboBox
                value={form.category}
                onChange={(v) => setForm({ ...form, category: v })}
                options={categoryOptions}
                placeholder="Select category…"
                className="w-full"
              />
            </div>
          </div>
          <div className="w-full sm:w-32">
            <label className="block text-sm font-medium text-fg-soft">Unit</label>
            <div className="mt-1">
              <ComboBox
                value={form.unit}
                onChange={(v) => setForm({ ...form, unit: v })}
                options={unitOptions}
                placeholder="Select unit…"
                className="w-full"
              />
            </div>
          </div>
          <div className="w-full sm:w-28">
            <label className="block text-sm font-medium text-fg-soft">Min stock</label>
            <input
              value={form.min}
              onChange={(e) => setForm({ ...form, min: e.target.value })}
              inputMode="decimal"
              placeholder="optional"
              className={inputCls}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add item"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-line-2 px-4 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <Card className="p-0">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-faint">
                  <th className="px-5 py-3 font-medium">Item</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Vendor</th>
                  <th className="px-5 py-3 text-right font-medium">Stock</th>
                  <th className="px-5 py-3 text-right font-medium">Min stock</th>
                  <th className="px-5 py-3 text-right font-medium">Avg cost</th>
                  <th className="px-5 py-3 font-medium"></th>
                  <th className="px-5 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-fg-faint">
                      No items yet — add your first above.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-b border-line">
                      <td className="px-5 py-3 font-medium text-fg">{item.name}</td>
                      <td className="px-5 py-3 text-fg-faint">{item.category || "—"}</td>
                      <td className="px-5 py-3">
                        {item.best_vendor ? (
                          <span className="text-fg-soft" title="Preferred or cheapest vendor — set a preferred one on Price Comparison">
                            {item.best_vendor}
                          </span>
                        ) : (
                          <span title="No vendor supplies this yet — add a price on the Vendors page to order it">
                            <Badge tone="amber">no vendor</Badge>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-fg-soft">
                        {item.current_stock} {item.unit}
                      </td>
                      <td className="px-5 py-3 text-right text-fg-faint">
                        {item.min_stock_level ? `${item.min_stock_level} ${item.unit}` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-fg-soft">
                        {format(item.average_cost)}
                      </td>
                      <td className="px-5 py-3">{isLow(item) && <Badge tone="red">Low</Badge>}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => startEdit(item)}
                          className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
