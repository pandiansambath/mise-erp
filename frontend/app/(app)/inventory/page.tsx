"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  ApiError,
  downloadFile,
  type Item,
  type ItemSuppliers,
  type PurchaseByVendorRow,
  type Vendor,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { ComboBox } from "@/components/ComboBox";
import { categoryEmoji, fmtQty, QtyInput, stockState } from "@/components/ItemPicker";
import { ALLERGENS, parseAllergens } from "@/lib/allergens";
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

const EMPTY = { name: "", category: "", unit: "kg", min: "", allergens: "" };

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
  const [catMgr, setCatMgr] = useState(false);
  const [catFrom, setCatFrom] = useState("");
  const [catTo, setCatTo] = useState("");
  // Add-item supplier preview: pick a vendor → see its price for this item (read-only)
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [addVendor, setAddVendor] = useState("");
  // item_id -> { vendor_id -> price } (so the add form can show the chosen vendor's price)
  const [suppliers, setSuppliers] = useState<Record<string, Record<string, string>>>({});
  const [allergensTouched, setAllergensTouched] = useState(false);
  // Per-item "purchases by supplier" record (expand a row to load + show it).
  const [expanded, setExpanded] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, PurchaseByVendorRow[]>>({});
  const [bdLoading, setBdLoading] = useState<string | null>(null);
  const { format } = useCurrency();

  function load() {
    return api.get<Item[]>("/inventory/items").then(setItems);
  }

  async function renameCategory() {
    if (!catFrom || !catTo.trim()) return;
    try {
      await api.post("/inventory/categories/rename", { from_name: catFrom, to_name: catTo.trim() });
      if (catFilter === catFrom) setCatFilter("all");
      setCatMgr(false);
      setCatFrom("");
      setCatTo("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename category");
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    api.get<Vendor[]>("/vendors").then(setVendors).catch(() => {});
    api
      .get<ItemSuppliers[]>("/purchasing/item-suppliers")
      .then((rows) =>
        setSuppliers(
          Object.fromEntries(
            rows.map((r) => [
              r.item_id,
              Object.fromEntries(r.vendors.map((v) => [v.vendor_id, v.price_per_unit])),
            ]),
          ),
        ),
      )
      .catch(() => {});
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
      allergens: item.allergens ?? "",
    });
    setAllergensTouched(false);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY);
    setAddVendor("");
    setAllergensTouched(false);
    setError(null);
  }

  function toggleAllergen(code: string) {
    const set = new Set(parseAllergens(form.allergens));
    if (set.has(code)) set.delete(code);
    else set.add(code);
    setForm({ ...form, allergens: [...set].join(",") });
    setAllergensTouched(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: form.name,
      unit: form.unit,
      category: form.category || null,
      min_stock_level: form.min || null,
    };
    // Only write allergens when the user actually touched them (preserves the
    // "not reviewed" state for items edited for other reasons).
    if (editingId && allergensTouched) payload.allergens = form.allergens;
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

  async function toggleBreakdown(item: Item) {
    if (expanded === item.id) {
      setExpanded(null);
      return;
    }
    setExpanded(item.id);
    if (!breakdown[item.id]) {
      setBdLoading(item.id);
      try {
        const rows = await api.get<PurchaseByVendorRow[]>(
          `/inventory/items/${item.id}/purchases-by-vendor`,
        );
        setBreakdown((b) => ({ ...b, [item.id]: rows }));
      } catch {
        setBreakdown((b) => ({ ...b, [item.id]: [] }));
      } finally {
        setBdLoading(null);
      }
    }
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

  // Add-item supplier preview: the chosen vendor's price for this item (if it
  // already prices a same-named item) — read-only, no double-entry.
  const activeVendors = vendors.filter((v) => v.is_active);
  const matchedItem = items.find(
    (i) => i.name.trim().toLowerCase() === form.name.trim().toLowerCase()
  );
  const addVendorPrice =
    matchedItem && addVendor ? suppliers[matchedItem.id]?.[addVendor] : undefined;

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
            <div className="rounded-xl border border-line bg-paper-2/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Supplier (optional)
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <select
                  value={addVendor}
                  onChange={(e) => setAddVendor(e.target.value)}
                  className={`${inputCls} sm:w-56`}
                >
                  <option value="">Choose a supplier…</option>
                  {activeVendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
                {addVendor &&
                  (addVendorPrice ? (
                    <span className="text-sm text-brand-300">
                      Price: <b>{format(addVendorPrice)}</b>{" "}
                      <span className="text-fg-faint">— this supplier&apos;s price (read-only)</span>
                    </span>
                  ) : (
                    <span className="text-sm text-amber-300">
                      🆕 No supplier price yet — set it on the{" "}
                      <Link href="/vendors" className="font-medium text-brand-400 hover:underline">Vendors</Link>{" "}
                      page (the price lives with the vendor — no double-entry).
                    </span>
                  ))}
              </div>
            </div>
          )}

          {editingId && (
            <div className="rounded-xl border border-line bg-paper-2/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Allergens (Natasha&apos;s Law)
              </p>
              <p className="mb-2 text-xs text-fg-faint">
                Tag what this ingredient contains — every dish that uses it inherits these
                automatically on the Allergens sheet.
              </p>
              <div className="flex flex-wrap gap-2">
                {ALLERGENS.map((a) => {
                  const on = parseAllergens(form.allergens).includes(a.code);
                  return (
                    <button
                      key={a.code}
                      type="button"
                      onClick={() => toggleAllergen(a.code)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        on
                          ? "bg-rose-500 text-white shadow-lg shadow-rose-600/20"
                          : "border border-line-2 text-fg-soft hover:bg-glass/5"
                      }`}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-fg-faint">
                None selected + saved = &ldquo;contains none&rdquo; (marks it reviewed).
              </p>
            </div>
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
            {/* Rename / merge a category across all its items */}
            <div className="mt-2">
              {!catMgr ? (
                <button type="button" onClick={() => setCatMgr(true)} className="text-xs text-fg-faint hover:text-fg-soft">
                  ✎ Rename / merge a category
                </button>
              ) : (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-paper-2/60 p-3">
                  <div>
                    <label className="block text-xs font-medium text-fg-faint">Rename</label>
                    <select value={catFrom} onChange={(e) => setCatFrom(e.target.value)} className={inputCls}>
                      <option value="">Pick category…</option>
                      {categories.filter((c) => c !== "Other").map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-fg-faint">to</label>
                    <div className="mt-1">
                      <ComboBox value={catTo} onChange={setCatTo} options={categoryOptions} placeholder="New or existing…" className="w-48" />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={renameCategory}
                    disabled={!catFrom || !catTo.trim()}
                    className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    Apply
                  </button>
                  <button type="button" onClick={() => setCatMgr(false)} className="rounded-lg border border-line-2 px-3 py-2 text-sm text-fg-soft hover:bg-paper-2">
                    Cancel
                  </button>
                  <span className="text-xs text-fg-faint">Renaming into an existing category merges them.</span>
                </div>
              )}
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
                      // Only offer a per-supplier breakdown when the item was
                      // actually bought from MORE THAN ONE vendor (else there's
                      // nothing to compare — keep the row simple).
                      const multiVendor = (item.purchase_vendor_count ?? 0) > 1;
                      const isOpen = expanded === item.id;
                      const rows = breakdown[item.id];
                      return (
                        <Fragment key={item.id}>
                        <tr
                          className={`border-b border-line transition hover:bg-glass/[0.04] ${
                            multiVendor ? "cursor-pointer" : ""
                          } ${isOpen ? "bg-glass/[0.04]" : ""}`}
                          onClick={multiVendor ? () => toggleBreakdown(item) : undefined}
                          aria-expanded={multiVendor ? isOpen : undefined}
                        >
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
                            {multiVendor && (
                              <span className="ml-2 inline-flex items-center rounded-full border border-brand-400/30 bg-brand-400/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">
                                {item.purchase_vendor_count} suppliers
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className="flex items-center justify-end gap-1 text-fg-soft">
                              {multiVendor && (
                                <span
                                  aria-hidden
                                  className={`text-[10px] text-brand-300 transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`}
                                >
                                  ▶
                                </span>
                              )}
                              {fmtQty(item.current_stock, item.unit)}
                            </span>
                            <p className="text-xs text-fg-faint">{item.min_stock_level ? `min ${fmtQty(item.min_stock_level, item.unit)}` : "no min"}</p>
                          </td>
                          <td className="px-5 py-3 text-right text-fg-soft">{format(item.average_cost)}</td>
                          <td className="px-5 py-3">
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); orderItem(item); }}
                                disabled={(item.vendor_count ?? 0) === 0}
                                title={(item.vendor_count ?? 0) === 0 ? "Add a vendor price first (Vendors page)" : "Order this item — opens Purchasing with it picked"}
                                className="rounded-md border border-brand-400/30 bg-brand-400/10 px-2.5 py-1 text-xs font-medium text-brand-300 hover:bg-brand-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                🛒 Order
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); startEdit(item); }}
                                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2"
                              >
                                Edit
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); removeItem(item); }}
                                title="Remove from inventory"
                                className="rounded-md border border-line px-2 py-1 text-xs text-fg-faint hover:bg-rose-400/10 hover:text-rose-300"
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-line bg-paper-2/30">
                            <td colSpan={6} className="px-5 pb-4 pt-1">
                              <div className="mise-reveal rounded-2xl border border-line bg-glass/[0.03] p-4">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                                    🏷 Purchases by supplier
                                  </p>
                                  {rows && rows.length > 0 && (
                                    <span className="text-xs text-fg-faint">
                                      {rows.length} recent purchase{rows.length === 1 ? "" : "s"}
                                    </span>
                                  )}
                                </div>
                                {bdLoading === item.id ? (
                                  <p className="mt-3 text-xs text-fg-faint">Loading…</p>
                                ) : rows && rows.length > 0 ? (
                                  <>
                                    <div className="mise-reveal-stagger mt-3 grid gap-2 sm:grid-cols-2">
                                      {rows.map((r, idx) => (
                                        <div
                                          key={idx}
                                          className="flex items-center justify-between rounded-xl border border-line bg-paper-2/70 px-3.5 py-2.5"
                                        >
                                          <div className="flex min-w-0 items-center gap-3">
                                            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-base text-brand-300">🏷</span>
                                            <div className="min-w-0">
                                              <p className="truncate font-medium text-fg">{r.vendor ?? "No supplier recorded"}</p>
                                              <p className="text-xs text-fg-faint">
                                                {new Date(r.received_at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="shrink-0 pl-2 text-right">
                                            <p className="font-semibold text-fg">{fmtQty(r.quantity, item.unit)}</p>
                                            {r.unit_cost != null && (
                                              <p className="font-mono text-xs text-brand-300">{format(r.unit_cost)}/{item.unit}</p>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line pt-3 text-xs text-fg-faint">
                                      <span>On hand <b className="font-semibold text-fg-soft">{fmtQty(item.current_stock, item.unit)}</b></span>
                                      <span>Avg cost <b className="font-semibold text-fg-soft">{format(item.average_cost)}/{item.unit}</b></span>
                                      <span>Bought (recent) <b className="font-semibold text-fg-soft">{fmtQty(rows.reduce((s, r) => s + parseFloat(r.quantity || "0"), 0), item.unit)}</b></span>
                                      <span>Last received <b className="font-semibold text-fg-soft">{new Date(rows[0].received_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b></span>
                                    </div>
                                    <p className="mt-2.5 text-[11px] leading-relaxed text-fg-faint">
                                      Stock from different suppliers mixes into one pool — so Mise values your {fmtQty(item.current_stock, item.unit)} on hand at the weighted-average {format(item.average_cost)}/{item.unit} rather than guessing whose stock is left.
                                    </p>
                                  </>
                                ) : (
                                  <p className="mt-3 text-xs text-fg-faint">No purchase history yet.</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
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
