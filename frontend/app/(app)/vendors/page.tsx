"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type Item,
  type Vendor,
  type VendorItem,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { ItemPickerSingle } from "@/components/ItemPicker";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const CATEGORIES = ["FOOD", "BEVERAGE", "BAR", "UTILITY", "SERVICE", "PROPERTY"];
const TYPE_EMOJI: Record<string, string> = {
  FOOD: "🥕", BEVERAGE: "🧃", BAR: "🍷", UTILITY: "🔌", SERVICE: "🧰", PROPERTY: "🏠",
};
const inputCls =
  "mt-1 w-full rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25";

export default function VendorsPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "vendors:write");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [vendorItems, setVendorItems] = useState<VendorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // add-vendor form
  const [vName, setVName] = useState("");
  const [vCat, setVCat] = useState("FOOD");
  const [vContact, setVContact] = useState("");
  const [vMobile, setVMobile] = useState("");

  // add-price form
  const [piItem, setPiItem] = useState("");
  const [piPrice, setPiPrice] = useState("");

  function load() {
    return Promise.all([
      api.get<Vendor[]>("/vendors").then(setVendors),
      api.get<Item[]>("/inventory/items").then(setItems),
    ]);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  function selectVendor(id: string) {
    setSelected(id);
    setError(null);
    api.get<VendorItem[]>(`/vendors/${id}/items`).then(setVendorItems).catch(() => setVendorItems([]));
    // bring the detail panel into view (it renders below the grid)
    setTimeout(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  async function addVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!vName.trim()) {
      setError("Vendor name is required.");
      return;
    }
    setError(null);
    try {
      const v = await api.post<Vendor>("/vendors", {
        name: vName.trim(),
        category: vCat,
        contact_person: vContact.trim() || undefined,
        mobile: vMobile.trim() || undefined,
      });
      setVName("");
      setVContact("");
      setVMobile("");
      await load();
      selectVendor(v.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add vendor");
    }
  }

  async function addPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!piItem || !piPrice) {
      setError("Pick an item and enter a price.");
      return;
    }
    setError(null);
    try {
      await api.post<VendorItem>(`/vendors/${selected}/items`, {
        item_id: piItem,
        price_per_unit: piPrice,
      });
      setPiPrice("");
      selectVendor(selected);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save price");
    }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await postForm<{ created_items: number; priced_items: number; skipped: string[] }>(
        `/vendors/${selected}/items/import`,
        form,
      );
      await load();
      selectVendor(selected);
      setNotice(
        `Imported ${res.priced_items} price${res.priced_items === 1 ? "" : "s"}` +
          (res.created_items ? `, ${res.created_items} new item${res.created_items === 1 ? "" : "s"} created` : "") +
          (res.skipped.length ? `, ${res.skipped.length} row${res.skipped.length === 1 ? "" : "s"} skipped` : "") +
          ".",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed");
    } finally {
      e.target.value = "";
    }
  }

  async function toggleActive(v: Vendor) {
    if (v.is_active) {
      const ok = await confirm({
        title: `Deactivate ${v.name}?`,
        message: "They'll be hidden from new orders and price comparison. You can reactivate later.",
        confirmText: "Deactivate",
        tone: "danger",
      });
      if (!ok) return;
    }
    try {
      await api.patch<Vendor>(`/vendors/${v.id}`, { is_active: !v.is_active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update vendor");
    }
  }

  if (loading) return <Spinner />;

  const itemName = (id: string) => {
    const it = items.find((i) => i.id === id);
    return it ? `${it.name} (${it.unit})` : "—";
  };
  const selectedVendor = vendors.find((v) => v.id === selected);
  const pricedCount = (vid: string) => (vid === selected ? vendorItems.length : null);

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle="Your suppliers and what each one sells. Set an item's price here so it can be costed and ordered."
      />

      <div className="mb-6 rounded-xl border border-line bg-paper-2 p-4 text-sm text-fg-soft">
        <b>How it works:</b> add a vendor → open them → add the items they supply <i>with a price</i>. Those prices feed{" "}
        <b>Price Comparison</b> and let <b>Purchasing</b> turn an indent into a PO. An item with no
        vendor price can&apos;t be ordered yet.
      </div>

      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onImportFile} />
      {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-brand-400/10 px-3 py-2 text-sm text-brand-300">{notice}</p>}

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-medium text-fg-soft">Add a vendor</p>
          <form onSubmit={addVendor} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-fg-soft">Name</label>
              <input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="e.g. Farm2Land" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Contact (optional)</label>
              <input value={vContact} onChange={(e) => setVContact(e.target.value)} placeholder="person" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Mobile (optional)</label>
              <input value={vMobile} onChange={(e) => setVMobile(e.target.value)} placeholder="phone" className={inputCls} />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-sm font-medium text-fg-soft">Type</label>
              <div className="mt-1 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Vendor type">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={vCat === c}
                    onClick={() => setVCat(c)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      vCat === c
                        ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25"
                        : "border border-line-2 text-fg-soft hover:bg-glass/5"
                    }`}
                  >
                    {TYPE_EMOJI[c]} {c.toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-3">
              <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Add vendor
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* Vendor cards */}
      <p className="mb-2 text-sm font-medium text-fg-soft">All vendors ({vendors.length})</p>
      {vendors.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-fg-faint">No vendors yet. Add one above.</p>
        </Card>
      ) : (
        <div className="mise-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map((v) => {
            const sel = selected === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => selectVendor(v.id)}
                className={`rounded-2xl border p-4 text-left transition duration-200 ${
                  sel
                    ? "border-brand-500 bg-brand-400/10 shadow-lg shadow-brand-600/20"
                    : "border-line bg-paper/90 hover:border-line-2 hover:bg-paper-2/90"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-fg">
                      <span aria-hidden className="mr-1.5">{TYPE_EMOJI[v.category ?? ""] ?? "🤝"}</span>
                      {v.name}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-faint">
                      {(v.category || "—").toLowerCase()} supplier
                      {v.contact_person ? ` · ${v.contact_person}` : ""}
                      {v.mobile ? ` · ${v.mobile}` : ""}
                    </p>
                  </div>
                  <Badge tone={v.is_active ? "green" : "slate"}>{v.is_active ? "active" : "inactive"}</Badge>
                </div>
                <p className="mt-3 text-xs font-medium text-brand-300">
                  {sel && pricedCount(v.id) !== null ? `${pricedCount(v.id)} item${pricedCount(v.id) === 1 ? "" : "s"} priced · ` : ""}
                  Manage →
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected vendor detail — full width, plenty of room for the picker */}
      {selectedVendor && (
        <Card className="mt-6 p-0" >
          <div ref={detailRef} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h3 className="font-display text-lg font-semibold text-fg">
                {TYPE_EMOJI[selectedVendor.category ?? ""] ?? "🤝"} {selectedVendor.name}
              </h3>
              <p className="text-xs text-fg-faint">{(selectedVendor.category || "—").toLowerCase()} supplier</p>
            </div>
            {canWrite && (
              <button
                onClick={() => toggleActive(selectedVendor)}
                className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2"
              >
                {selectedVendor.is_active ? "Deactivate" : "Reactivate"}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-6 px-5 py-4 lg:grid-cols-2">
            {/* What they supply */}
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg-soft">What they supply ({vendorItems.length})</p>
              <div className="mt-2 max-h-[28rem] overflow-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-paper">
                    <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                      <th className="px-4 py-2 font-medium">Item</th>
                      <th className="px-4 py-2 text-right font-medium">Price / unit</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorItems.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-fg-faint">No prices yet — add one on the right.</td></tr>
                    ) : vendorItems.map((vi) => (
                      <tr key={vi.id} className="border-b border-line transition hover:bg-glass/[0.03]">
                        <td className="px-4 py-2 font-medium text-fg">{itemName(vi.item_id)}</td>
                        <td className="px-4 py-2 text-right text-fg-soft">{format(vi.price_per_unit)}</td>
                        <td className="px-4 py-2 text-right">{vi.is_preferred && <Badge tone="amber">★ chosen</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add / update a price + bulk import */}
            {canWrite && (
              <div className="min-w-0">
                <form onSubmit={addPrice}>
                  <p className="text-sm font-medium text-fg-soft">Add / update a price</p>
                  <div className="mt-2">
                    <ItemPickerSingle items={items} value={piItem} onChange={setPiItem} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={piPrice}
                      onChange={(e) => setPiPrice(e.target.value)}
                      placeholder="price"
                      className="w-28 rounded-lg border border-line-2 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
                    />
                    <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                      Save price
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-fg-faint">
                    Same item again = updates the price. Mark the ★ chosen supplier on <b>Price Comparison</b> — and you can
                    pick any supplier per order on <b>Purchasing</b>.
                  </p>
                </form>

                <div className="mt-5 rounded-xl border border-line bg-paper-2/60 p-3">
                  <p className="text-sm font-medium text-fg-soft">Or bulk import a price list</p>
                  <p className="mb-2 mt-1 text-xs text-fg-faint">
                    Upload the vendor&apos;s Excel — columns <b>Item</b>, <b>Price</b>, optional <b>Unit</b>. New items are
                    created automatically; re-uploading the same file is safe (prices just update).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      ⬆ Import .xlsx
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadFile("/vendors/price-list-template.xlsx", "mise-vendor-price-list-template.xlsx")}
                      className="rounded-lg border border-line-2 px-4 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
                    >
                      ⬇ Download template
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
