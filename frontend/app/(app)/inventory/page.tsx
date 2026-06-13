"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, downloadFile, type Item } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { ComboBox } from "@/components/ComboBox";
import { categoryEmoji, fmtQty, QtyInput, stockState } from "@/components/ItemPicker";
import { useConfirm } from "@/components/confirm";
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

type StatusFilter = "all" | "ok" | "low" | "out";

function statusOf(item: Item): "ok" | "low" | "out" {
  const qty = parseFloat(item.current_stock || "0");
  const min = parseFloat(item.min_stock_level || "0");
  if (qty <= 0) return "out";
  if (min > 0 && qty <= min) return "low";
  return "ok";
}

const EMPTY = { name: "", category: "", unit: "kg", min: "" };

export default function InventoryPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const { format } = useCurrency();

  function load() {
    return api.get<Item[]>("/inventory/items").then(setItems);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    // Deep link: /inventory?filter=low (dashboard "Low stock" KPI)
    const want = new URLSearchParams(window.location.search).get("filter");
    if (want === "low" || want === "out" || want === "ok") setStatusFilter(want);
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

  async function removeItem(item: Item) {
    const ok = await confirm({
      title: `Remove ${item.name}?`,
      message:
        "It will be hidden from inventory, pickers and ordering. Recipes and past purchase orders that used it keep their history. You can't undo this from the app yet.",
      confirmText: "Remove item",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      await api.patch<Item>(`/inventory/items/${item.id}`, { is_active: false });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove item");
    }
  }

  function orderItem(item: Item) {
    router.push(`/purchasing?item=${item.id}`);
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25";

  const categoryOptions = [
    ...new Set([...STD_CATEGORIES, ...(items.map((i) => i.category).filter(Boolean) as string[])]),
  ];
  const unitOptions = [...new Set([...STD_UNITS, ...items.map((i) => i.unit)])];

  const counts = {
    all: items.length,
    ok: items.filter((i) => statusOf(i) === "ok").length,
    low: items.filter((i) => statusOf(i) === "low").length,
    out: items.filter((i) => statusOf(i) === "out").length,
  };
  const categories = [...new Set(items.map((i) => i.category?.trim() || "Other"))].sort((a, b) =>
    a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)
  );

  const query = q.trim().toLowerCase();
  const visible = items.filter((i) => {
    if (query && !i.name.toLowerCase().includes(query)) return false;
    if (statusFilter !== "all" && statusOf(i) !== statusFilter) return false;
    if (catFilter !== "all" && (i.category?.trim() || "Other") !== catFilter) return false;
    return true;
  });

  const statusChips: { key: StatusFilter; label: string }[] = [
    { key: "all", label: `🧺 All (${counts.all})` },
    { key: "ok", label: `🟢 In stock (${counts.ok})` },
    { key: "low", label: `🟡 Low (${counts.low})` },
    { key: "out", label: `🔴 Out (${counts.out})` },
  ];

  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25"
        : "border border-line-2 text-fg-soft hover:bg-glass/5"
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Inventory" subtitle="Items, stock levels, suppliers and weighted-average cost." />
        <div className="flex gap-2">
          <button
            onClick={() => downloadFile("/inventory/items.xlsx", "mise-stock-valuation.xlsx")}
            title="Download stock valuation (Excel)"
            className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
          >
            ⬇ Excel
          </button>
          <button
            onClick={() => downloadFile("/inventory/items.csv", "mise-stock-valuation.csv")}
            title="Download stock valuation (CSV)"
            className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
          >
            CSV
          </button>
        </div>
      </div>

      <Card className="mb-6">
        <p className="mb-3 text-sm font-medium text-fg-soft">
          {editingId ? "Edit item" : "Add a new item"}
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
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
            <div className="w-full sm:w-auto">
              <label className="block text-sm font-medium text-fg-soft">Min stock</label>
              <div className="mt-1">
                <QtyInput
                  unit={form.unit}
                  value={form.min}
                  onChange={(v) => setForm({ ...form, min: v })}
                  label="Minimum stock level"
                  plainClassName={inputCls}
                />
              </div>
            </div>
          </div>

          {!editingId && (
            <p className="rounded-xl border border-line bg-paper-2/60 px-3 py-2.5 text-xs text-fg-faint">
              Tip: set this item&apos;s supplier &amp; price on the{" "}
              <Link href="/vendors" className="font-medium text-brand-400 hover:underline">Vendors</Link>{" "}
              page after adding — the price lives with the vendor, so it stays consistent everywhere
              (no double-entry).
            </p>
          )}

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
        <>
          {/* Search + filters */}
          <div className="mb-3 space-y-2">
            <div className="relative max-w-md">
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint">🔍</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search items…"
                aria-label="Search items"
                className="w-full rounded-xl border border-line-2 bg-glass/5 py-2.5 pl-9 pr-3 text-sm text-fg outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {statusChips.map((s) => (
                <button key={s.key} type="button" onClick={() => setStatusFilter(s.key)} className={chip(statusFilter === s.key)}>
                  {s.label}
                </button>
              ))}
              <span aria-hidden className="my-auto h-5 w-px shrink-0 bg-glass/10" />
              <button type="button" onClick={() => setCatFilter("all")} className={chip(catFilter === "all")}>
                All categories
              </button>
              {categories.map((c) => (
                <button key={c} type="button" onClick={() => setCatFilter(c)} className={chip(catFilter === c)}>
                  {categoryEmoji(c)} {c}
                </button>
              ))}
            </div>
          </div>

          <Card className="p-0">
            <div className="max-h-[62vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-paper">
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-faint">
                    <th className="px-5 py-3 font-medium">Item</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Supplier</th>
                    <th className="px-5 py-3 text-right font-medium">Stock</th>
                    <th className="px-5 py-3 text-right font-medium">Avg cost</th>
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-fg-faint">
                        {items.length === 0 ? "No items yet — add your first above." : "Nothing matches the filters."}
                      </td>
                    </tr>
                  ) : (
                    visible.map((item) => {
                      const st = stockState(item);
                      return (
                        <tr key={item.id} className="border-b border-line transition hover:bg-glass/[0.03]">
                          <td className="px-5 py-3">
                            <p className="font-medium text-fg">
                              <span aria-hidden className="mr-1.5">{categoryEmoji(item.category?.trim() || "Other")}</span>
                              {item.name}
                            </p>
                            <p className="mt-0.5 text-xs text-fg-faint">{item.category || "Uncategorised"}</p>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center gap-1 rounded-full bg-glass/5 px-2 py-0.5 text-xs font-medium ${st.cls}`}>
                              {st.dot} {st.label}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {item.best_vendor ? (
                              item.best_vendor_chosen ? (
                                <span className="text-fg-soft" title="Chosen supplier — recipes & purchase orders use this one">
                                  <span className="text-brand-400">★</span> {item.best_vendor}
                                </span>
                              ) : (
                                <span
                                  className="text-fg-faint"
                                  title="No supplier chosen yet — this is just the cheapest. Pick the ★ chosen supplier on Price Comparison so recipes & POs use the one you trust."
                                >
                                  {item.best_vendor}{" "}
                                  <span className="text-amber-400">· cheapest, choose ★</span>
                                </span>
                              )
                            ) : (
                              <span title="No vendor sells this yet — add a price on the Vendors page to order it">
                                <Badge tone="amber">no supplier</Badge>
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <p className="text-fg-soft">{fmtQty(item.current_stock, item.unit)}</p>
                            <p className="text-xs text-fg-faint">{item.min_stock_level ? `min ${fmtQty(item.min_stock_level, item.unit)}` : "no min"}</p>
                          </td>
                          <td className="px-5 py-3 text-right text-fg-soft">{format(item.average_cost)}</td>
                          <td className="px-5 py-3">
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => orderItem(item)}
                                disabled={(item.vendor_count ?? 0) === 0}
                                title={(item.vendor_count ?? 0) === 0 ? "Add a vendor price first (Vendors page)" : "Order this item — opens Purchasing with it picked"}
                                className="rounded-md border border-brand-400/30 bg-brand-400/10 px-2.5 py-1 text-xs font-medium text-brand-300 hover:bg-brand-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                🛒 Order
                              </button>
                              <button
                                onClick={() => startEdit(item)}
                                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => removeItem(item)}
                                title="Remove from inventory"
                                className="rounded-md border border-line px-2 py-1 text-xs text-fg-faint hover:bg-rose-400/10 hover:text-rose-300"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
