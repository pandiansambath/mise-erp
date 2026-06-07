"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Item } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";

function isLow(item: Item): boolean {
  if (item.min_stock_level == null) return false;
  return parseFloat(item.current_stock) <= parseFloat(item.min_stock_level);
}

export default function InventoryPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [min, setMin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    return api.get<Item[]>("/inventory/items").then(setItems);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post<Item>("/inventory/items", {
        name,
        unit,
        ...(min ? { min_stock_level: min } : {}),
      });
      setName("");
      setMin("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Items, stock levels, and weighted-average cost." />

      <Card className="mb-6">
        <form onSubmit={addItem} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700">Item name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Basmati Rice"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div className="w-full sm:w-28">
            <label className="block text-sm font-medium text-slate-700">Unit</label>
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <div className="w-full sm:w-32">
            <label className="block text-sm font-medium text-slate-700">Min stock</label>
            <input
              value={min}
              onChange={(e) => setMin(e.target.value)}
              inputMode="decimal"
              placeholder="optional"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? "Adding…" : "Add item"}
          </button>
        </form>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      </Card>

      {loading ? (
        <Spinner />
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Item</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 text-right font-medium">Stock</th>
                  <th className="px-5 py-3 text-right font-medium">Avg cost</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                      No items yet — add your first above.
                    </td>
                  </tr>
                ) : (
                  items.map((item) => (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="px-5 py-3 font-medium text-slate-800">{item.name}</td>
                      <td className="px-5 py-3 text-slate-500">{item.category || "—"}</td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {item.current_stock} {item.unit}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        £{parseFloat(item.average_cost).toFixed(2)}
                      </td>
                      <td className="px-5 py-3">{isLow(item) && <Badge tone="red">Low</Badge>}</td>
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
