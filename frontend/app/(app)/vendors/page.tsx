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

  return (
    <div>
      <PageHeader
        title="Vendors"
        subtitle="Your suppliers and what each one sells. Set an item's price here so it can be costed and ordered."
      />

      <div className="mb-6 rounded-xl border border-line bg-paper-2 p-4 text-sm text-fg-soft">
        <b>How it works:</b> add a vendor → open it → add the items they supply <i>with a price</i>. Those prices feed{" "}
        <b>Price Comparison</b> (cheapest wins) and let <b>Purchasing</b> turn an indent into a PO. An item with no
        vendor price can&apos;t be ordered yet.
      </div>

      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onImportFile} />
      {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-brand-400/10 px-3 py-2 text-sm text-brand-300">{notice}</p>}

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-medium text-fg-soft">Add a vendor</p>
          <form onSubmit={addVendor} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-fg-soft">Name</label>
              <input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="e.g. Farm2Land" className={inputCls} />
            </div>
            <div>
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
                        : "border border-line-2 text-fg-soft hover:bg-white/5"
                    }`}
                  >
                    {c.toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Contact (optional)</label>
              <input value={vContact} onChange={(e) => setVContact(e.target.value)} placeholder="person" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Mobile (optional)</label>
              <input value={vMobile} onChange={(e) => setVMobile(e.target.value)} placeholder="phone" className={inputCls} />
            </div>
            <div className="sm:col-span-4">
              <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Add vendor
              </button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Vendor list */}
        <Card className="p-0">
          <h3 className="px-5 pt-4 font-semibold text-fg">All vendors ({vendors.length})</h3>
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs uppercase text-fg-faint">
                  <th className="px-5 py-2 font-medium">Vendor</th>
                  <th className="px-5 py-2 font-medium">Type</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {vendors.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-fg-faint">No vendors yet. Add one above.</td></tr>
                ) : vendors.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => selectVendor(v.id)}
                    className={`cursor-pointer border-b border-line hover:bg-paper-2 ${selected === v.id ? "bg-brand-400/10" : ""}`}
                  >
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-fg">{v.name}</p>
                      {v.contact_person && <p className="text-xs text-fg-faint">{v.contact_person}{v.mobile ? ` · ${v.mobile}` : ""}</p>}
                    </td>
                    <td className="px-5 py-2.5 text-fg-faint">{(v.category || "—").toLowerCase()}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={v.is_active ? "green" : "slate"}>{v.is_active ? "active" : "inactive"}</Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span className="text-xs font-medium text-brand-300">Manage →</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Selected vendor detail */}
        <Card className="p-0">
          {!selectedVendor ? (
            <p className="px-5 py-10 text-center text-sm text-fg-faint">
              Select a vendor to see (and add) what they supply.
            </p>
          ) : (
            <div>
              <div className="flex items-start justify-between border-b border-line px-5 py-4">
                <div>
                  <h3 className="font-semibold text-fg">{selectedVendor.name}</h3>
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

              <div className="px-5 py-3">
                <p className="text-sm font-medium text-fg-soft">What they supply</p>
                <div className="mt-2 max-h-[42vh] overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-line text-left text-xs uppercase text-fg-faint">
                      <th className="py-2 font-medium">Item</th>
                      <th className="py-2 text-right font-medium">Price / unit</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorItems.length === 0 ? (
                      <tr><td colSpan={3} className="py-5 text-center text-fg-faint">No prices yet — add one below.</td></tr>
                    ) : vendorItems.map((vi) => (
                      <tr key={vi.id} className="border-b border-line">
                        <td className="py-2 font-medium text-fg">{itemName(vi.item_id)}</td>
                        <td className="py-2 text-right text-fg-soft">{format(vi.price_per_unit)}</td>
                        <td className="py-2 text-right">{vi.is_preferred && <Badge tone="amber">★ preferred</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>

              {canWrite && (
                <form onSubmit={addPrice} className="border-t border-line px-5 py-4">
                  <p className="mb-2 text-sm font-medium text-fg-soft">Add / update a price</p>
                  <ItemPickerSingle items={items} value={piItem} onChange={setPiItem} />
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
                      Save
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-fg-faint">Same item again = updates the price. Set the chosen supplier as &quot;preferred&quot; on the Price Comparison page.</p>
                </form>
              )}

              {canWrite && (
                <div className="border-t border-line px-5 py-4">
                  <p className="mb-1 text-sm font-medium text-fg-soft">Or bulk import a price list</p>
                  <p className="mb-2 text-xs text-fg-faint">
                    Upload the vendor&apos;s Excel — columns <b>Item</b>, <b>Price</b>, optional <b>Unit</b>. New items are created automatically; re-uploading the same file is safe (prices just update).
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
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
