"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Item, type PriceComparison, type Vendor } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { ItemPickerSingle } from "@/components/ItemPicker";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

export default function PriceComparisonPage() {
  const { user } = useAuth();
  const canWrite = can(user?.role, "vendors:write");
  const [items, setItems] = useState<Item[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [data, setData] = useState<PriceComparison | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [addVendorId, setAddVendorId] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const { format } = useCurrency();

  async function setPreferred(vendorId: string | null) {
    const res = await api.post<PriceComparison>(`/vendors/items/${selected}/preferred`, {
      vendor_id: vendorId,
    });
    setData(res);
  }

  function reloadCompare() {
    api.get<PriceComparison>(`/vendors/items/${selected}/price-comparison`).then(setData);
  }

  async function addVendorPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!addVendorId || !addPrice) {
      setAddError("Pick a vendor and enter a price.");
      return;
    }
    setAddError(null);
    try {
      await api.post(`/vendors/${addVendorId}/items`, {
        item_id: selected,
        price_per_unit: addPrice,
      });
      setAddPrice("");
      setAddVendorId("");
      reloadCompare();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Could not add price");
    }
  }

  useEffect(() => {
    api.get<Vendor[]>("/vendors").then(setVendors).catch(() => {});
    api
      .get<Item[]>("/inventory/items")
      .then((i) => {
        setItems(i);
        if (i.length) setSelected(i[0].id);
      })
      .finally(() => setLoadingItems(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoadingCompare(true);
    api
      .get<PriceComparison>(`/vendors/items/${selected}/price-comparison`)
      .then(setData)
      .finally(() => setLoadingCompare(false));
  }, [selected]);

  if (loadingItems) return <Spinner />;

  const addPriceForm = canWrite ? (
    <Card className="mt-4">
      <p className="mb-2 text-sm font-medium text-fg-soft">Add a vendor price for this item</p>
      <form onSubmit={addVendorPrice} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,auto,auto]">
        <select
          value={addVendorId}
          onChange={(e) => setAddVendorId(e.target.value)}
          className="rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
        >
          <option value="">Select vendor…</option>
          {vendors.filter((v) => v.is_active).map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
        <input
          type="number"
          step="0.01"
          min="0"
          value={addPrice}
          onChange={(e) => setAddPrice(e.target.value)}
          placeholder="price"
          className="rounded-lg border border-line-2 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 sm:w-28"
        />
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          Add
        </button>
      </form>
      {addError && <p className="mt-2 text-sm text-rose-400">{addError}</p>}
      <p className="mt-2 text-xs text-fg-faint">
        Vendor not listed? Add them on the <b>Vendors</b> page first.
      </p>
    </Card>
  ) : null;

  return (
    <div>
      <PageHeader
        title="Price Comparison"
        subtitle="Who's cheapest for each item — and how much you'd save by switching."
      />

      {items.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-fg-faint">
            No items yet. Add items and vendor prices to compare.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <p className="mb-3 text-sm font-medium text-fg-soft">Pick an item to compare suppliers</p>
            <ItemPickerSingle items={items} value={selected} onChange={setSelected} />
          </Card>

          {loadingCompare || !data ? (
            <Spinner />
          ) : data.vendor_count === 0 ? (
            <>
              <Card>
                <p className="py-6 text-center text-sm text-fg-faint">
                  No vendor prices recorded for this item yet — add one below so it can be ordered.
                </p>
              </Card>
              {addPriceForm}
            </>
          ) : (
            <>
              {parseFloat(data.potential_saving_per_unit) > 0 && (
                <div className="mb-5 rounded-xl border border-brand-400/30 bg-brand-400/10 p-4">
                  <p className="text-sm text-brand-300">
                    Cheapest is{" "}
                    <span className="font-semibold">{data.cheapest_vendor?.vendor_name}</span> at{" "}
                    <span className="font-semibold">
                      {format(data.cheapest_vendor?.price_per_unit)}
                    </span>{" "}
                    /{data.unit}. Switching from the priciest saves{" "}
                    <span className="font-semibold">
                      {format(data.potential_saving_per_unit)}/{data.unit}
                    </span>
                    .
                  </p>
                </div>
              )}

              <Card className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-faint">
                        <th className="px-5 py-3 font-medium">Vendor</th>
                        <th className="px-5 py-3 text-right font-medium">Price / {data.unit}</th>
                        <th className="px-5 py-3 font-medium"></th>
                        <th className="px-5 py-3 text-right font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.comparisons.map((row, idx) => (
                        <tr
                          key={row.vendor_id}
                          className={`border-b border-line ${row.is_preferred ? "bg-brand-400/10" : idx === 0 ? "bg-brand-400/5" : ""}`}
                        >
                          <td className="px-5 py-3 font-medium text-fg">
                            {row.vendor_name}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-fg">
                            {format(row.price_per_unit)}
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex gap-1.5">
                              {idx === 0 && <Badge tone="green">Cheapest</Badge>}
                              {row.is_preferred && <Badge tone="amber">★ Chosen supplier</Badge>}
                            </div>
                          </td>
                          <td className="px-5 py-3 text-right">
                            {canWrite && !row.is_preferred && (
                              <button
                                onClick={() => setPreferred(row.vendor_id)}
                                className="rounded-md border border-line px-2 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2"
                              >
                                Choose supplier
                              </button>
                            )}
                            {canWrite && row.is_preferred && (
                              <button
                                onClick={() => setPreferred(null)}
                                className="rounded-md border border-line px-2 py-1 text-xs text-fg-faint hover:bg-paper-2"
                              >
                                Clear
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <p className="mt-3 text-xs text-fg-faint">
                <b>Purchasing orders from your chosen supplier</b> — pick one here for each item
                (no auto-cheapest), e.g. for quality/reliability. Recipe costs still use the
                cheapest vendor until a supplier is chosen.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
