"use client";

import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Item } from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";
import { fmtQty, QtyInput } from "@/components/ItemPicker";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { spotlight, useDeepLink } from "@/components/fx";
import ChefMascot from "@/components/auth/ChefMascot";

const today = () => new Date().toISOString().slice(0, 10);

export default function StockTakePage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "inventory:write");

  const [items, setItems] = useState<Item[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ n: number; loss: number; gain: number } | null>(null);

  // ⌘K "Start a stock take" (?focus=1) → spotlight the count sheet
  useDeepLink({ focus: () => spotlight("stock-count") }, !loading);

  function load() {
    return api.get<Item[]>("/inventory/items").then((i) => setItems(i.filter((x) => x.is_active)));
  }
  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const query = q.trim().toLowerCase();
  const visible = items.filter((i) => !query || i.name.toLowerCase().includes(query));

  // A line is "counted" only when the user typed something. Variance = counted − system.
  const lines = useMemo(() => {
    return items
      .filter((i) => counts[i.id] !== undefined && counts[i.id] !== "")
      .map((i) => {
        const counted = parseFloat(counts[i.id]) || 0;
        const system = parseFloat(i.current_stock) || 0;
        const delta = Math.round((counted - system) * 1000) / 1000;
        const value = Math.round(delta * (parseFloat(i.average_cost) || 0) * 100) / 100;
        return { item: i, counted, system, delta, value };
      });
  }, [items, counts]);

  const totalVariance = lines.reduce((s, l) => s + l.value, 0);
  const toApply = lines.filter((l) => l.delta !== 0);

  async function apply() {
    if (toApply.length === 0) {
      setMsg("No differences to apply — counts match the system.");
      return;
    }
    const ok = await confirm({
      title: `Apply ${toApply.length} stock adjustment${toApply.length === 1 ? "" : "s"}?`,
      message:
        "This corrects the system stock to your physical count (logged as adjustments). " +
        `Net change to stock value: ${format(String(totalVariance))}.`,
      confirmText: "Apply counts",
    });
    if (!ok) return;
    setSaving(true);
    setMsg(null);
    try {
      for (const l of toApply) {
        await api.post(`/inventory/items/${l.item.id}/movements`, {
          movement_type: "ADJUSTMENT",
          quantity: String(l.delta),
          notes: `Stock-take ${today()}`,
        });
      }
      const loss = toApply.reduce((t, l) => t + Math.min(0, l.delta * (parseFloat(l.item.average_cost) || 0)), 0);
      const gain = toApply.reduce((t, l) => t + Math.max(0, l.delta * (parseFloat(l.item.average_cost) || 0)), 0);
      setApplied({ n: toApply.length, loss: Math.abs(loss), gain });
      setCounts({});
      await load();
      setMsg(null);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not apply counts");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Stock-take"
        subtitle="Count what's physically on the shelf; we show the variance vs the system (shrinkage in £) and reconcile."
      />

      {msg && <p className="mb-4 rounded-lg bg-brand-400/10 px-3 py-2 text-sm text-brand-300">{msg}</p>}

      {applied && (
        <Card className="mise-pop-lg mise-feel mb-4 border-brand-400/30">
          <div className="flex flex-wrap items-center gap-4">
            <ChefMascot mood="serve" className="w-16 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-brand-300">Stock reconciled — {applied.n} adjustment{applied.n === 1 ? "" : "s"} applied</p>
              <p className="text-xs text-fg-faint">the books now match the shelf</p>
            </div>
            <div className="flex gap-3 text-sm">
              {applied.loss > 0 && (
                <span className="mise-well rounded-lg px-3 py-1.5 text-rose-300">shrinkage −{format(String(applied.loss.toFixed(2)))}</span>
              )}
              {applied.gain > 0 && (
                <span className="mise-well rounded-lg px-3 py-1.5 text-brand-300">found +{format(String(applied.gain.toFixed(2)))}</span>
              )}
              <button type="button" onClick={() => setApplied(null)} className="mise-press text-fg-faint hover:text-fg" aria-label="Dismiss">✕</button>
            </div>
          </div>
        </Card>
      )}

      {/* Sticky summary */}
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-fg-soft">
            {lines.length} counted · {toApply.length} differ from system
          </p>
          <p className="text-xs text-fg-faint">Enter a count next to an item to include it.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-fg-faint">Net variance</p>
            <p className={`text-xl font-semibold ${totalVariance < 0 ? "text-rose-400" : totalVariance > 0 ? "text-brand-400" : "text-fg"}`}>
              {format(String(totalVariance))}
            </p>
          </div>
          {canWrite && (
            <button
              onClick={apply}
              disabled={saving || toApply.length === 0}
              className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? "Applying…" : "Apply counts"}
            </button>
          )}
        </div>
      </Card>

      <div className="relative mb-3">
        <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint">🔍</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search items…"
          className="mise-well w-full rounded-xl py-2.5 pl-9 pr-3 text-sm text-fg outline-none"
        />
      </div>

      <Card className="p-0" id="stock-count">
        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-paper">
              <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 font-medium">System</th>
                <th className="px-4 py-2 font-medium">Counted</th>
                <th className="px-4 py-2 text-right font-medium">Variance</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => {
                const has = counts[i.id] !== undefined && counts[i.id] !== "";
                const counted = parseFloat(counts[i.id]) || 0;
                const delta = has ? Math.round((counted - (parseFloat(i.current_stock) || 0)) * 1000) / 1000 : 0;
                const val = has ? delta * (parseFloat(i.average_cost) || 0) : 0;
                return (
                  <tr key={i.id} className="border-b border-line">
                    <td className="px-4 py-2">
                      <span className="font-medium text-fg">{i.name}</span>
                      {i.category && <span className="ml-2 text-xs text-fg-faint">{i.category}</span>}
                    </td>
                    <td className="px-4 py-2 text-fg-soft">{fmtQty(i.current_stock, i.unit)}</td>
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label={`One less ${i.unit}`}
                          onClick={() => setCounts((c) => {
                            const base = c[i.id] !== undefined && c[i.id] !== "" ? parseFloat(c[i.id]) || 0 : parseFloat(i.current_stock) || 0;
                            return { ...c, [i.id]: String(Math.max(0, Math.round((base - 1) * 1000) / 1000)) };
                          })}
                          className="mise-raised mise-press grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-bold text-fg-soft"
                        >
                          −
                        </button>
                        <QtyInput
                          unit={i.unit}
                          value={counts[i.id] ?? ""}
                          onChange={(v) => setCounts((c) => ({ ...c, [i.id]: v }))}
                          label={`Counted ${i.name}`}
                        />
                        <button
                          type="button"
                          aria-label={`One more ${i.unit}`}
                          onClick={() => setCounts((c) => {
                            const base = c[i.id] !== undefined && c[i.id] !== "" ? parseFloat(c[i.id]) || 0 : parseFloat(i.current_stock) || 0;
                            return { ...c, [i.id]: String(Math.round((base + 1) * 1000) / 1000) };
                          })}
                          className="mise-raised mise-press grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-bold text-brand-300"
                        >
                          +
                        </button>
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {has ? (
                        <span className={delta < 0 ? "text-rose-400" : delta > 0 ? "text-brand-400" : "text-fg-faint"}>
                          {delta > 0 ? "+" : ""}{delta} {i.unit} {delta !== 0 && `(${format(String(Math.round(val * 100) / 100))})`}
                        </span>
                      ) : (
                        <span className="text-fg-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
