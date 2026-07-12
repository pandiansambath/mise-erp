"use client";

import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  downloadFile,
  type Item,
  type WasteListResponse,
  type WasteRow,
} from "@/lib/api";
import { Badge, Button, Card, PageHeader, Spinner } from "@/components/ui";
import { Bars, Donut, Sparkline } from "@/components/charts";
import { Select } from "@/components/Select";
import { fmtQty, ItemPickerSingle, QtyInput } from "@/components/ItemPicker";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { spotlight, useDeepLink } from "@/components/fx";

const REASONS = [
  "Spoiled / expired",
  "Spillage / breakage",
  "Over-preparation",
  "Staff meal",
  "Customer return",
  "Other",
];

export default function WastePage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const canWrite = can(user?.role, "inventory:write");

  const [items, setItems] = useState<Item[]>([]);
  const [data, setData] = useState<WasteListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ⌘K "Log waste" (?new=1) → spotlight the form
  useDeepLink({ new: () => spotlight("waste-form") }, !loading);

  async function loadWaste() {
    setData(await api.get<WasteListResponse>("/inventory/waste"));
  }

  useEffect(() => {
    Promise.all([api.get<Item[]>("/inventory/items").then(setItems), loadWaste()])
      .catch(() => setMsg("Could not load waste data — refresh to retry."))
      .finally(() => setLoading(false));
  }, []);

  const chosen = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!itemId || !(parseFloat(qty) > 0)) {
      setMsg("Pick an item and enter how much was wasted.");
      return;
    }
    setBusy(true);
    try {
      await api.post<WasteRow>("/inventory/waste", { item_id: itemId, quantity: qty, reason });
      setItemId("");
      setQty("");
      setReason(REASONS[0]);
      await loadWaste();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not log waste");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;

  // Where the waste money goes — by reason (donut) and by item (bars)
  const REASON_COLORS = ["#f43f5e", "#f59e0b", "#38bdf8", "#a78bfa", "#10b981", "#94a3b8"];
  const byReason = (data?.rows ?? []).reduce<Record<string, number>>((acc, w) => {
    const k = w.reason || "Other";
    acc[k] = (acc[k] ?? 0) + (parseFloat(w.value) || 0);
    return acc;
  }, {});
  const reasonSegs = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({ label, value, color: REASON_COLORS[i % REASON_COLORS.length] }));
  const byItem = (data?.rows ?? []).reduce<Record<string, number>>((acc, w) => {
    acc[w.item_name] = (acc[w.item_name] ?? 0) + (parseFloat(w.value) || 0);
    return acc;
  }, {});
  const topItems = Object.entries(byItem)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value]) => ({ label, value, color: "#f43f5e" }));

  // Waste £ per day, last 14 days — is the leak growing or shrinking?
  const trend = (() => {
    const byDay = new Map<string, number>();
    for (const w of data?.rows ?? []) {
      const d = w.created_at.slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + (parseFloat(w.value) || 0));
    }
    const days: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(byDay.get(d.toISOString().slice(0, 10)) ?? 0);
    }
    return days;
  })();

  return (
    <div>
      <PageHeader
        title="Waste log"
        subtitle="Spoilage, spillage, over-prep — logging it removes the stock and shows the £ leak on Money."
      />
      {msg && <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{msg}</p>}

      {canWrite && (
        <Card className="mise-feel mb-6" id="waste-form">
          <p className="mb-3 text-sm font-medium text-fg-soft">Log waste</p>
          <form onSubmit={submit} className="space-y-4">
            <ItemPickerSingle items={items} value={itemId} onChange={setItemId} />
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-fg-faint">Quantity wasted</span>
                <span className="mt-1 flex items-center gap-2">
                  <QtyInput
                    unit={chosen?.unit ?? ""}
                    value={qty}
                    onChange={setQty}
                    label="Quantity wasted"
                    plainClassName="w-28 rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm text-fg outline-none focus:border-brand-500"
                  />
                  {!chosen || !["kg", "litre", "l"].includes(chosen.unit.toLowerCase()) ? (
                    <span className="text-sm text-fg-faint">{chosen?.unit ?? ""}</span>
                  ) : null}
                </span>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-fg-faint">Reason</span>
                <Select
                  value={reason}
                  onChange={setReason}
                  className="mt-1"
                  options={REASONS.map((r) => ({ value: r, label: r }))}
                />
              </label>
              <Button type="submit" variant="primary" busy={busy} busyLabel="Logging…">
                Log waste
              </Button>
            </div>
            {chosen && (
              <p className="text-xs text-fg-faint">
                {chosen.name}: {chosen.current_stock} {chosen.unit} in stock
                {parseFloat(chosen.average_cost) > 0 && ` · avg cost ${format(chosen.average_cost)}/${chosen.unit}`}
              </p>
            )}
          </form>
        </Card>
      )}

      {reasonSegs.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="mise-feel">
            <h3 className="font-semibold text-fg">Why it&apos;s binned</h3>
            <p className="text-xs text-fg-faint">value of waste by reason — attack the biggest slice first</p>
            <div className="mt-4">
              <Donut
                centerLabel="wasted"
                centerValue={format(data?.total_value ?? "0")}
                formatValue={(v) => format(String(v))}
                segments={reasonSegs}
              />
            </div>
          </Card>
          <Card className="mise-feel">
            <h3 className="font-semibold text-fg">Most-wasted items</h3>
            <p className="text-xs text-fg-faint">where the money actually leaks</p>
            <div className="mise-well mt-4 rounded-xl p-3">
              <Bars items={topItems} formatValue={(v) => format(String(v))} />
            </div>
            {trend.some((v) => v > 0) && (
              <div className="mise-well mt-3 rounded-xl p-3">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                  Waste per day — last 14 days
                </p>
                <Sparkline data={trend} color="#f43f5e" height={40} className="w-full" />
              </div>
            )}
          </Card>
        </div>
      )}

      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h3 className="font-semibold text-fg">Recent waste</h3>
          <div className="flex items-center gap-3">
            {data && (
              <span className="text-sm text-fg-soft">
                {format(data.total_value)} · {data.entry_count} entr{data.entry_count === 1 ? "y" : "ies"}
              </span>
            )}
            {data && data.rows.length > 0 && (
              <div className="flex gap-2">
                <Button size="sm" variant="soft" onClick={() => downloadFile("/inventory/waste.xlsx", "mise-waste-log.xlsx")} title="Download waste log (Excel)">
                  ⬇ Excel
                </Button>
                <Button size="sm" variant="ghost" onClick={() => downloadFile("/inventory/waste.csv", "mise-waste-log.csv")} title="Download waste log (CSV)">
                  CSV
                </Button>
              </div>
            )}
          </div>
        </div>
        {!data || data.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-fg-faint">
            No waste logged yet — that&apos;s the goal. 🎯
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{w.item_name}</span>
                  <span className="block text-xs text-fg-faint">
                    {fmtQty(w.quantity, w.unit)}
                    {w.reason ? ` · ${w.reason}` : ""} · {w.created_at.slice(0, 10)}
                  </span>
                </span>
                <Badge tone="red">−{format(w.value)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
