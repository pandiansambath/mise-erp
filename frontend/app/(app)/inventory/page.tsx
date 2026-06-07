"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Item } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useCurrency } from "@/lib/currency";

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
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Items, stock levels, and weighted-average cost." />

      <Card className="mb-6">
        <p className="mb-3 text-sm font-medium text-slate-700">
          {editingId ? "Edit item" : "Add a new item"}
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex-1 sm:min-w-[12rem]">
            <label className="block text-sm font-medium text-slate-700">Item name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="e.g. Basmati Rice"
              className={inputCls}
            />
          </div>
          <div className="w-full sm:w-40">
            <label className="block text-sm font-medium text-slate-700">Category</label>
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="e.g. Rice"
              className={inputCls}
            />
          </div>
          <div className="w-full sm:w-24">
            <label className="block text-sm font-medium text-slate-700">Unit</label>
            <input
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              required
              className={inputCls}
            />
          </div>
          <div className="w-full sm:w-28">
            <label className="block text-sm font-medium text-slate-700">Min stock</label>
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
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            )}
          </div>
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
                  <th className="px-5 py-3 text-right font-medium">Min stock</th>
                  <th className="px-5 py-3 text-right font-medium">Avg cost</th>
                  <th className="px-5 py-3 font-medium"></th>
                  <th className="px-5 py-3 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-slate-400">
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
                      <td className="px-5 py-3 text-right text-slate-500">
                        {item.min_stock_level ? `${item.min_stock_level} ${item.unit}` : "—"}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {format(item.average_cost)}
                      </td>
                      <td className="px-5 py-3">{isLow(item) && <Badge tone="red">Low</Badge>}</td>
                      <td className="px-5 py-3 text-right">
                        <button
                          onClick={() => startEdit(item)}
                          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
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
