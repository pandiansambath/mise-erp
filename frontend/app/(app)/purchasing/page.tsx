"use client";

import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  downloadFile,
  type Indent,
  type Item,
  type POSummary,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

type Line = { item_id: string; qty: string };

const indentTone: Record<string, "slate" | "amber" | "green" | "red"> = {
  PENDING: "amber",
  APPROVED: "green",
  ORDERED: "slate",
  REJECTED: "red",
};
const poTone: Record<string, "slate" | "amber" | "green"> = {
  DRAFT: "amber",
  SENT: "amber",
  RECEIVED: "green",
};

export default function PurchasingPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "indent:write");
  const canApprove = can(user?.role, "indent:approve");

  const [items, setItems] = useState<Item[]>([]);
  const [indents, setIndents] = useState<Indent[]>([]);
  const [pos, setPos] = useState<POSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<Line[]>([{ item_id: "", qty: "" }]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [ind, p] = await Promise.all([
      api.get<Indent[]>("/purchasing/indents"),
      api.get<POSummary[]>("/purchasing/purchase-orders"),
    ]);
    setIndents(ind);
    setPos(p);
  }

  useEffect(() => {
    Promise.all([
      api.get<Item[]>("/inventory/items").then((i) => {
        setItems(i);
        const fo = i.find((x) => (x.vendor_count ?? 0) > 0);
        if (fo) setLines([{ item_id: fo.id, qty: "" }]);
      }),
      load(),
    ]).finally(() => setLoading(false));
  }, []);

  // Live updates: when anyone in this hotel submits/approves/receives, refresh.
  useLiveRefresh("purchasing", load);

  async function submitIndent(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload = {
      items: lines
        .filter((l) => l.item_id && l.qty)
        .map((l) => ({ item_id: l.item_id, required_qty: l.qty })),
    };
    if (payload.items.length === 0) return;
    try {
      await api.post("/purchasing/indents", payload);
      setLines([{ item_id: items.find((x) => (x.vendor_count ?? 0) > 0)?.id ?? "", qty: "" }]);
      await load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not create indent");
    }
  }

  function resetIndent() {
    setLines([{ item_id: items.find((x) => (x.vendor_count ?? 0) > 0)?.id ?? "", qty: "" }]);
    setMsg(null);
  }

  async function generate(id: string) {
    const ok = await confirm({
      title: "Approve & generate purchase orders?",
      message: "This approves the indent and creates one purchase order per cheapest vendor.",
      confirmText: "Approve & generate",
    });
    if (!ok) return;
    setMsg(null);
    try {
      const res = await api.post<{ skipped_items: string[] }>(
        `/purchasing/indents/${id}/generate-pos`
      );
      if (res.skipped_items?.length) {
        setMsg(`No chosen supplier for: ${res.skipped_items.join(", ")} — pick one on Price Comparison, then generate POs.`);
      }
      await load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not generate POs");
    }
  }

  async function receive(poId: string) {
    const ok = await confirm({
      title: "Receive this purchase order?",
      message: "Marks all items as received and adds them to stock (updates average cost).",
      confirmText: "Receive into stock",
    });
    if (!ok) return;
    setMsg(null);
    try {
      await api.post(`/purchasing/purchase-orders/${poId}/receive`);
      await load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not receive PO");
    }
  }

  if (loading) return <Spinner />;

  // Only items a vendor actually prices can be ordered — keeps the chain honest.
  const orderable = items.filter((it) => (it.vendor_count ?? 0) > 0);

  return (
    <div>
      <PageHeader title="Purchasing" subtitle="Kitchen indents → vendor-wise purchase orders." />
      {msg && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{msg}</p>}

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-1 text-sm font-medium text-slate-700">New kitchen indent</p>
          <p className="mb-3 text-xs text-slate-400">
            Only items a vendor supplies appear here. New item? Add it in <b>Inventory</b>, then set its price on the <b>Vendors</b> page.
          </p>
          {orderable.length === 0 ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              No orderable items yet — add a vendor price for at least one item on the <b>Vendors</b> page.
            </p>
          ) : (
          <form onSubmit={submitIndent} className="space-y-2">
            {lines.map((l, idx) => (
              <div key={idx} className="flex gap-2">
                <select
                  value={l.item_id}
                  onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, item_id: e.target.value } : x)))}
                  className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {orderable.map((it) => (
                    <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>
                  ))}
                </select>
                <input
                  value={l.qty}
                  onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                  inputMode="decimal"
                  placeholder="qty"
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== idx))} className="rounded-lg border border-slate-200 px-2 text-slate-400 hover:bg-slate-50">×</button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setLines([...lines, { item_id: orderable[0]?.id ?? "", qty: "" }])} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                + Add item
              </button>
              <button type="submit" className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
                Submit indent
              </button>
              <button type="button" onClick={resetIndent} className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </form>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-0">
          <h3 className="px-5 pt-4 font-semibold text-slate-900">Indents</h3>
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">Items</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {indents.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400">No indents yet.</td></tr>
                ) : indents.map((ind) => (
                  <tr key={ind.id} className="border-b border-slate-100">
                    <td className="px-5 py-2 text-slate-500">{ind.date}</td>
                    <td className="px-5 py-2 text-slate-700">{ind.items.length}</td>
                    <td className="px-5 py-2"><Badge tone={indentTone[ind.status] ?? "slate"}>{ind.status}</Badge></td>
                    <td className="px-5 py-2 text-right">
                      {canApprove && ind.status !== "ORDERED" && (
                        <button onClick={() => generate(ind.id)} className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">
                          Generate POs
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0">
          <h3 className="px-5 pt-4 font-semibold text-slate-900">Purchase orders</h3>
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="px-5 py-2 font-medium">PO</th>
                  <th className="px-5 py-2 text-right font-medium">Total</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pos.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400">No purchase orders yet.</td></tr>
                ) : pos.map((po) => (
                  <tr key={po.id} className="border-b border-slate-100">
                    <td className="px-5 py-2 font-medium text-slate-800">{po.po_number}</td>
                    <td className="px-5 py-2 text-right text-slate-700">{format(po.total_amount)}</td>
                    <td className="px-5 py-2"><Badge tone={poTone[po.status] ?? "slate"}>{po.status}</Badge></td>
                    <td className="px-5 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => downloadFile(`/purchasing/purchase-orders/${po.id}/pdf`, `${po.po_number}.pdf`)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">PDF</button>
                        {canApprove && po.status !== "RECEIVED" && (
                          <button onClick={() => receive(po.id)} className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Receive</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
