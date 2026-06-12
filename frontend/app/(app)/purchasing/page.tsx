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
import { ItemPicker, type PickedLine } from "@/components/ItemPicker";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

type Line = PickedLine;

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
  const [lines, setLines] = useState<Line[]>([]);
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
      api.get<Item[]>("/inventory/items").then(setItems),
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
    if (payload.items.length === 0) {
      setMsg("Pick at least one item and enter how much you need.");
      return;
    }
    try {
      await api.post("/purchasing/indents", payload);
      setLines([]);
      await load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not create indent");
    }
  }

  function resetIndent() {
    setLines([]);
    setMsg(null);
  }

  async function generate(id: string) {
    const ok = await confirm({
      title: "Approve & generate purchase orders?",
      message: "This approves the indent and creates one purchase order per chosen supplier.",
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
      {msg && <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{msg}</p>}

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-1 text-sm font-medium text-fg-soft">New kitchen indent</p>
          <p className="mb-3 text-xs text-fg-faint">
            Only items a vendor supplies appear here. New item? Add it in <b>Inventory</b>, then set its price on the <b>Vendors</b> page.
          </p>
          {orderable.length === 0 ? (
            <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              No orderable items yet — add a vendor price for at least one item on the <b>Vendors</b> page.
            </p>
          ) : (
          <form onSubmit={submitIndent} className="space-y-3">
            <ItemPicker items={orderable} lines={lines} onChange={setLines} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
                Submit indent
              </button>
              <button type="button" onClick={resetIndent} className="rounded-lg border border-line-2 px-4 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2">
                Clear
              </button>
            </div>
          </form>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-0">
          <h3 className="px-5 pt-4 font-semibold text-fg">Indents</h3>
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs uppercase text-fg-faint">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">Items</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {indents.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-fg-faint">No indents yet.</td></tr>
                ) : indents.map((ind) => (
                  <tr key={ind.id} className="border-b border-line">
                    <td className="px-5 py-2 text-fg-faint">{ind.date}</td>
                    <td className="px-5 py-2 text-fg-soft">{ind.items.length}</td>
                    <td className="px-5 py-2"><Badge tone={indentTone[ind.status] ?? "slate"}>{ind.status}</Badge></td>
                    <td className="px-5 py-2 text-right">
                      {canApprove && ind.status !== "ORDERED" && (
                        <button onClick={() => generate(ind.id)} className="rounded-md border border-brand-400/30 bg-brand-400/10 px-2 py-1 text-xs font-medium text-brand-300">
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
          <h3 className="px-5 pt-4 font-semibold text-fg">Purchase orders</h3>
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs uppercase text-fg-faint">
                  <th className="px-5 py-2 font-medium">PO</th>
                  <th className="px-5 py-2 text-right font-medium">Total</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {pos.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-fg-faint">No purchase orders yet.</td></tr>
                ) : pos.map((po) => (
                  <tr key={po.id} className="border-b border-line">
                    <td className="px-5 py-2 font-medium text-fg">{po.po_number}</td>
                    <td className="px-5 py-2 text-right text-fg-soft">{format(po.total_amount)}</td>
                    <td className="px-5 py-2"><Badge tone={poTone[po.status] ?? "slate"}>{po.status}</Badge></td>
                    <td className="px-5 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => downloadFile(`/purchasing/purchase-orders/${po.id}/pdf`, `${po.po_number}.pdf`)} className="rounded-md border border-line px-2 py-1 text-xs text-brand-300 hover:bg-brand-400/10">PDF</button>
                        {canApprove && po.status !== "RECEIVED" && (
                          <button onClick={() => receive(po.id)} className="rounded-md border border-line-2 px-2 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2">Receive</button>
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
