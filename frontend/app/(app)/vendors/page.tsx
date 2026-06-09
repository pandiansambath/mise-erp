"use client";

import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  type Item,
  type Vendor,
  type VendorItem,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const CATEGORIES = ["FOOD", "BEVERAGE", "BAR", "UTILITY", "SERVICE", "PROPERTY"];
const inputCls =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

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

      <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        <b>How it works:</b> add a vendor → open it → add the items they supply <i>with a price</i>. Those prices feed{" "}
        <b>Price Comparison</b> (cheapest wins) and let <b>Purchasing</b> turn an indent into a PO. An item with no
        vendor price can&apos;t be ordered yet.
      </div>

      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-medium text-slate-700">Add a vendor</p>
          <form onSubmit={addVendor} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Name</label>
              <input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="e.g. Farm2Land" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Type</label>
              <select value={vCat} onChange={(e) => setVCat(e.target.value)} className={inputCls}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Contact (optional)</label>
              <input value={vContact} onChange={(e) => setVContact(e.target.value)} placeholder="person" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Mobile (optional)</label>
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
          <h3 className="px-5 pt-4 font-semibold text-slate-900">All vendors ({vendors.length})</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="px-5 py-2 font-medium">Vendor</th>
                  <th className="px-5 py-2 font-medium">Type</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {vendors.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400">No vendors yet. Add one above.</td></tr>
                ) : vendors.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => selectVendor(v.id)}
                    className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${selected === v.id ? "bg-brand-50" : ""}`}
                  >
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-slate-800">{v.name}</p>
                      {v.contact_person && <p className="text-xs text-slate-400">{v.contact_person}{v.mobile ? ` · ${v.mobile}` : ""}</p>}
                    </td>
                    <td className="px-5 py-2.5 text-slate-500">{(v.category || "—").toLowerCase()}</td>
                    <td className="px-5 py-2.5">
                      <Badge tone={v.is_active ? "green" : "slate"}>{v.is_active ? "active" : "inactive"}</Badge>
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span className="text-xs font-medium text-brand-700">Manage →</span>
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
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              Select a vendor to see (and add) what they supply.
            </p>
          ) : (
            <div>
              <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h3 className="font-semibold text-slate-900">{selectedVendor.name}</h3>
                  <p className="text-xs text-slate-400">{(selectedVendor.category || "—").toLowerCase()} supplier</p>
                </div>
                {canWrite && (
                  <button
                    onClick={() => toggleActive(selectedVendor)}
                    className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    {selectedVendor.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                )}
              </div>

              <div className="px-5 py-3">
                <p className="text-sm font-medium text-slate-700">What they supply</p>
                <table className="mt-2 w-full text-sm">
                  <thead>
                    <tr className="border-y border-slate-200 text-left text-xs uppercase text-slate-500">
                      <th className="py-2 font-medium">Item</th>
                      <th className="py-2 text-right font-medium">Price / unit</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorItems.length === 0 ? (
                      <tr><td colSpan={3} className="py-5 text-center text-slate-400">No prices yet — add one below.</td></tr>
                    ) : vendorItems.map((vi) => (
                      <tr key={vi.id} className="border-b border-slate-100">
                        <td className="py-2 font-medium text-slate-800">{itemName(vi.item_id)}</td>
                        <td className="py-2 text-right text-slate-700">{format(vi.price_per_unit)}</td>
                        <td className="py-2 text-right">{vi.is_preferred && <Badge tone="amber">★ preferred</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {canWrite && (
                <form onSubmit={addPrice} className="border-t border-slate-100 px-5 py-4">
                  <p className="mb-2 text-sm font-medium text-slate-700">Add / update a price</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,auto,auto]">
                    <select value={piItem} onChange={(e) => setPiItem(e.target.value)} className={inputCls}>
                      <option value="">Select item…</option>
                      {items.map((i) => (
                        <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={piPrice}
                      onChange={(e) => setPiPrice(e.target.value)}
                      placeholder="price"
                      className={`${inputCls} sm:w-28`}
                    />
                    <button type="submit" className="mt-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                      Save
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">Same item again = updates the price. Set the chosen supplier as &quot;preferred&quot; on the Price Comparison page.</p>
                </form>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
