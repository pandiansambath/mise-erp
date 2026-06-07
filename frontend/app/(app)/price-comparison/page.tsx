"use client";

import { useEffect, useState } from "react";
import { api, type Item, type PriceComparison } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";

export default function PriceComparisonPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [data, setData] = useState<PriceComparison | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingCompare, setLoadingCompare] = useState(false);

  useEffect(() => {
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

  return (
    <div>
      <PageHeader
        title="Price Comparison"
        subtitle="Who's cheapest for each item — and how much you'd save by switching."
      />

      {items.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-slate-400">
            No items yet. Add items and vendor prices to compare.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-6 max-w-md">
            <label htmlFor="item" className="block text-sm font-medium text-slate-700">
              Item
            </label>
            <select
              id="item"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.unit})
                </option>
              ))}
            </select>
          </div>

          {loadingCompare || !data ? (
            <Spinner />
          ) : data.vendor_count === 0 ? (
            <Card>
              <p className="py-6 text-center text-sm text-slate-400">
                No vendor prices recorded for this item yet.
              </p>
            </Card>
          ) : (
            <>
              {parseFloat(data.potential_saving_per_unit) > 0 && (
                <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50 p-4">
                  <p className="text-sm text-brand-700">
                    Cheapest is{" "}
                    <span className="font-semibold">{data.cheapest_vendor?.vendor_name}</span> at{" "}
                    <span className="font-semibold">£{data.cheapest_vendor?.price_per_unit}</span> /
                    {data.unit}. Switching from the priciest saves{" "}
                    <span className="font-semibold">
                      £{data.potential_saving_per_unit}/{data.unit}
                    </span>
                    .
                  </p>
                </div>
              )}

              <Card className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-3 font-medium">Vendor</th>
                        <th className="px-5 py-3 text-right font-medium">Price / {data.unit}</th>
                        <th className="px-5 py-3 text-right font-medium">Updated</th>
                        <th className="px-5 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.comparisons.map((row, idx) => (
                        <tr
                          key={row.vendor_id}
                          className={`border-b border-slate-100 ${idx === 0 ? "bg-brand-50/50" : ""}`}
                        >
                          <td className="px-5 py-3 font-medium text-slate-800">
                            {row.vendor_name}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold text-slate-900">
                            £{row.price_per_unit}
                          </td>
                          <td className="px-5 py-3 text-right text-slate-400">
                            {row.last_updated}
                          </td>
                          <td className="px-5 py-3">
                            {idx === 0 && <Badge tone="green">Cheapest</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
