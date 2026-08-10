"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Item, type ItemSuppliers, type PriceComparison, type PricePoint, type Vendor } from "@/lib/api";

type PriceChange = {
  vendor_name: string; old_price: string | null; new_price: string; source: string; at: string;
};
/** A vendor's price over time, small enough to sit on a card.
 *
 *  "Is this price normal?" is the question that decides whether a number is
 *  worth acting on, and it was behind a tab — so the decision was made on the
 *  card and the evidence lived somewhere else. Twelve pixels of shape answers
 *  it without anyone leaving.
 *
 *  Drawn from the change log the page already loads, so it costs no request. */
function Spark({ points, rising }: { points: number[]; rising: boolean }) {
  if (points.length < 2) return null;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const d = points
    .map((v, i) => {
      const x = (i / (points.length - 1)) * 56;
      const y = 16 - ((v - lo) / span) * 14;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 56 18" className="h-[18px] w-14 shrink-0" aria-hidden>
      <path
        d={d}
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        // Rising is bad news on a page about what you PAY, so it borrows the
        // same red the gap-to-cheapest chip uses.
        stroke={rising ? "var(--color-rose-400, #fb7185)" : "var(--color-emerald-400, #34d399)"}
      />
    </svg>
  );
}

const SRC_TONE: Record<string, "slate" | "amber" | "green"> = {
  manual: "slate", po: "amber", invoice: "green",
};
import { Badge, Button, Card, Spinner } from "@/components/ui";
import { Workbench } from "@/components/Workbench";
import { AreaChart } from "@/components/charts";
import { Select } from "@/components/Select";
import { ItemPickerSingle, categoryEmoji } from "@/components/ItemPicker";
import { DetailSheet, DetailRow } from "@/components/DetailSheet";
import { Pocket, flyToPocket } from "@/components/Pocket";
import Link from "next/link";
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
  // Which item's comparison is open in the sheet (separate from the selection,
  // because picking and inspecting are different intents).
  const [peek, setPeek] = useState<string | null>(null);
  const [data, setData] = useState<PriceComparison | null>(null);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingCompare, setLoadingCompare] = useState(false);
  const [addVendorId, setAddVendorId] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [changeLog, setChangeLog] = useState<PriceChange[]>([]);
  const [allSuppliers, setAllSuppliers] = useState<ItemSuppliers[]>([]);
  const [pane, setPane] = useState<"suppliers" | "history" | "changes" | "add">("suppliers");
  // One supplier's line, opened from the list — a sheet over the comparison.
  // Which of the two stages the page is showing.
  //
  // Not derived from `selected`: going BACK has to leave the chosen item
  // chosen, so the list opens with it still highlighted and reopening it
  // costs nothing. Two separate ideas — what you picked, and what you are
  // looking at.
  const [stage, setStage] = useState<"list" | "item">("list");
  const listScroll = useRef(0);

  // A shortlist you build up, which this page had no concept of.
  //
  // Comparing one item at a time answers "is THIS one right?" — but the
  // question an owner actually arrives with is "where am I losing money?",
  // and that is answered across several items at once. So items can be
  // gathered into a pocket and looked at together: what each is costing by
  // being on the wrong supplier, and what the whole lot adds up to.
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [pocketOpen, setPocketOpen] = useState(false);

  const gather = (id: string, from?: HTMLElement | null) => {
    if (shortlist.includes(id)) return;
    const it = items.find((i) => i.id === id);
    if (from) flyToPocket(from, it?.name);
    setShortlist((l) => [...l, id]);
  };

  const shortlistTotal = shortlist.reduce((t, id) => t + (savingByItem[id] ?? 0), 0);

  const openItem = (id: string) => {
    listScroll.current = window.scrollY;   // remember where they were reading
    setSelected(id);
    setStage("item");
    window.scrollTo({ top: 0 });
  };
  const backToList = () => {
    setStage("list");
    // Put them back on the row they left from, not at the top of a long list.
    requestAnimationFrame(() => window.scrollTo({ top: listScroll.current }));
  };

  const [openRow, setOpenRow] = useState<string | null>(null);
  const [rowPrice, setRowPrice] = useState("");
  const [rowBusy, setRowBusy] = useState(false);
  const { format } = useCurrency();

  useEffect(() => {
    api.get<ItemSuppliers[]>("/purchasing/item-suppliers").then(setAllSuppliers).catch(() => {});
  }, []);

  // How many items are on a dearer supplier than they need to be, and which one
  // is worst.
  //
  // This used to ADD UP the per-unit savings and show the sum as a big pound
  // figure — "£2.33 sitting on the table". He asked what it meant, and the
  // honest answer is: nothing. It added £/kg to £/piece to £/pack. Those are
  // not the same unit, so the total is not money, not per-unit, not anything.
  // You could not spend it, budget with it, or check it.
  //
  // Real money needs volume: (what you pay − the cheapest) × how much you
  // actually buy. The purchase quantities exist (po_items) but there is no
  // aggregate endpoint yet, so rather than dress a meaningless number up as
  // money, the page now says the true thing it knows — how many items are on
  // the wrong supplier, and the biggest single per-unit gap, WITH its unit.
  const switchSave = (() => {
    let total = 0;
    let count = 0;
    let best = { name: "", per: 0, unit: "" };
    for (const row of allSuppliers) {
      if (row.vendors.length < 2) continue;
      const cheapest = Math.min(...row.vendors.map((v) => parseFloat(v.price_per_unit) || Infinity));
      const current = row.vendors.find((v) => v.is_preferred);
      const cur = current ? parseFloat(current.price_per_unit) : cheapest;
      if (cur - cheapest > 0.001) {
        total += cur - cheapest;
        count += 1;
        const gap = cur - cheapest;
        if (gap > best.per) {
          const it = items.find((i) => i.id === row.item_id);
          best = { name: it?.name ?? "", per: gap, unit: it?.unit ?? "" };
        }
      }
    }
    return { total, count, best };
  })();

  // What each item is costing by being on the wrong supplier.
  //
  // The page exists to answer "where am I overpaying", and it was answering it
  // alphabetically — which is a filing cabinet, not a decision list. With this
  // the worst offender is the first thing you see.
  const savingByItem: Record<string, number> = {};
  for (const row of allSuppliers) {
    if (row.vendors.length < 2) continue;
    const cheapest = Math.min(...row.vendors.map((v) => parseFloat(v.price_per_unit) || Infinity));
    const chosen = row.vendors.find((v) => v.is_preferred);
    const cur = chosen ? parseFloat(chosen.price_per_unit) : cheapest;
    if (cur - cheapest > 0.001) savingByItem[row.item_id] = cur - cheapest;
  }
  // Biggest saving first, then everything else as it was.
  const rankedItems = [...items].sort(
    (a, b) => (savingByItem[b.id] ?? -1) - (savingByItem[a.id] ?? -1),
  );

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
        // Arriving from Purchasing's "full history" link lands on THAT item,
        // not the alphabetical first one. A deep link that drops you on an
        // unrelated item is worse than no link.
        const wanted = new URLSearchParams(window.location.search).get("item");
        const found = wanted && i.some((x) => x.id === wanted) ? wanted : i[0]?.id;
        if (found) setSelected(found);
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

  const peeked = peek ? items.find((i) => i.id === peek) : null;
  const chosenItem = items.find((i) => i.id === selected) ?? null;

  // item id -> its vendors, cheapest first. Already fetched for the savings
  // banner at the top; the cards can read the same thing for free.
  const supplierMap = (() => {
    const m: Record<string, { vendor_name: string; price_per_unit: string; is_preferred: boolean }[]> = {};
    for (const row of allSuppliers) {
      m[row.item_id] = [...row.vendors].sort(
        (a, b) => (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0),
      );
    }
    return m;
  })();

  return (
    <Workbench
      title="Price Comparison"
      subtitle="Who's cheapest for each item — and how much you'd save by switching."
      tally={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-faint">
          <span>
            <b className="text-fg-soft">{items.length}</b> item
            {items.length === 1 ? "" : "s"}
          </span>
          {switchSave.count > 0 ? (
            // The one number this page exists to produce, kept on screen. It
            // used to require reaching the bottom of the page to see.
            <span className="text-emerald-300">
              <b>{switchSave.count}</b> item{switchSave.count === 1 ? "" : "s"} on a
              dearer supplier than needed
            </span>
          ) : (
            <span>Every item is already on its cheapest supplier.</span>
          )}
        </div>
      }
    >

      {/* Every supplier for one item, opened from its card. The saving is
          pinned in the header because it is the only number that decides
          anything here. */}
      <DetailSheet
        open={!!peeked}
        onClose={() => setPeek(null)}
        width="lg"
        icon={categoryEmoji(peeked?.category ?? "")}
        title={peeked?.name ?? ""}
        subtitle={
          data && data.item_id === peek
            ? `${data.vendor_count} supplier${data.vendor_count === 1 ? "" : "s"} price this`
            : "loading…"
        }
        stats={
          data && data.item_id === peek && data.cheapest_vendor
            ? [
                {
                  label: "Cheapest",
                  value: format(data.cheapest_vendor.price_per_unit),
                  hint: data.cheapest_vendor.vendor_name,
                  tone: "good",
                },
                {
                  label: "Priciest",
                  value: data.most_expensive_vendor
                    ? format(data.most_expensive_vendor.price_per_unit)
                    : "—",
                  hint: data.most_expensive_vendor?.vendor_name ?? "",
                  tone: "bad",
                },
                {
                  label: "You'd save",
                  value: format(data.potential_saving_per_unit),
                  hint: `per ${data.unit}, every order`,
                  tone: Number(data.potential_saving_per_unit) > 0 ? "warn" : "plain",
                },
              ]
            : undefined
        }
      >
        {loadingCompare || !data || data.item_id !== peek ? (
          <Spinner />
        ) : data.comparisons.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-faint">
            No supplier prices this item yet. Add one on the Vendors page and it becomes
            orderable and costable.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {data.comparisons.map((v) => {
              const cheapest = v.vendor_id === data.cheapest_vendor?.vendor_id;
              return (
                <li
                  key={v.vendor_id}
                  className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 transition ${
                    v.is_preferred
                      ? "border-brand-400/40 bg-brand-400/[0.08]"
                      : cheapest
                        ? "border-emerald-400/30 bg-emerald-400/[0.06]"
                        : "border-line"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                    {v.vendor_name}
                    {v.is_preferred && (
                      <span className="ml-2 text-[11px] text-brand-300">★ chosen</span>
                    )}
                  </span>
                  <span className={`font-display text-sm font-semibold tabular-nums ${
                    cheapest ? "text-emerald-300" : "text-fg-soft"
                  }`}>
                    {format(v.price_per_unit)}
                  </span>
                  {cheapest && !v.is_preferred && (
                    <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                      cheapest
                    </span>
                  )}
                  {/* The point of opening this is to DECIDE. Listing prices and
                      making you close the sheet to act on them was half a
                      feature. */}
                  {canWrite && (
                    v.is_preferred ? (
                      <button
                        type="button"
                        onClick={() => setPreferred(null)}
                        className="mise-press shrink-0 rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-fg-faint hover:text-fg"
                      >
                        Clear
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPreferred(v.vendor_id)}
                        className="mise-press shrink-0 rounded-lg border border-brand-400/40 bg-brand-400/10 px-2.5 py-1 text-[11px] font-medium text-brand-300"
                      >
                        Choose
                      </button>
                    )
                  )}
                  {/* Straight to that supplier's page — "who are they, what else
                      do they sell, what do I owe them" is the obvious next
                      question and it was a manual hunt. */}
                  <Link
                    href={`/vendors?vendor=${v.vendor_id}`}
                    title={`Open ${v.vendor_name} on the Vendors page`}
                    className="mise-press grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line text-xs text-fg-faint transition hover:border-brand-400/50 hover:text-brand-300"
                  >
                    ↗
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </DetailSheet>

      {/* Lead with the money.
          This was a sentence in a tinted box — the single most valuable number
          on the page, set at the same size as everything around it. A page
          whose whole job is "where am I overpaying" should answer that before
          it asks anything. */}
      {switchSave.count > 0 && stage === "list" && (
        <div className="mise-feel mb-5 overflow-hidden rounded-2xl border border-brand-400/30 bg-gradient-to-br from-brand-400/[0.10] via-paper to-paper">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 p-5 sm:p-6">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-faint">
                On a dearer supplier
              </p>
              <p className="mt-1 font-display text-4xl font-semibold tabular-nums text-brand-300 sm:text-5xl">
                {switchSave.count}
              </p>
              <p className="mt-1 text-sm text-fg-soft">
                item{switchSave.count === 1 ? " is" : "s are"} costing more than
                {switchSave.count === 1 ? " it" : " they"} need to
                {switchSave.best.name && (
                  <>
                    {" "}
                    — worst is <b className="text-fg">{switchSave.best.name}</b> at{" "}
                    <b className="text-fg">
                      {format(String(Math.round(switchSave.best.per * 100) / 100))}
                    </b>{" "}
                    more per {switchSave.best.unit || "unit"}
                  </>
                )}
              </p>
            </div>
            <p className="text-[11px] leading-relaxed text-fg-faint">
              Worst first, below.
              <span className="mt-0.5 block">
                Pick ★ per item, or override per order on Purchasing.
              </span>
            </p>
          </div>
        </div>
      )}

      {stage === "list" && (
        <Pocket
          icon="⚖"
          count={shortlist.length}
          label={shortlist.length === 1 ? "item to review" : "items to review"}
          hint={shortlistTotal > 0 ? `${format(String(Math.round(shortlistTotal * 100) / 100))} on the table` : undefined}
          onOpen={() => setPocketOpen(true)}
        />
      )}

      {/* Everything gathered, side by side.
          One item at a time answers "is this one right?"; several at once
          answers "where am I losing money?", which is the question that
          actually brings somebody to this page. */}
      <DetailSheet
        open={pocketOpen}
        onClose={() => setPocketOpen(false)}
        width="lg"
        icon="⚖"
        title="Your shortlist"
        subtitle={`${shortlist.length} item${shortlist.length === 1 ? "" : "s"} gathered`}
        stats={
          shortlistTotal > 0
            ? [
                {
                  label: "On the table",
                  value: format(String(Math.round(shortlistTotal * 100) / 100)),
                  hint: "per unit, every order",
                  tone: "warn",
                },
              ]
            : undefined
        }
        actions={
          shortlist.length > 0 ? (
            <button
              type="button"
              onClick={() => setShortlist([])}
              className="mise-press rounded-lg border border-line px-3 py-1.5 text-sm text-fg-soft hover:bg-paper-2"
            >
              Empty the pocket
            </button>
          ) : null
        }
      >
        <ul className="space-y-2">
          {shortlist.map((id) => {
            const it = items.find((i) => i.id === id);
            if (!it) return null;
            const save = savingByItem[id] ?? 0;
            return (
              <li
                key={id}
                className="mise-neo-raised flex flex-wrap items-center gap-3 rounded-xl px-3.5 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">{it.name}</span>
                  <span className="block text-[11px] text-fg-faint">
                    {save > 0
                      ? `${format(String(Math.round(save * 100) / 100))} per ${it.unit} above the cheapest`
                      : "already on its best price"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPocketOpen(false);
                    openItem(id);
                  }}
                  className="mise-press shrink-0 rounded-lg border border-brand-400/40 bg-brand-400/10 px-3 py-1.5 text-xs font-medium text-brand-300"
                >
                  Compare ›
                </button>
                <button
                  type="button"
                  onClick={() => setShortlist((l) => l.filter((x) => x !== id))}
                  aria-label={`Remove ${it.name}`}
                  className="mise-press shrink-0 rounded-lg border border-line px-2 py-1.5 text-xs text-fg-faint hover:text-rose-300"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      </DetailSheet>

      {items.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-fg-faint">
            <span aria-hidden className="mb-2 block text-3xl opacity-40">⚖</span>
            <b className="block text-fg">Nothing to compare yet</b>
            <span className="mt-1 block">
              Comparing needs the same item priced by two suppliers. Add items in
              Inventory, then a price per supplier on the Vendors page — the second
              price is when this page starts earning its place.
            </span>
            <Link
              href="/vendors"
              className="mise-press mt-3 inline-block rounded-lg border border-brand-400/40 bg-brand-400/10 px-3.5 py-1.5 text-xs font-medium text-brand-300"
            >
              Add a supplier price →
            </Link>
          </p>
        </Card>
      ) : (
        <>
          {/* One thing at a time, each with the whole page.
              Two cards side by side meant neither had room: the list was a
              narrow column and the comparison was squeezed into what was left,
              so everything needed its own inner scroll. His call, and the
              right one — "kill the split". Pick an item and the comparison
              TAKES OVER; go back and the list does. */}
          <div className={stage === "list" ? "block" : "hidden"}>
            <div className="min-w-0 rounded-2xl border border-brand-400/20 bg-gradient-to-b from-brand-400/[0.06] via-paper/90 to-paper/90 p-4 shadow-lg shadow-black/20">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-sm font-semibold text-fg">🧑‍🍳 Pick an item</p>
                <p className="text-[11px] text-fg-faint">★ = its current supplier</p>
              </div>
              {/* Rows, not cards. Sixty-one items as 240px cards is a wall you
                  scroll past; the same information as rows is a list you scan.
                  And no sheet from here — the panel on the right already IS
                  the detail, so opening a modal over it showed the same thing
                  twice and hid the page underneath. */}
              <ItemPickerSingle
                items={rankedItems}
                value={selected}
                onChange={openItem}
                onGather={gather}
                dense
                suppliers={supplierMap}
              />
            </div>
          </div>

          <div className={stage === "item" ? "block" : "hidden"}>
            {/* Out, and back to where they were. The only navigation on this
                stage, because there is only one way back. */}
            <button
              type="button"
              onClick={backToList}
              className="mise-press mb-3 inline-flex items-center gap-2 rounded-xl border border-line px-3.5 py-2 text-sm font-medium text-fg-soft transition hover:border-brand-400/50 hover:text-brand-300"
            >
              <span aria-hidden>‹</span> All items
            </button>

            <div className="min-w-0">
              {loadingCompare || !data ? (
                // A shape of the thing that is coming, rather than a
                // spinner in an empty box — the page does not appear to jump
                // when the real cards land.
                <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
                  {[0, 1, 2].map((k) => (
                    <div key={k} className="mise-neo-raised rounded-2xl p-4">
                      <div className="h-3 w-24 animate-pulse rounded bg-fg/10" />
                      <div className="mt-3 h-7 w-28 animate-pulse rounded bg-fg/10" />
                      <div className="mt-3 h-4 w-20 animate-pulse rounded bg-fg/5" />
                    </div>
                  ))}
                </div>
              ) : data.vendor_count === 0 ? (
                <>
                  <Card>
                    <p className="py-6 text-center text-sm text-fg-faint">
                      No vendor prices for <b className="text-fg-soft">{chosenItem?.name}</b> yet —
                      add one below so it can be ordered and costed.
                    </p>
                  </Card>
                  {addPriceForm}
                </>
              ) : (
                <Card className="mise-feel flex flex-col p-0">
                  <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
                    <span aria-hidden className="mise-neo-raised grid h-9 w-9 shrink-0 place-items-center rounded-xl text-lg">
                      {categoryEmoji(chosenItem?.category ?? "")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-sm font-semibold text-fg">{chosenItem?.name}</p>
                      <p className="text-[11px] text-fg-faint">
                        {data.vendor_count} supplier{data.vendor_count === 1 ? "" : "s"} · per {data.unit}
                      </p>
                    </div>
                    {parseFloat(data.potential_saving_per_unit) > 0 && (
                      <span className="shrink-0 rounded-full bg-brand-400/15 px-2.5 py-1 text-[11px] font-semibold text-brand-300">
                        save {format(data.potential_saving_per_unit)}/{data.unit}
                      </span>
                    )}
                  </div>

                  {/* Evidence sits behind tabs rather than below. The chart and
                      the change log answer "why" — useful, but not what you
                      opened the page for, and they were pushing the decision
                      off the screen. */}
                  <div className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist">
                    {([
                      ["suppliers", `Suppliers (${data.vendor_count})`],
                      ["history", "What you paid"],
                      ["changes", `Changes${changeLog.length ? ` (${changeLog.length})` : ""}`],
                      ["add", "＋ Add a price"],
                    ] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        role="tab"
                        aria-selected={pane === key}
                        onClick={() => setPane(key)}
                        className={`shrink-0 whitespace-nowrap rounded-t-lg px-3 py-2 text-xs font-medium transition ${
                          pane === key
                            ? "border-b-2 border-brand-500 text-fg"
                            : "border-b-2 border-transparent text-fg-faint hover:text-fg-soft"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {/* No inner scroll cap. It existed to fit a 21rem column; the stage has
        the whole page now, so capping it only recreated the scroll-inside-a-
        scroll the split was killed to remove. */}
      <div className="p-4 sm:p-5">
                    {pane === "suppliers" && (
                      <>
                        {/* Cards, not table rows — the recipe section's language.
                            Each one carries the decision AND the way out to the
                            supplier, so nothing needs a second screen. */}
                        <ul className="mise-stagger grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
                          {data.comparisons.map((row, idx) => {
                            const gap =
                              parseFloat(row.price_per_unit) -
                              parseFloat(data.cheapest_vendor?.price_per_unit ?? row.price_per_unit);
                            return (
                              <li
                                key={row.vendor_id}
                                // The whole card is the door. Everything you
                                // might want to do to this supplier's price is
                                // behind it, so nothing needs another screen.
                                onClick={() => {
                                  setOpenRow(row.vendor_id);
                                  setRowPrice(row.price_per_unit);
                                }}
                                className={`mise-feel mise-neo-raised cursor-pointer rounded-2xl border p-4 transition hover:-translate-y-px hover:border-brand-400/50 ${
                                  row.is_preferred
                                    ? "border-brand-400/45 bg-brand-400/[0.09]"
                                    : idx === 0
                                      ? "border-emerald-400/30 bg-emerald-400/[0.06]"
                                      : "border-line bg-glass/5"
                                }`}
                              >
                                {/* The price is the point, so it is the biggest
                                    thing on the card — not a number tucked at
                                    the end of a row the same size as the name. */}
                                <p className="truncate text-[13px] font-medium text-fg-soft">
                                  {row.vendor_name}
                                </p>
                                <div className="mt-1 flex items-end justify-between gap-2">
                                  <p
                                    className={`font-display text-2xl font-semibold tabular-nums ${
                                      idx === 0 ? "text-emerald-300" : "text-fg"
                                    }`}
                                  >
                                    {format(row.price_per_unit)}
                                    <span className="ml-1 text-[11px] font-normal text-fg-faint">
                                      /{data.unit}
                                    </span>
                                  </p>
                                  {(() => {
                                    // This vendor's own line, oldest first.
                                    const mine = changeLog
                                      .filter((c) => c.vendor_name === row.vendor_name)
                                      .slice()
                                      .reverse();
                                    if (mine.length === 0) return null;
                                    const pts = [
                                      parseFloat(mine[0].old_price ?? mine[0].new_price) || 0,
                                      ...mine.map((c) => parseFloat(c.new_price) || 0),
                                    ];
                                    return (
                                      <Spark points={pts} rising={pts[pts.length - 1] > pts[0]} />
                                    );
                                  })()}
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  {idx === 0 && <Badge tone="green">Cheapest</Badge>}
                                  {row.is_preferred && <Badge tone="amber">★ Chosen</Badge>}
                                  {gap > 0.001 && (
                                    <span className="rounded-full border border-rose-400/30 px-2 py-0.5 text-[10px] text-rose-300">
                                      +{format(String(Math.round(gap * 100) / 100))} vs cheapest
                                    </span>
                                  )}
                                  <span className="flex-1" />
                                  {canWrite &&
                                    (row.is_preferred ? (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setPreferred(null); }}
                                        className="mise-press rounded-lg border border-line px-2.5 py-1 text-[11px] text-fg-faint hover:text-fg"
                                      >
                                        Clear
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); setPreferred(row.vendor_id); }}
                                        className="mise-press rounded-lg border border-brand-400/40 bg-brand-400/10 px-2.5 py-1 text-[11px] font-medium text-brand-300"
                                      >
                                        Choose
                                      </button>
                                    ))}
                                  <Link
                                    href={`/vendors?vendor=${row.vendor_id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    title={`Open ${row.vendor_name} on the Vendors page`}
                                    className="mise-press grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line text-xs text-fg-faint transition hover:border-brand-400/50 hover:text-brand-300"
                                  >
                                    ↗
                                  </Link>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
                          <b>How ordering picks a supplier:</b> the vendor on the order itself wins;
                          otherwise your ★ chosen supplier; otherwise the cheapest. Recipe costing
                          follows the same rule.
                        </p>

                        {/* Everything you can do to one supplier's price. */}
                        {(() => {
                          const row = data.comparisons.find((r) => r.vendor_id === openRow);
                          if (!row) return null;
                          const best = parseFloat(data.cheapest_vendor?.price_per_unit ?? row.price_per_unit);
                          const gap = parseFloat(row.price_per_unit) - best;
                          return (
                            <DetailSheet
                              open
                              onClose={() => setOpenRow(null)}
                              icon="🏷"
                              title={row.vendor_name}
                              subtitle={`${data.item_name} · per ${data.unit}`}
                              badge={row.is_preferred ? <Badge tone="amber">★ chosen</Badge> : undefined}
                            >
                              <DetailRow label="Their price" value={format(row.price_per_unit)} />
                              <DetailRow
                                label="Cheapest"
                                value={format(String(best))}
                                hint={
                                  gap > 0.001
                                    ? `they are ${format(String(Math.round(gap * 100) / 100))} more`
                                    : "this is the cheapest quote"
                                }
                              />

                              {canWrite && (
                                <>
                                  <p className="mt-5 text-xs font-medium uppercase tracking-wide text-fg-faint">
                                    Change what they charge
                                  </p>
                                  <div className="mt-2 flex flex-wrap items-end gap-2">
                                    <input
                                      inputMode="decimal"
                                      value={rowPrice}
                                      onChange={(e) => setRowPrice(e.target.value)}
                                      className="mise-well w-32 rounded-lg px-3 py-2 text-sm outline-none"
                                      aria-label={`New price from ${row.vendor_name}`}
                                    />
                                    <button
                                      type="button"
                                      disabled={rowBusy || !rowPrice}
                                      onClick={async () => {
                                        setRowBusy(true);
                                        try {
                                          await api.post(`/vendors/${row.vendor_id}/items`, {
                                            item_id: selected,
                                            price_per_unit: rowPrice,
                                          });
                                          setOpenRow(null);
                                          reloadCompare();
                                        } catch {
                                          /* the sheet stays open with what was typed */
                                        } finally {
                                          setRowBusy(false);
                                        }
                                      }}
                                      className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                                    >
                                      {rowBusy ? "Saving…" : "Save"}
                                    </button>
                                  </div>

                                  <div className="mt-4 flex flex-wrap gap-2">
                                    {row.is_preferred ? (
                                      <button
                                        type="button"
                                        onClick={async () => { await setPreferred(null); setOpenRow(null); }}
                                        className="mise-press rounded-lg border border-line px-3 py-1.5 text-sm text-fg-soft"
                                      >
                                        Stop choosing them
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={async () => { await setPreferred(row.vendor_id); setOpenRow(null); }}
                                        className="mise-press rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-200"
                                      >
                                        ★ Make them the chosen supplier
                                      </button>
                                    )}
                                    <Link
                                      href={`/vendors?vendor=${row.vendor_id}`}
                                      className="mise-press rounded-lg border border-line px-3 py-1.5 text-sm text-fg-soft hover:border-brand-400/50 hover:text-brand-300"
                                    >
                                      Open this supplier ↗
                                    </Link>
                                  </div>
                                </>
                              )}
                            </DetailSheet>
                          );
                        })()}
                      </>
                    )}

                    {pane === "history" && (
                      <>
                        <p className="mb-3 text-[11px] text-fg-faint">
                          From your received purchase orders — a falling green line is good, a
                          climbing red one is money leaking.
                        </p>
                        <PriceHistoryChart points={history} />
                        <VendorOverlay changes={changeLog} />
                      </>
                    )}

                    {pane === "add" && (
                      <>
                        <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
                          A price makes this item orderable and costable. Adding one here is the
                          same as adding it on the Vendors page.
                        </p>
                        {addPriceForm}
                      </>
                    )}

                    {pane === "changes" &&
                      (changeLog.length === 0 ? (
                        <p className="py-6 text-center text-sm text-fg-faint">
                          No price changes recorded for this item yet.
                        </p>
                      ) : (
                        <>
                          <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
                            Every recorded change, kept forever, with where it came from (
                            <b className="text-fg-soft">manual</b> edit, a received{" "}
                            <b className="text-fg-soft">PO</b>, or a scanned{" "}
                            <b className="text-fg-soft">invoice</b>). Old prices are never lost.
                          </p>
                          <ul className="space-y-1.5">
                            {changeLog.map((c, i) => (
                              <li
                                key={i}
                                className="mise-well flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm"
                              >
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
                        </>
                      ))}
                  </div>
                </Card>
              )}
            </div>
          </div>

        </>
      )}
    </Workbench>
  );
}
