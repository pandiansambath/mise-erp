"use client";

import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  type Item,
  type WasteListResponse,
  type WasteRow,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { fmtQty, ItemPickerSingle, QtyInput } from "@/components/ItemPicker";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

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

  return (
    <div>
      <PageHeader
        title="Waste log"
        subtitle="Spoilage, spillage, over-prep — logging it removes the stock and shows the £ leak on Money."
      />
      {msg && <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{msg}</p>}

      {canWrite && (
        <Card className="mb-6">
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
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="mt-1 rounded-lg border border-line-2 bg-paper px-3 py-2 text-sm text-fg-soft outline-none focus:border-brand-500"
                >
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? "Logging…" : "Log waste"}
              </button>
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

      <Card className="p-0">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-semibold text-fg">Recent waste</h3>
          {data && (
            <span className="text-sm text-fg-soft">
              {format(data.total_value)} · {data.entry_count} entr{data.entry_count === 1 ? "y" : "ies"}
            </span>
          )}
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
