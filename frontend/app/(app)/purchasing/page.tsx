"use client";

import { useEffect, useMemo, useState } from "react";
import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type Indent,
  type Item,
  type ItemSuppliers,
  type POOut,
  type POSummary,
  type ReorderSuggestion,
  type SupplierOption,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { Select } from "@/components/Select";
import { ItemPicker, type PickedLine } from "@/components/ItemPicker";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { spotlight, useDeepLink } from "@/components/fx";

type Line = PickedLine;

type ConsolidatedItem = {
  item_name: string; ordered_qty: string; received_qty: string;
  unit_price: string; line_total: string; po_number: string;
};
type ConsolidatedVendor = {
  vendor_id: string; vendor_name: string; po_id: string; po_number: string;
  status: string; po_numbers: string[]; items: ConsolidatedItem[]; subtotal: string;
};
type Consolidated = {
  vendors: ConsolidatedVendor[]; grand_total: string;
  po_count: number; vendor_count: number; item_count: number; currency: string;
};

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
  // item_id -> every vendor pricing it (cheapest first), for the line picker
  const [suppliers, setSuppliers] = useState<Record<string, SupplierOption[]>>({});
  // item_id -> the vendor PICKED for this order ("" / missing = automatic)
  const [vendorPick, setVendorPick] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  // ⌘K "Start a purchase order" (?new=1) → spotlight the indent composer
  useDeepLink({ new: () => spotlight("indent-form") }, !loading);
  // Tap-to-expand: which indent / PO row is open, plus a cache of fetched PO lines.
  const [openIndent, setOpenIndent] = useState<string | null>(null);
  const [openPo, setOpenPo] = useState<string | null>(null);
  const [poDetail, setPoDetail] = useState<Record<string, POOut>>({});
  const [poBusy, setPoBusy] = useState<string | null>(null);
  // Per-indent consolidated view (its POs across vendors), lazy-loaded on expand.
  const [indentConsol, setIndentConsol] = useState<Record<string, Consolidated>>({});

  async function load() {
    const [ind, p] = await Promise.all([
      api.get<Indent[]>("/purchasing/indents"),
      api.get<POSummary[]>("/purchasing/purchase-orders"),
    ]);
    setIndents(ind);
    setPos(p);
    setIndentConsol({}); // POs may have changed → drop cached consolidations
  }

  async function toggleIndent(ind: Indent) {
    const opening = openIndent !== ind.id;
    setOpenIndent(opening ? ind.id : null);
    // When opening an ORDERED indent, fetch its consolidated POs once.
    if (opening && ind.status === "ORDERED" && !indentConsol[ind.id]) {
      try {
        const c = await api.get<Consolidated>(`/purchasing/indents/${ind.id}/consolidated`);
        setIndentConsol((prev) => ({ ...prev, [ind.id]: c }));
      } catch {
        /* ignore — the PDFs still work directly */
      }
    }
  }

  useEffect(() => {
    Promise.all([
      api.get<Item[]>("/inventory/items").then(setItems),
      api
        .get<ItemSuppliers[]>("/purchasing/item-suppliers")
        .then((rows) => setSuppliers(Object.fromEntries(rows.map((r) => [r.item_id, r.vendors]))))
        .catch(() => {}),
      load(),
    ])
      .catch(() => setMsg("Could not load purchasing data — refresh to retry."))
      .finally(() => setLoading(false));
  }, []);

  // Deep link: /purchasing?item=<id>[&vendor=<id>] pre-fills the order (used
  // by Inventory's "Order" buttons and the dashboard low-stock list).
  useEffect(() => {
    if (loading) return;
    const params = new URLSearchParams(window.location.search);
    const itemId = params.get("item");
    if (!itemId || !items.some((i) => i.id === itemId)) return;
    setLines((prev) => (prev.some((l) => l.item_id === itemId) ? prev : [...prev, { item_id: itemId, qty: "" }]));
    const vendorId = params.get("vendor");
    if (vendorId) setVendorPick((prev) => ({ ...prev, [itemId]: vendorId }));
    window.history.replaceState(null, "", window.location.pathname); // one-shot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Live updates: when anyone in this hotel submits/approves/receives, refresh.
  useLiveRefresh("purchasing", load);

  async function submitIndent(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const payload = {
      items: lines
        .filter((l) => l.item_id && l.qty)
        .map((l) => ({
          item_id: l.item_id,
          required_qty: l.qty,
          vendor_id: vendorPick[l.item_id] || undefined,
        })),
    };
    if (payload.items.length === 0) {
      setMsg("Pick at least one item and enter how much you need.");
      return;
    }
    try {
      await api.post("/purchasing/indents", payload);
      setLines([]);
      setVendorPick({});
      await load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not create indent");
    }
  }

  function resetIndent() {
    setLines([]);
    setVendorPick({});
    setMsg(null);
  }

  /** Per-line supplier picker: Auto (★chosen / cheapest) or any vendor that
      sells this item — the chef stays in control, order by order. */
  function supplierPicker(line: Line, item: Item) {
    const options = suppliers[item.id] ?? [];
    if (options.length === 0) {
      return <span className="text-xs text-amber-300">no supplier sells this yet</span>;
    }
    const auto = options.find((o) => o.is_preferred) ?? options[0]; // cheapest first
    const autoLabel = `Auto — ${auto.is_preferred ? "★ " : "cheapest: "}${auto.vendor_name} (${format(auto.price_per_unit)})`;
    return (
      <label className="flex flex-wrap items-center gap-1.5 text-xs text-fg-faint">
        Supplier
        <Select
          value={vendorPick[item.id] ?? ""}
          onChange={(v) => setVendorPick({ ...vendorPick, [item.id]: v })}
          className="w-64"
          options={[
            { value: "", label: autoLabel },
            ...options.map((o) => ({
              value: o.vendor_id,
              label: `${o.vendor_name} · ${format(o.price_per_unit)}/${item.unit}${o.is_preferred ? " ★" : ""}`,
            })),
          ]}
        />
      </label>
    );
  }

  // Open a PO row and lazy-load its line items the first time (cached after).
  async function togglePo(id: string) {
    if (openPo === id) {
      setOpenPo(null);
      return;
    }
    setOpenPo(id);
    if (!poDetail[id]) {
      setPoBusy(id);
      try {
        const d = await api.get<POOut>(`/purchasing/purchase-orders/${id}`);
        setPoDetail((p) => ({ ...p, [id]: d }));
      } catch {
        /* keep the row usable — actions below still work without the line list */
      } finally {
        setPoBusy(null);
      }
    }
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
        setMsg(`No supplier sells: ${res.skipped_items.join(", ")} — add a vendor price on the Vendors page, then generate POs again.`);
      }
      await load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not generate POs");
    }
  }

  // Receive flow: edit the actual qty received per line (for a short/over delivery)
  // + a reason, so ordered-vs-received stays on record (both PDFs downloadable).
  const [recvPo, setRecvPo] = useState<POOut | null>(null);
  const [recvLines, setRecvLines] = useState<Record<string, string>>({});
  const [recvPrices, setRecvPrices] = useState<Record<string, string>>({}); // po_item_id → new unit price (from bill)
  const [recvUpdatePrices, setRecvUpdatePrices] = useState(false);
  const [recvNote, setRecvNote] = useState("");
  const [recvBusy, setRecvBusy] = useState(false);
  const [recvScanBusy, setRecvScanBusy] = useState(false);
  const [recvScanMsg, setRecvScanMsg] = useState<string | null>(null);

  function openReceive(po: POOut) {
    setRecvLines(Object.fromEntries(po.items.map((it) => [it.po_item_id, it.ordered_qty])));
    setRecvPrices({});
    setRecvUpdatePrices(false);
    setRecvScanMsg(null);
    setRecvNote("");
    setRecvPo(po);
  }

  async function scanBill(file: File) {
    if (!recvPo) return;
    setRecvScanBusy(true);
    setRecvScanMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await postForm<{
        vendor: string | null; total: string | null;
        lines: { po_item_id: string; received_qty: string; unit_price: string }[];
        unmatched: string[];
      }>(`/purchasing/purchase-orders/${recvPo.id}/scan-bill`, fd);
      const nextLines: Record<string, string> = {};
      const nextPrices: Record<string, string> = {};
      for (const l of res.lines) {
        nextLines[l.po_item_id] = l.received_qty;
        nextPrices[l.po_item_id] = l.unit_price;
      }
      setRecvLines((p) => ({ ...p, ...nextLines }));
      setRecvPrices(nextPrices);
      setRecvUpdatePrices(true);
      setRecvScanMsg(
        `✓ Read ${res.lines.length} line${res.lines.length === 1 ? "" : "s"}${res.vendor ? ` from ${res.vendor}` : ""}. Review qty + prices, then Receive.` +
          (res.unmatched.length ? ` (Couldn't match: ${res.unmatched.slice(0, 4).join(", ")})` : ""),
      );
    } catch (err) {
      setRecvScanMsg(err instanceof ApiError ? err.message : "Could not read the bill — try a clearer photo or PDF.");
    } finally {
      setRecvScanBusy(false);
    }
  }

  const recvChanged = (po: POOut) =>
    po.items.some((it) => (recvLines[it.po_item_id] ?? it.ordered_qty) !== it.ordered_qty);

  async function submitReceive() {
    if (!recvPo) return;
    setRecvBusy(true);
    setMsg(null);
    try {
      await api.post(`/purchasing/purchase-orders/${recvPo.id}/receive`, {
        lines: recvPo.items.map((it) => ({
          po_item_id: it.po_item_id,
          received_qty: recvLines[it.po_item_id] || "0",
          unit_price: recvPrices[it.po_item_id] || null,
        })),
        note: recvNote.trim() || null,
        update_prices: recvUpdatePrices,
      });
      const poId = recvPo.id;
      setRecvPo(null);
      setPoDetail((p) => {
        const next = { ...p };
        delete next[poId]; // drop stale copy so re-open shows received qty/status
        return next;
      });
      await load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not receive PO");
    } finally {
      setRecvBusy(false);
    }
  }

  async function deleteIndent(id: string) {
    const ok = await confirm({
      title: "Delete this indent?",
      message:
        "Removes the indent and any draft purchase orders it created. (Blocked if a PO from it was already received.)",
      confirmText: "Delete indent",
      tone: "danger",
    });
    if (!ok) return;
    setMsg(null);
    try {
      await api.delete(`/purchasing/indents/${id}`);
      if (openIndent === id) setOpenIndent(null);
      await load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not delete indent");
    }
  }

  async function revertPo(po: POSummary) {
    const ok = await confirm({
      title: `Revert ${po.po_number} to indent?`,
      message:
        "Discards this purchase order (and any sibling POs from the same indent) and re-opens the indent so you can edit or regenerate it. Stock isn't affected.",
      confirmText: "Revert to indent",
    });
    if (!ok) return;
    setMsg(null);
    try {
      await api.post(`/purchasing/purchase-orders/${po.id}/revert`);
      setPoDetail((p) => {
        const next = { ...p };
        delete next[po.id];
        return next;
      });
      await load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not revert purchase order");
    }
  }

  // One-click: pull every orderable below-min item, topped up to par, into the
  // indent form for review (non-destructive — keeps lines you've already added).
  async function orderAllLow() {
    setMsg(null);
    try {
      const sug = await api.get<ReorderSuggestion[]>("/purchasing/reorder-suggestions");
      if (sug.length === 0) {
        setMsg("Nothing to reorder — no orderable item is below its minimum. 👍");
        return;
      }
      setLines((prev) => {
        const map = new Map(prev.map((l) => [l.item_id, l]));
        for (const s of sug) map.set(s.item_id, { item_id: s.item_id, qty: s.suggested_qty });
        return [...map.values()];
      });
      setMsg(`Loaded ${sug.length} low-stock item${sug.length === 1 ? "" : "s"} (topped up to par) — review the quantities and submit the indent.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setMsg("Could not load reorder suggestions.");
    }
  }

  // Group POs by the purchase run (indent) they came from, so each run offers a
  // consolidated PDF alongside its per-vendor orders. (Hook must run before any
  // early return.) Keeps the panel's newest-first order (first appearance wins).
  const poGroups = useMemo(() => {
    const byIndent = new Map<string, POSummary[]>();
    const order: string[] = [];
    for (const po of pos) {
      const key = po.indent_id ?? "__none__";
      if (!byIndent.has(key)) { byIndent.set(key, []); order.push(key); }
      byIndent.get(key)!.push(po);
    }
    return order.map((key) => {
      const groupPos = byIndent.get(key)!;
      const total = groupPos.reduce((s, p) => s + parseFloat(p.total_amount || "0"), 0);
      const indent = key === "__none__" ? null : indents.find((i) => i.id === key) ?? null;
      const vendorCount = new Set(groupPos.map((p) => p.vendor_id)).size;
      return { key, indentId: key === "__none__" ? null : key, pos: groupPos, total, indent, vendorCount };
    });
  }, [pos, indents]);

  if (loading) return <Spinner />;

  // Only items a vendor actually prices can be ordered — keeps the chain honest.
  const orderable = items.filter((it) => (it.vendor_count ?? 0) > 0);

  return (
    <div>
      <PageHeader title="Purchasing" subtitle="Kitchen indents → vendor-wise purchase orders." />
      {msg && <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{msg}</p>}

      {canWrite && (
        <Card className="mb-6" id="indent-form">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-fg-soft">New kitchen indent</p>
            <button
              type="button"
              onClick={orderAllLow}
              title="Pull every low-stock item (topped up to par) into the indent"
              className="mise-press rounded-lg border border-brand-400/30 bg-brand-400/10 px-3 py-1.5 text-sm font-medium text-brand-300 transition hover:bg-brand-400/20"
            >
              🛒 Order all low-stock
            </button>
          </div>
          <p className="mb-3 text-xs text-fg-faint">
            Only items a vendor supplies appear here. New item? Add it in <b>Inventory</b>, then set its price on the <b>Vendors</b> page.
          </p>
          {orderable.length === 0 ? (
            <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              No orderable items yet — add a vendor price for at least one item on the <b>Vendors</b> page.
            </p>
          ) : (
          <form onSubmit={submitIndent} className="space-y-3">
            <ItemPicker items={orderable} lines={lines} onChange={setLines} lineExtra={supplierPicker} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="mise-press rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-700">
                Submit indent
              </button>
              <button type="button" onClick={resetIndent} className="mise-raised mise-press rounded-lg px-4 py-1.5 text-sm font-medium text-fg-soft">
                Clear
              </button>
            </div>
          </form>
          )}
        </Card>
      )}

      {/* ── The purchasing pipeline — where every order sits, at a glance ── */}
      {(indents.length > 0 || pos.length > 0) && (
        <Card className="mise-feel mb-6">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {(() => {
              const stages = [
                {
                  icon: "📝",
                  label: "Indents raised",
                  main: indents.filter((x) => x.status === "PENDING").length,
                  sub: "awaiting approval",
                  tone: "text-amber-300",
                },
                {
                  icon: "✅",
                  label: "Approved",
                  main: indents.filter((x) => x.status === "APPROVED").length,
                  sub: "ready to order",
                  tone: "text-brand-300",
                },
                {
                  icon: "📦",
                  label: "POs out",
                  main: pos.filter((x) => x.status !== "RECEIVED").length,
                  sub: "with suppliers",
                  tone: "text-sky-300",
                },
                {
                  icon: "🏠",
                  label: "Received",
                  main: pos.filter((x) => x.status === "RECEIVED").length,
                  sub: "in your stock",
                  tone: "text-fg",
                },
              ];
              return stages.map((st, i) => (
                <div key={st.label} className="flex flex-1 items-center gap-2">
                  <div className="mise-well mise-feel flex flex-1 items-center gap-3 rounded-xl px-3.5 py-2.5">
                    <span aria-hidden className="text-xl">{st.icon}</span>
                    <span className="min-w-0">
                      <span className={`block text-lg font-bold leading-tight ${st.tone}`}>{st.main}</span>
                      <span className="block truncate text-[11px] text-fg-faint">{st.label} · {st.sub}</span>
                    </span>
                  </div>
                  {i < stages.length - 1 && (
                    <span aria-hidden className="hidden text-fg-faint sm:block">→</span>
                  )}
                </div>
              ));
            })()}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Indents — tap a row to see its items, suppliers and the approve action. */}
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="font-semibold text-fg">Indents</h3>
            <span className="text-xs text-fg-faint">{indents.length} total</span>
          </div>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto p-3">
            {indents.length === 0 ? (
              <p className="py-10 text-center text-sm text-fg-faint">No indents yet.</p>
            ) : (
              indents.map((ind) => {
                const open = openIndent === ind.id;
                return (
                  <div key={ind.id} className="overflow-hidden rounded-xl border border-line bg-glass/5 transition hover:border-line-2">
                    <button
                      type="button"
                      onClick={() => toggleIndent(ind)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <span aria-hidden className={`text-fg-faint transition-transform duration-200 ${open ? "rotate-90" : ""}`}>›</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-fg">{ind.date}</span>
                        <span className="block text-xs text-fg-faint">{ind.items.length} item{ind.items.length === 1 ? "" : "s"}</span>
                      </span>
                      <Badge tone={indentTone[ind.status] ?? "slate"}>{ind.status}</Badge>
                    </button>
                    {open && (
                      <div className="mise-pop space-y-3 border-t border-line px-4 py-3">
                        <ul className="space-y-1.5">
                          {ind.items.map((it) => (
                            <li key={it.item_id} className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="min-w-0 truncate text-fg-soft">{it.item_name}</span>
                              <span className="shrink-0 text-right">
                                <span className="text-fg">{it.required_qty} {it.unit}</span>
                                {it.vendor_name && <span className="ml-2 text-xs text-brand-300">→ {it.vendor_name}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {/* Once ordered: the POs this indent produced — one PDF per
                            vendor + ONE consolidated PDF for the whole indent. */}
                        {ind.status === "ORDERED" && indentConsol[ind.id] && indentConsol[ind.id].po_count > 0 && (
                          <div className="rounded-xl border border-brand-500/30 bg-brand-500/[0.06] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-brand-300">
                                Orders from this indent
                              </span>
                              <span className="text-xs text-fg-faint">
                                {indentConsol[ind.id].vendor_count} vendor{indentConsol[ind.id].vendor_count === 1 ? "" : "s"} · <b className="text-fg-soft">{format(indentConsol[ind.id].grand_total)}</b>
                              </span>
                            </div>
                            <div className="space-y-1.5">
                              {indentConsol[ind.id].vendors.map((v) => (
                                <div key={v.po_id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper-2/40 px-2.5 py-1.5">
                                  <span className="min-w-0 truncate text-sm text-fg">
                                    {v.vendor_name || "—"} <span className="text-xs text-fg-faint">· {v.po_number} · {format(v.subtotal)}</span>
                                  </span>
                                  <button
                                    onClick={() => downloadFile(`/purchasing/purchase-orders/${v.po_id}/pdf`, `${v.po_number}.pdf`)}
                                    className="shrink-0 rounded-md border border-line px-2 py-1 text-xs font-medium text-brand-300 hover:bg-brand-400/10"
                                  >
                                    ⬇ PDF
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              onClick={() => downloadFile(`/purchasing/indents/${ind.id}/consolidated.pdf`, `consolidated-${ind.date}.pdf`)}
                              className="mt-2.5 w-full rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-sm font-semibold text-brand-300 transition hover:bg-brand-500/20"
                            >
                              🧾 Download consolidated PDF (all vendors)
                            </button>
                            <p className="mt-1.5 text-[11px] text-fg-faint">
                              Receiving &amp; short-delivery notes are on each order in the <b className="text-fg-soft">Purchase orders</b> panel.
                            </p>
                          </div>
                        )}

                        <div className="flex gap-2">
                          {canApprove && ind.status !== "ORDERED" && (
                            <button
                              onClick={() => generate(ind.id)}
                              className="flex-1 rounded-lg border border-brand-400/30 bg-brand-400/10 px-3 py-2 text-sm font-medium text-brand-300 transition hover:bg-brand-400/20"
                            >
                              ✓ Approve &amp; generate purchase orders
                            </button>
                          )}
                          {canApprove && (
                            <button
                              onClick={() => deleteIndent(ind.id)}
                              title="Delete this indent"
                              className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-fg-faint transition hover:bg-rose-400/10 hover:text-rose-300"
                            >
                              🗑 Delete
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Purchase orders — same tap-to-expand; line items load on open, no side-scroll. */}
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="font-semibold text-fg">Purchase orders</h3>
            <span className="text-xs text-fg-faint">{pos.length} total</span>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto p-3">
            {pos.length === 0 ? (
              <p className="py-10 text-center text-sm text-fg-faint">No purchase orders yet.</p>
            ) : (
              poGroups.map((g) => (
              <div key={g.key} className="rounded-2xl border border-line/70 bg-glass/[0.02] p-2.5">
                {/* Purchase-run header: per-vendor orders below + one consolidated PDF */}
                <div className="mb-2 flex items-center justify-between gap-2 px-1">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-fg">
                      {g.indent ? `🛒 Purchase · ${g.indent.date}` : "Other orders"}
                    </span>
                    <span className="block text-[11px] text-fg-faint">
                      {g.pos.length} order{g.pos.length === 1 ? "" : "s"} · {g.vendorCount} vendor{g.vendorCount === 1 ? "" : "s"} · <b className="text-fg-soft">{format(String(g.total.toFixed(2)))}</b>
                    </span>
                  </span>
                  {g.indentId && (
                    <button
                      type="button"
                      onClick={() => downloadFile(`/purchasing/indents/${g.indentId}/consolidated.pdf`, `consolidated-${g.indent?.date ?? "po"}.pdf`)}
                      title="One PDF for this whole purchase (all vendors + items)"
                      className="shrink-0 rounded-lg border border-brand-500/40 bg-brand-500/10 px-2.5 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/20"
                    >
                      🧾 Consolidated PDF
                    </button>
                  )}
                </div>
                <div className="space-y-2">
              {g.pos.map((po) => {
                const open = openPo === po.id;
                const detail = poDetail[po.id];
                const busy = poBusy === po.id;
                return (
                  <div key={po.id} className="overflow-hidden rounded-xl border border-line bg-glass/5 transition hover:border-line-2">
                    <button
                      type="button"
                      onClick={() => togglePo(po.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      <span aria-hidden className={`text-fg-faint transition-transform duration-200 ${open ? "rotate-90" : ""}`}>›</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{po.po_number}</span>
                        <span className="block truncate text-xs text-fg-faint">{po.vendor_name || "—"}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold text-fg">{format(po.total_amount)}</span>
                        <Badge tone={poTone[po.status] ?? "slate"}>{po.status}</Badge>
                      </span>
                    </button>
                    {open && (
                      <div className="mise-pop space-y-3 border-t border-line px-4 py-3">
                        {busy && !detail ? (
                          <p className="py-1 text-center text-sm text-fg-faint">Loading items…</p>
                        ) : detail && detail.items.length > 0 ? (
                          <ul className="space-y-1.5">
                            {detail.items.map((it) => (
                              <li key={it.item_id} className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate text-fg-soft">{it.item_name}</span>
                                <span className="shrink-0 text-fg-faint">
                                  {it.ordered_qty} × {format(it.unit_price)}
                                  {po.status === "RECEIVED" && it.received_qty !== it.ordered_qty && (
                                    <span className="ml-2 font-medium text-rose-300">· got {it.received_qty}</span>
                                  )}
                                  <span className="ml-2 font-medium text-fg">{format(it.line_total)}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="py-1 text-center text-sm text-fg-faint">No line items.</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => downloadFile(`/purchasing/purchase-orders/${po.id}/pdf`, `${po.po_number}.pdf`)}
                            className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-brand-300"
                          >
                            ⬇ {po.status === "RECEIVED" ? "PO (ordered)" : "PDF"}
                          </button>
                          {po.status === "RECEIVED" && (
                            <button
                              onClick={() => downloadFile(`/purchasing/purchase-orders/${po.id}/pdf?received=1`, `${po.po_number}-received.pdf`)}
                              title="What actually arrived (ordered vs received + the note)"
                              className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-brand-300"
                            >
                              ⬇ Received note
                            </button>
                          )}
                          {canApprove && po.status !== "RECEIVED" && (
                            <button
                              onClick={() => detail && openReceive(detail)}
                              disabled={!detail}
                              className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-fg-soft disabled:opacity-50"
                            >
                              ✓ Receive into stock
                            </button>
                          )}
                          {canApprove && po.status !== "RECEIVED" && (
                            <button
                              onClick={() => revertPo(po)}
                              title="Send this PO back to its indent (re-opens it to edit/regenerate)"
                              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-faint transition hover:bg-amber-400/10 hover:text-amber-300"
                            >
                              ↩ Revert to indent
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
                </div>
              </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {recvPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setRecvPo(null)} aria-hidden />
          <div className="mise-pop-lg relative max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-paper-2 p-5 shadow-2xl shadow-black/50">
            <div className="mb-1 flex items-start justify-between">
              <h3 className="text-lg font-semibold text-fg">Receive {recvPo.po_number}</h3>
              <button onClick={() => setRecvPo(null)} className="-mr-1 -mt-1 rounded-lg p-1 text-fg-faint hover:bg-paper hover:text-fg" aria-label="Close">✕</button>
            </div>
            <p className="mb-3 text-sm text-fg-faint">
              Enter what actually arrived. If a line is short or over, edit its received qty and add a reason —
              the ordered PO and this received note both stay downloadable.
            </p>

            {/* Scan the vendor bill → auto-fill received qty + new prices (Textract). */}
            <div className="mb-4 rounded-xl border border-brand-500/30 bg-brand-500/[0.05] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-fg">📷 Scan the vendor bill <span className="text-fg-faint">(optional)</span></span>
                <label className="cursor-pointer rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/20">
                  {recvScanBusy ? "Reading…" : "Upload bill"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    disabled={recvScanBusy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) scanBill(f); e.currentTarget.value = ""; }}
                  />
                </label>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
                Mise reads the bill and matches its lines to <b className="text-fg-soft">this order</b> — filling in the
                received qty + the <b className="text-fg-soft">actual price</b> per item. Nothing changes until you press
                Receive; old prices are kept in each item&apos;s <b className="text-fg-soft">price history</b>.
              </p>
              {recvScanMsg && <p className="mt-1.5 text-xs text-fg-soft">{recvScanMsg}</p>}
            </div>

            <div className="space-y-2">
              {recvPo.items.map((it) => {
                const val = recvLines[it.po_item_id] ?? it.ordered_qty;
                const diff = val !== it.ordered_qty;
                const newPrice = recvPrices[it.po_item_id];
                const priceChanged = newPrice !== undefined && newPrice !== it.unit_price;
                return (
                  <div key={it.po_item_id} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-fg">{it.item_name}</span>
                      <span className="shrink-0 text-xs text-fg-faint">ordered {it.ordered_qty}</span>
                      <input
                        value={val}
                        onChange={(e) => setRecvLines((m) => ({ ...m, [it.po_item_id]: e.target.value }))}
                        inputMode="decimal"
                        aria-label={`Received quantity for ${it.item_name}`}
                        className={`w-20 rounded-md border bg-transparent px-2 py-1 text-right text-sm ${diff ? "border-rose-400/60 text-rose-300" : "border-line-2 text-fg"}`}
                      />
                    </div>
                    {newPrice !== undefined && (
                      <div className="mt-1.5 flex items-center gap-2 text-xs">
                        <span className="text-fg-faint">price:</span>
                        <span className="text-fg-faint line-through">{format(it.unit_price)}</span>
                        <span className="text-fg-faint">→</span>
                        <input
                          value={newPrice}
                          onChange={(e) => setRecvPrices((m) => ({ ...m, [it.po_item_id]: e.target.value }))}
                          inputMode="decimal"
                          aria-label={`New price for ${it.item_name}`}
                          className="w-24 rounded-md border border-brand-400/50 bg-transparent px-2 py-0.5 text-right text-fg"
                        />
                        {priceChanged && <span className="font-medium text-brand-300">new</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {Object.keys(recvPrices).length > 0 && (
              <label className="mt-3 flex items-center gap-2 text-sm text-fg-soft">
                <input
                  type="checkbox"
                  checked={recvUpdatePrices}
                  onChange={(e) => setRecvUpdatePrices(e.target.checked)}
                  className="h-4 w-4 accent-brand-500"
                />
                Update each vendor price to the bill price <span className="text-fg-faint">(saved to price history)</span>
              </label>
            )}
            {recvChanged(recvPo) && (
              <label className="mt-3 block">
                <span className="block text-xs font-medium text-fg-faint">Reason for the short / over delivery</span>
                <input
                  value={recvNote}
                  onChange={(e) => setRecvNote(e.target.value)}
                  placeholder="e.g. vendor out of stock — sent 30 of 100"
                  className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm"
                />
              </label>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setRecvPo(null)} className="rounded-lg border border-line px-4 py-2 text-sm text-fg-soft hover:bg-paper">Cancel</button>
              <button onClick={submitReceive} disabled={recvBusy} className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {recvBusy ? "Receiving…" : "✓ Receive into stock"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
