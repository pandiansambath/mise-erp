"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Item, type ItemSuppliers, type PriceComparison, type PricePoint, type Vendor } from "@/lib/api";

type PriceChange = {
  vendor_name: string; old_price: string | null; new_price: string; source: string; at: string;
};
const SRC_TONE: Record<string, "slate" | "amber" | "green"> = {
  manual: "slate", po: "amber", invoice: "green",
};
import { Badge, Button, Card, PageHeader, Spinner } from "@/components/ui";
import { AreaChart } from "@/components/charts";
import { Select } from "@/components/Select";
import { ItemPickerSingle } from "@/components/ItemPicker";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const OVERLAY_COLORS = ["#10b981", "#38bdf8", "#f59e0b", "#a78bfa", "#f43f5e", "#94a3b8"];

/** Every vendor's quoted price for THIS item over time — one step-line per
 *  vendor, so you can see who drifted expensive and when the lines crossed. */
function VendorOverlay({ changes }: { changes: PriceChange[] }) {
  const { format } = useCurrency();
  const byVendor = new Map<string, { t: number; p: number }[]>();
  for (const c of changes) {
    const t = new Date(c.at).getTime();
    const pr = parseFloat(c.new_price) || 0;
    if (!byVendor.has(c.vendor_name)) byVendor.set(c.vendor_name, []);
    byVendor.get(c.vendor_name)!.push({ t, p: pr });
  }
  for (const pts of byVendor.values()) pts.sort((a, b) => a.t - b.t);
  if (byVendor.size < 2) return null;

  const all = [...byVendor.values()].flat();
  const t0 = Math.min(...all.map((x) => x.t));
  const t1 = Math.max(...all.map((x) => x.t));
  const pMin = Math.min(...all.map((x) => x.p));
  const pMax = Math.max(...all.map((x) => x.p));
  const spanT = Math.max(1, t1 - t0);
  const spanP = Math.max(0.01, pMax - pMin);
  const X = (t: number) => 2 + ((t - t0) / spanT) * 92; // leave room to run to the edge
  const Y = (pr: number) => 34 - ((pr - pMin) / spanP) * 28;

  const series = [...byVendor.entries()].map(([name, pts], i) => {
    // step-after: a price holds until the vendor moves it
    let d = `M ${X(pts[0].t)} ${Y(pts[0].p)}`;
    for (let k = 1; k < pts.length; k++) d += ` H ${X(pts[k].t)} V ${Y(pts[k].p)}`;
    d += " H 98";
    return { name, d, color: OVERLAY_COLORS[i % OVERLAY_COLORS.length], last: pts[pts.length - 1].p, n: pts.length };
  });

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
        Every supplier&apos;s price, overlaid — where the lines cross is where switching paid
      </p>
      <div className="mise-well mt-3 rounded-xl p-3">
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-36 w-full" aria-hidden>
          {[6, 20, 34].map((y) => (
            <line key={y} x1="0" x2="100" y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" vectorEffect="non-scaling-stroke" />
          ))}
          {series.map((sr) => (
            <path
              key={sr.name}
              d={sr.d}
              fill="none"
              stroke={sr.color}
              strokeWidth="2"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              opacity="0.9"
            />
          ))}
        </svg>
      </div>
      <div className="mt-2 space-y-1">
        {series
          .sort((a, b) => a.last - b.last)
          .map((sr) => (
            <div key={sr.name} className="flex items-baseline gap-2 text-xs">
              <span className="h-2 w-2 shrink-0 self-center rounded-full" style={{ background: sr.color }} />
              <span className="text-fg-soft">{sr.name}</span>
              <span className="mb-1 flex-1 border-b border-dotted border-line" />
              <span className="font-mono text-fg">{format(String(sr.last))}</span>
              <span className="text-fg-faint">now · {sr.n} change{sr.n === 1 ? "" : "s"}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

/** What you actually paid over time — self-drawing area line from the chart kit. */
function PriceHistoryChart({ points }: { points: PricePoint[] }) {
  const { format } = useCurrency();
  if (points.length < 2) {
    return (
      <p className="text-sm text-fg-faint">
        Not enough order history yet — prices you pay on Purchasing will plot here.
      </p>
    );
  }
  const prices = points.map((p) => parseFloat(p.price) || 0);
  const first = prices[0];
  const last = prices[prices.length - 1];
  const change = first > 0 ? ((last - first) / first) * 100 : 0;
  const rising = change > 0;
  return (
    <div>
      <AreaChart
        data={prices}
        labels={points.map((p) => p.date)}
        color={rising ? "#f43f5e" : "#10b981"}
        height={130}
        formatValue={(v) => format(String(v))}
      />
      <p className="mt-2 text-xs text-fg-faint">
        {points.length} orders · {points[0].date} → {points[points.length - 1].date} ·{" "}
        <span className={change > 0 ? "text-rose-400" : change < 0 ? "text-brand-400" : ""}>
          {change > 0 ? "▲" : change < 0 ? "▼" : "→"} {Math.abs(change).toFixed(0)}% overall
        </span>
      </p>
    </div>
  );
}

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
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [changeLog, setChangeLog] = useState<PriceChange[]>([]);
  const [allSuppliers, setAllSuppliers] = useState<ItemSuppliers[]>([]);
  const { format } = useCurrency();

  useEffect(() => {
    api.get<ItemSuppliers[]>("/purchasing/item-suppliers").then(setAllSuppliers).catch(() => {});
  }, []);

  // If every item switched to its cheapest supplier, per-unit savings add up to:
  const switchSave = (() => {
    let total = 0;
    let count = 0;
    for (const row of allSuppliers) {
      if (row.vendors.length < 2) continue;
      const cheapest = Math.min(...row.vendors.map((v) => parseFloat(v.price_per_unit) || Infinity));
      const current = row.vendors.find((v) => v.is_preferred);
      const cur = current ? parseFloat(current.price_per_unit) : cheapest;
      if (cur - cheapest > 0.001) {
        total += cur - cheapest;
        count += 1;
      }
    }
    return { total, count };
  })();

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
    api.get<PricePoint[]>(`/reports/price-history/${selected}`).then(setHistory).catch(() => setHistory([]));
    api.get<{ history: PriceChange[] }>(`/vendors/items/${selected}/price-history`)
      .then((r) => setChangeLog(r.history)).catch(() => setChangeLog([]));
  }, [selected]);

  if (loadingItems) return <Spinner />;

  const addPriceForm = canWrite ? (
    <Card className="mise-feel mt-4">
      <p className="mb-2 text-sm font-medium text-fg-soft">Add a vendor price for this item</p>
      <form onSubmit={addVendorPrice} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr,auto,auto]">
        <Select
          value={addVendorId}
          onChange={setAddVendorId}
          placeholder="Select vendor…"
          options={[
            { value: "", label: "Select vendor…" },
            ...vendors.filter((v) => v.is_active).map((v) => ({ value: v.id, label: v.name })),
          ]}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={addPrice}
          onChange={(e) => setAddPrice(e.target.value)}
          placeholder="price"
          className="mise-well rounded-lg px-3 py-2 text-sm outline-none sm:w-28"
        />
        <Button type="submit" variant="primary">
          Add
        </Button>
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

      {switchSave.count > 0 && (
        <Card className="mise-feel mb-5 border-brand-400/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-fg">
              <span aria-hidden className="mr-1.5">💡</span>
              <b>{switchSave.count}</b> item{switchSave.count === 1 ? " isn't" : "s aren't"} on their cheapest supplier —
              switching saves <b className="text-brand-400">{format(String(Math.round(switchSave.total * 100) / 100))}</b>
              <span className="text-xs text-fg-faint"> per unit of each, every order</span>
            </p>
            <span className="text-[11px] text-fg-faint">pick ★ per item below, or override per order on Purchasing</span>
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-fg-faint">
            No items yet. Add items and vendor prices to compare.
          </p>
        </Card>
      ) : (
        <>
          <div className="mb-6 rounded-2xl border border-brand-400/20 bg-gradient-to-b from-brand-400/[0.06] via-paper/90 to-paper/90 p-5 shadow-lg shadow-black/20">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-fg">🧑‍🍳 Pick an item to compare suppliers</p>
              <p className="text-xs text-fg-faint">★ = its current supplier · you can pick any vendor per order on Purchasing</p>
            </div>
            <ItemPickerSingle items={items} value={selected} onChange={setSelected} />
          </div>

          <Card className="mise-feel mb-5">
            <h3 className="font-semibold text-fg">Price history — what you&apos;ve paid</h3>
            <p className="mb-3 text-xs text-fg-faint">
              From your received purchase orders — green line falling is good, red line climbing is money leaking.
            </p>
            <PriceHistoryChart points={history} />
            <VendorOverlay changes={changeLog} />
          </Card>

          {changeLog.length > 0 && (
            <Card className="mise-feel mb-5">
              <h3 className="font-semibold text-fg">Price change log</h3>
              <p className="mb-3 text-xs text-fg-faint">
                Every recorded price change for this item — kept forever, with where it came from
                (<b className="text-fg-soft">manual</b> edit, a received <b className="text-fg-soft">PO</b>, or a scanned{" "}
                <b className="text-fg-soft">invoice</b>). Old prices are never lost.
              </p>
              <ul className="space-y-1.5">
                {changeLog.map((c, i) => (
                  <li key={i} className="mise-well mise-feel flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
                    <span className="text-fg">
                      <b>{c.vendor_name}</b>{" "}
                      {c.old_price ? (
                        <span className="text-fg-faint">{format(c.old_price)} → </span>
                      ) : (
                        <span className="text-fg-faint">first price </span>
                      )}
                      <b className="text-fg">{format(c.new_price)}</b>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-fg-faint">
                      <Badge tone={SRC_TONE[c.source] ?? "slate"}>{c.source}</Badge>
                      {new Date(c.at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

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
                                className="mise-raised mise-press rounded-md px-2 py-1 text-xs font-medium text-fg-soft"
                              >
                                Choose supplier
                              </button>
                            )}
                            {canWrite && row.is_preferred && (
                              <button
                                onClick={() => setPreferred(null)}
                                className="mise-raised mise-press rounded-md px-2 py-1 text-xs text-fg-faint"
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
                <b>How ordering picks a supplier:</b> the vendor you pick on the order itself wins;
                otherwise your ★ chosen supplier here; otherwise the cheapest. Recipe costing
                follows the same rule.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
