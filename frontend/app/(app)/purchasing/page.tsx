"use client";

import { useEffect, useMemo, useState } from "react";
import { fmtQty, fmtQtyNumber } from "@/lib/quantity";
import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type Indent,
  type IndentItemRow,
  type Item,
  type ItemSuppliers,
  type POOut,
  type POSummary,
  type ReorderSuggestion,
  type SupplierOption,
} from "@/lib/api";
import Link from "next/link";
import { Badge, Card, Spinner } from "@/components/ui";
import { Workbench } from "@/components/Workbench";
import { localISODate } from "@/lib/date";
import { DetailSection, DetailSheet, DetailStats } from "@/components/DetailSheet";
import { SubNav } from "@/components/SubNav";
import { Bars } from "@/components/charts";
import { Select } from "@/components/Select";
import { ItemPicker, categoryEmoji, type PickedLine } from "@/components/ItemPicker";
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


/** "today", "yesterday", "3 days ago" — a date alone makes you count back. */
function relativeDay(iso: string): string {
  const then = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.round((now.getTime() - then.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 0) return `in ${-days} day${days === -1 ? "" : "s"}`;
  if (days < 30) return `${days} days ago`;
  return "";
}

export default function PurchasingPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "indent:write");
  const canApprove = can(user?.role, "indent:approve");

  const [items, setItems] = useState<Item[]>([]);
  const [indents, setIndents] = useState<Indent[]>([]);
  const [pos, setPos] = useState<POSummary[]>([]);
  const [todayStr] = useState(() => new Date().toISOString().slice(0, 10)); // frozen at mount
  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  // item_id -> every vendor pricing it (cheapest first), for the line picker
  const [suppliers, setSuppliers] = useState<Record<string, SupplierOption[]>>({});
  // item_id -> the vendor PICKED for this order ("" / missing = automatic)
  const [vendorPick, setVendorPick] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  // Deep link from Inventory: show THIS item's own purchasing history in place.
  const [historyItem, setHistoryItem] = useState<string | null>(null);
  // Which item's supplier detail is open. Separate from adding it to the order:
  // "what does this cost me, and from whom" is a question you ask BEFORE
  // deciding, and it used to mean leaving the page.
  const [peekItem, setPeekItem] = useState<string | null>(null);
  // Which view of the item is open. Resets to the suppliers each time a new
  // item is opened — landing on a previous item's history reads as a bug.
  const [peekPane, setPeekPane] = useState<"suppliers" | "history" | "order">("suppliers");
  const [peekQty, setPeekQty] = useState("");
  const [peekBusy, setPeekBusy] = useState(false);
  // Recorded price changes for whichever item is open. Fetched on demand
  // rather than for every item in the picker — most are never opened.
  const [peekHistory, setPeekHistory] = useState<
    { vendor_name: string; old_price: string | null; new_price: string; source: string; at: string }[]
  >([]);

  useEffect(() => {
    if (!peekItem) {
      setPeekHistory([]);
      return;
    }
    let cancelled = false;
    api
      .get<{ history: typeof peekHistory }>(`/vendors/items/${peekItem}/price-history`)
      .then((r) => {
        if (!cancelled) setPeekHistory(r.history);
      })
      .catch(() => {
        if (!cancelled) setPeekHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [peekItem]);
  // The page is three jobs, not one long scroll: raise an order, track indents,
  // track POs. Stacking all three meant whatever you came for was usually below
  // the fold.
  const [tab, setTab] = useState<"new" | "indents" | "orders">("new");

  // ⌘K "Start a purchase order" (?new=1) → spotlight the indent composer
  useDeepLink({ new: () => spotlight("indent-form") }, !loading);
  // Tap-to-expand: which indent / PO row is open, plus a cache of fetched PO lines.
  const [openIndent, setOpenIndent] = useState<string | null>(null);
  const [openPo, setOpenPo] = useState<string | null>(null);
  const [poDetail, setPoDetail] = useState<Record<string, POOut>>({});
  const [poBusy, setPoBusy] = useState<string | null>(null);
  // Per-indent consolidated view (its POs across vendors), lazy-loaded on expand.
  const [indentConsol, setIndentConsol] = useState<Record<string, Consolidated>>({});


  // Everything that ever happened to ONE item: the indent lines that asked for
  // it, and the POs those indents turned into. Built from data already loaded,
  // so opening the history costs no extra request.
  const itemStory = useMemo(() => {
    if (!historyItem) return null;
    const item = items.find((i) => i.id === historyItem);
    if (!item) return null;
    const rows = indents
      .map((ind) => {
        const line = ind.items.find((l) => l.item_id === historyItem);
        return line ? { indent: ind, line } : null;
      })
      .filter((r): r is { indent: Indent; line: IndentItemRow } => r !== null);
    const indentIds = new Set(rows.map((r) => r.indent.id));
    const orders = pos.filter((p) => p.indent_id && indentIds.has(p.indent_id));
    const ordered = rows.reduce((n, r) => n + Number(r.line.required_qty || 0), 0);
    return { item, rows, orders, ordered, last: rows[0]?.indent.date ?? null };
  }, [historyItem, items, indents, pos]);

  /** Make this vendor the chosen supplier for the item being peeked at.
   *  Ordering and recipe costing both follow the chosen supplier, so this is
   *  a real decision — it just no longer requires a trip to another page. */
  async function chooseSupplierHere(itemId: string, vendorId: string) {
    setPeekBusy(true);
    try {
      await api.post(`/vendors/items/${itemId}/preferred`, { vendor_id: vendorId });
      const rows = await api.get<ItemSuppliers[]>("/purchasing/item-suppliers");
      setSuppliers(Object.fromEntries(rows.map((r) => [r.item_id, r.vendors])));
    } catch {
      /* the list simply stays as it was */
    } finally {
      setPeekBusy(false);
    }
  }

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
    // ?openItem=<id> — "view in Purchasing" from an inventory item: don't just
    // land on the page, open that exact item's indent + PO history.
    const openItemId = params.get("openItem");
    if (openItemId && items.some((i) => i.id === openItemId)) {
      setHistoryItem(openItemId);
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    const itemId = params.get("item");
    if (!itemId || !items.some((i) => i.id === itemId)) return;
    // Say what just happened. Landing on a busy page with a silently pre-filled
    // row reads as "it ignored me" — which is exactly what it looked like.
    setMsg(`${items.find((i) => i.id === itemId)?.name ?? "That item"} is on your order below — enter how much you need.`);
    setLines((prev) => (prev.some((l) => l.item_id === itemId) ? prev : [...prev, { item_id: itemId, qty: "" }]));
    const vendorId = params.get("vendor");
    if (vendorId) setVendorPick((prev) => ({ ...prev, [itemId]: vendorId }));
    window.history.replaceState(null, "", window.location.pathname); // one-shot
    setTab("new");
    // Open that item's suppliers straight away. You came here from Inventory
    // asking "who sells this?" — scrolling to a highlighted row still left you
    // to go and find the answer. The row is spotlit underneath for when the
    // sheet closes.
    setPeekItem(itemId);
    setPeekPane("suppliers");
    setPeekQty("");
    setTimeout(() => spotlight(`picked-${itemId}`), 60);
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
  // Whatever row is open — its detail renders in a sheet, in place.
  const openIndentObj = indents.find((i) => i.id === openIndent) ?? null;
  const openPoObj = pos.find((o) => o.id === openPo) ?? null;
  const openPoDetail = openPo ? poDetail[openPo] : undefined;
  const openPoBusy = poBusy === openPo;

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
    <Workbench
      title="Purchasing"
      subtitle="Kitchen indents → vendor-wise purchase orders."
      action={
        canWrite ? (
          <button
            type="button"
            onClick={() => setTab("new")}
            className="mise-press rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-900/30 hover:bg-brand-700"
          >
            ＋ New order
          </button>
        ) : undefined
      }
      tools={
          <SubNav
            active={tab}
            items={[
              ...(canWrite
                ? [{ key: "new", label: "New order", icon: "＋", onSelect: () => setTab("new") }]
                : []),
              {
                key: "indents",
                label: "Indents",
                icon: "📋",
                count: indents.filter((i) => i.status === "PENDING").length || indents.length,
                tone: indents.some((i) => i.status === "PENDING") ? "warn" : "plain",
                onSelect: () => setTab("indents"),
              },
              {
                key: "orders",
                label: "Purchase orders",
                icon: "🚚",
                count: pos.filter((p) => p.status !== "RECEIVED").length || pos.length,
                tone: pos.some(
                  (p) => p.status !== "RECEIVED" && p.expected_delivery && p.expected_delivery < todayStr,
                )
                  ? "bad"
                  : "plain",
                onSelect: () => setTab("orders"),
              },
            ]}
          />
      }
      tally={(() => {
        // The money committed but not yet received. This app exists to answer
        // money questions, so that number stays on screen rather than waiting
        // at the bottom of a scroll.
        const open = pos.filter((x) => x.status !== "RECEIVED");
        const overdue = open.filter(
          (x) => x.expected_delivery && x.expected_delivery < todayStr,
        ).length;
        const awaiting = indents.filter((x) => x.status === "PENDING").length;
        return (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-faint">
            <span>
              <b className="text-fg-soft">
                {format(open.reduce((t, x) => t + (parseFloat(x.total_amount) || 0), 0))}
              </b>{" "}
              committed
            </span>
            <span>
              <b className="text-fg-soft">{open.length}</b> open order
              {open.length === 1 ? "" : "s"}
            </span>
            {awaiting > 0 && (
              <span className="text-amber-300">
                <b>{awaiting}</b> indent{awaiting === 1 ? "" : "s"} awaiting approval
              </span>
            )}
            {overdue > 0 && (
              <span className="text-rose-300">
                <b>{overdue}</b> past its delivery date
              </span>
            )}
          </div>
        );
      })()}
    >
      {msg && <p className="mb-4 rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{msg}</p>}

      {/* One item's suppliers, without leaving the order you are building.
          Arriving from Inventory's "add supplier" lands straight here, so the
          question that sent you ("who sells this, and for how much?") is
          answered on arrival instead of after a scroll. */}
      {(() => {
        const it = peekItem ? items.find((i) => i.id === peekItem) : null;
        if (!it) return null;
        const opts = [...(suppliers[it.id] ?? [])].sort(
          (a, b) => (parseFloat(a.price_per_unit) || 0) - (parseFloat(b.price_per_unit) || 0),
        );
        const cheapest = opts[0];
        const chosen = opts.find((o) => o.is_preferred);
        return (
          <DetailSheet
            open
            onClose={() => setPeekItem(null)}
            width="lg"
            icon={categoryEmoji(it.category ?? "")}
            title={it.name}
            subtitle={`${opts.length} supplier${opts.length === 1 ? "" : "s"} · have ${fmtQty(it.current_stock, it.unit)}`}
            stats={
              opts.length
                ? [
                    { label: "Cheapest", value: format(cheapest.price_per_unit), hint: cheapest.vendor_name, tone: "good" },
                    {
                      label: "Chosen",
                      value: chosen ? format(chosen.price_per_unit) : "—",
                      hint: chosen ? chosen.vendor_name : "none set — auto picks cheapest",
                    },
                    { label: "In stock", value: fmtQty(it.current_stock, it.unit), hint: `min ${it.min_stock_level ?? "—"}` },
                  ]
                : undefined
            }
            sections={[
              { key: "suppliers", label: "Suppliers", icon: "🤝", count: opts.length },
              { key: "history", label: "Price history", icon: "📈", count: peekHistory.length },
              ...(canWrite ? [{ key: "order", label: "Order it", icon: "🛒" }] : []),
            ]}
            active={peekPane}
            onSection={(k) => setPeekPane(k as typeof peekPane)}
            actions={
              canWrite ? (
                <button
                  type="button"
                  onClick={() => {
                    setLines((prev) =>
                      prev.some((l) => l.item_id === it.id) ? prev : [...prev, { item_id: it.id, qty: "" }],
                    );
                    setPeekItem(null);
                    setTimeout(() => spotlight(`picked-${it.id}`), 60);
                  }}
                  className="mise-press rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white"
                >
                  Add to this order
                </button>
              ) : null
            }
          >
            {peekPane === "suppliers" && (opts.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-faint">
                No supplier prices this yet, so it cannot be ordered. Add a price on the
                Vendors page and it becomes orderable and costable.
              </p>
            ) : (
              <>
                <p className="mb-2 text-[11px] leading-relaxed text-fg-faint">
                  Ordering uses the vendor on the order itself; failing that your ★ chosen
                  supplier; failing that the cheapest. Tap one to make them the chosen supplier.
                </p>
                <ul className="space-y-1.5">
                  {opts.map((o, i) => (
                    <li key={o.vendor_id}>
                      <button
                        type="button"
                        disabled={!canWrite || peekBusy || o.is_preferred}
                        onClick={() => chooseSupplierHere(it.id, o.vendor_id)}
                        className={`mise-press flex w-full flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-default ${
                          i === 0 ? "border-emerald-400/30 bg-emerald-400/[0.06]" : "border-line"
                        } ${canWrite && !o.is_preferred ? "hover:border-brand-400/50 hover:bg-brand-400/[0.06]" : ""}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                          {o.vendor_name}
                          {o.is_preferred && <span className="ml-2 text-[11px] text-brand-300">★ chosen</span>}
                        </span>
                        <span className={`font-display text-sm font-semibold tabular-nums ${i === 0 ? "text-emerald-300" : "text-fg-soft"}`}>
                          {format(o.price_per_unit)}/{it.unit}
                        </span>
                        {i === 0 && (
                          <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            cheapest
                          </span>
                        )}
                        {canWrite && !o.is_preferred && (
                          <span aria-hidden className="text-[10px] text-fg-faint">make ★</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ))}

            {/* Order it, without closing this and hunting for the picker. */}
            {peekPane === "order" && canWrite && (
              <>
                <p className="mb-3 text-[11px] leading-relaxed text-fg-faint">
                  How many {it.unit}? It joins the order you are building — nothing is sent yet.
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <input
                    inputMode="decimal"
                    value={peekQty}
                    onChange={(e) => setPeekQty(e.target.value)}
                    placeholder={`qty in ${it.unit}`}
                    className="mise-well w-36 rounded-lg px-3 py-2 text-sm outline-none"
                    aria-label={`Quantity of ${it.name}`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setLines((prev) =>
                        prev.some((l) => l.item_id === it.id)
                          ? prev.map((l) => (l.item_id === it.id ? { ...l, qty: peekQty } : l))
                          : [...prev, { item_id: it.id, qty: peekQty }],
                      );
                      setPeekItem(null);
                      setTimeout(() => spotlight(`picked-${it.id}`), 60);
                    }}
                    disabled={!peekQty}
                    className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Add to the order
                  </button>
                </div>
                <p className="mt-3 text-[11px] text-fg-faint">
                  In stock now: {fmtQty(it.current_stock, it.unit)}
                  {it.min_stock_level ? ` · you keep at least ${fmtQtyNumber(it.min_stock_level)}` : ""}
                </p>
              </>
            )}

            {/* What this item has actually cost, and who moved it. Asking "is
                this price normal?" used to mean leaving a half-built indent to
                go to Price Comparison. */}
            {peekPane === "history" && (peekHistory.length === 0 ? (
              <p className="py-6 text-center text-sm text-fg-faint">
                No price changes recorded yet. They appear here as soon as a supplier&apos;s
                price moves — by hand, on an order, or off an invoice.
              </p>
            ) : (
              <div>
                <ul className="mt-2 space-y-1">
                  {peekHistory.map((h, i) => {
                    const was = h.old_price ? parseFloat(h.old_price) : null;
                    const now = parseFloat(h.new_price) || 0;
                    const up = was !== null && now > was;
                    const down = was !== null && now < was;
                    return (
                      <li
                        key={i}
                        className="mise-well flex flex-wrap items-center gap-2 rounded-lg px-3 py-1.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate text-fg-soft">{h.vendor_name}</span>
                        {was !== null && (
                          <span className="text-fg-faint">{format(h.old_price!)} →</span>
                        )}
                        <span
                          className={`font-mono ${up ? "text-rose-300" : down ? "text-emerald-300" : "text-fg"}`}
                        >
                          {up ? "▲" : down ? "▼" : ""} {format(h.new_price)}
                        </span>
                        <span className="text-[10px] text-fg-faint">
                          {h.source} · {new Date(h.at).toLocaleDateString()}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <Link
                  href={`/price-comparison?item=${it.id}`}
                  className="mt-2 inline-block text-[11px] text-brand-400 underline-offset-4 hover:underline"
                >
                  Full history and every supplier&apos;s line →
                </Link>
              </div>
            ))}
          </DetailSheet>
        );
      })()}

      {/* What needs you, before you have chosen anything.
          The pipeline card below only appears on the "new" tab and only once
          there is data, so arriving here used to tell you nothing until you
          clicked something. These four are the questions this page exists to
          answer - is anything waiting on me, is anything late, and how much
          money is committed - and each one jumps to the rows behind it. */}
      {(indents.length > 0 || pos.length > 0) && (() => {
        const today = localISODate();
        const openPos = pos.filter((x) => x.status !== "RECEIVED");
        const awaiting = indents.filter((x) => x.status === "PENDING").length;
        // Late = promised before today and still not received. Compared as ISO
        // strings on purpose: both sides are already local calendar dates, so
        // parsing them into Dates would only reintroduce a timezone to get wrong.
        const overdue = openPos.filter(
          (x) => x.expected_delivery && x.expected_delivery < today,
        ).length;
        const committed = openPos.reduce((sum, x) => sum + (parseFloat(x.total_amount) || 0), 0);
        const tiles: {
          label: string; value: string | number; hint: string;
          tone: "plain" | "warn" | "bad"; go: "new" | "indents" | "orders";
        }[] = [
          { label: "Awaiting approval", value: awaiting, hint: awaiting === 1 ? "indent" : "indents",
            tone: awaiting > 0 ? "warn" : "plain", go: "indents" },
          { label: "Overdue", value: overdue, hint: "past the promised date",
            tone: overdue > 0 ? "bad" : "plain", go: "orders" },
          { label: "In flight", value: openPos.length, hint: "not yet received",
            tone: "plain", go: "orders" },
          { label: "Committed", value: format(String(committed)), hint: "on open orders",
            tone: "plain", go: "orders" },
        ];
        // One compact row, not four cards.
        //
        // These four numbers are the questions the page answers — is anything
        // waiting on me, is anything late, how much is committed — so they keep
        // their place and they still jump to the rows behind them. But as
        // 2xl-type cards they took a fifth of the screen ABOVE the order form,
        // and the same four numbers are already on the pinned tally at the
        // bottom, in view the whole time.
        //
        // Compact keeps the click and gives the height back to the work. Only
        // what needs attention is coloured, so a glance still finds it.
        return (
          <div className="mise-stagger mb-3 flex flex-wrap items-center gap-1.5">
            {tiles.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => setTab(t.go)}
                title={`${t.label} — ${t.hint}`}
                className={`mise-press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
                  t.tone === "bad"
                    ? "border-rose-400/40 bg-rose-400/10 text-rose-200"
                    : t.tone === "warn"
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-200"
                      : "border-line text-fg-soft hover:border-brand-400/40"
                }`}
              >
                <span className="font-display text-sm font-semibold tabular-nums">
                  {t.value}
                </span>
                <span className="truncate">{t.label.toLowerCase()}</span>
              </button>
            ))}
          </div>
        );
      })()}

      {/* One job on screen at a time. Everything is one tap away; nothing is
          reachable only by scrolling. */}
      {/* The same SubNav every other section uses, so Purchasing stops being
          the odd one out — and the counts now say what needs attention rather
          than just how many exist. */}

      {canWrite && tab === "new" && (
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
            {/* Submit lives INSIDE the tray. It used to sit under the whole
                picker, so the more you ordered the further away it got. */}
            <ItemPicker
              staged
              items={orderable}
              lines={lines}
              onChange={setLines}
              lineExtra={supplierPicker}
              // The prices, on the card. Deciding what to order IS deciding
              // what it costs, and that number was one click away on the page
              // whose entire job is spending money.
              suppliers={suppliers}
              // Rows, not cards. Sixty items as cards is a wall you scroll
              // past; the same thing as rows is a list you can actually work
              // down while building an order.
              dense
              onOpenDetail={setPeekItem}
              trayFooter={
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={lines.length === 0} className="mise-press rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40">
                    Submit indent{lines.length > 0 ? ` · ${lines.length}` : ""}
                  </button>
                  <button type="button" onClick={resetIndent} className="mise-raised mise-press rounded-lg px-4 py-1.5 text-sm font-medium text-fg-soft">
                    Clear
                  </button>
                </div>
              }
            />
          </form>
          )}
        </Card>
      )}

      {/* ── The purchasing pipeline — where every order sits, at a glance ── */}
      {tab === "new" && (indents.length > 0 || pos.length > 0) && (
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

      <div className="grid grid-cols-1 gap-6">
        {/* Indents — tap a row to see its items, suppliers and the approve action. */}
        <Card className={`overflow-hidden p-0 ${tab === "indents" ? "" : "hidden"}`}>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="font-semibold text-fg">Indents</h3>
            <span className="text-xs text-fg-faint">{indents.length} total</span>
          </div>
          <div className="space-y-2 p-3">
            {indents.length === 0 ? (
              <p className="py-10 text-center text-sm text-fg-faint">No indents yet.</p>
            ) : (
              indents.map((ind) => {
                const open = openIndent === ind.id;
                return (
                  <button
                    key={ind.id}
                    type="button"
                    onClick={() => toggleIndent(ind)}
                    aria-expanded={open}
                    className={`mise-feel mise-press flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition hover:-translate-y-0.5 ${
                      ind.status === "PENDING"
                        ? "border-amber-400/30 bg-amber-400/[0.05]"
                        : "border-line bg-glass/5 hover:border-line-2"
                    }`}
                  >
                    {/* A tile rather than a chevron: status is the first thing
                        you need, and colour reads faster than a word. */}
                    <span
                      aria-hidden
                      className={`mise-neo-raised grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg ${
                        ind.status === "PENDING" ? "text-amber-300"
                        : ind.status === "APPROVED" ? "text-emerald-300"
                        : ind.status === "REJECTED" ? "text-rose-300"
                        : "text-fg-faint"
                      }`}
                    >
                      {ind.status === "ORDERED" ? "🚚" : ind.status === "APPROVED" ? "✓" : ind.status === "REJECTED" ? "✕" : "📋"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-sm font-semibold text-fg">
                        {ind.date}
                        <span className="ml-2 font-sans text-[11px] font-normal text-fg-faint">
                          {relativeDay(ind.date)}
                        </span>
                      </span>
                      <span className="block text-xs text-fg-faint">
                        {ind.items.length} item{ind.items.length === 1 ? "" : "s"}
                        {(() => {
                          // Suppliers involved, from lines we already have — no
                          // extra request just to count them.
                          const vendors = new Set(
                            ind.items.map((i) => i.vendor_name).filter(Boolean),
                          ).size;
                          return vendors > 0 ? ` · ${vendors} supplier${vendors === 1 ? "" : "s"}` : "";
                        })()}
                      </span>
                    </span>
                    {indentConsol[ind.id]?.po_count ? (
                      <span className="shrink-0 text-right">
                        <span className="block font-display text-sm font-semibold tabular-nums text-fg">
                          {format(indentConsol[ind.id].grand_total)}
                        </span>
                        <span className="block text-[10px] text-fg-faint">ordered</span>
                      </span>
                    ) : null}
                    <Badge tone={indentTone[ind.status] ?? "slate"}>{ind.status}</Badge>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Purchase orders — same tap-to-expand; line items load on open, no side-scroll. */}
        <Card className={`overflow-hidden p-0 ${tab === "orders" ? "" : "hidden"}`}>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="font-semibold text-fg">Purchase orders</h3>
            <span className="text-xs text-fg-faint">{pos.length} total</span>
          </div>
          <div className="space-y-3 p-3">
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
                  <div key={po.id} className={`mise-feel overflow-hidden rounded-2xl border transition ${
                    po.status !== "RECEIVED" && po.expected_delivery && po.expected_delivery < todayStr
                      ? "border-rose-400/30 bg-rose-400/[0.04]"
                      : "border-line bg-glass/5 hover:border-line-2"
                  }`}>
                    <button
                      type="button"
                      onClick={() => togglePo(po.id)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    >
                      {/* A status tile, matching the indent rows. Colour reads
                          faster than a word, and an order that has ARRIVED is a
                          different thing from one still out. */}
                      <span
                        aria-hidden
                        className={`mise-neo-raised grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base ${
                          po.status === "RECEIVED" ? "text-emerald-300"
                          : po.expected_delivery && po.expected_delivery < todayStr ? "text-rose-300"
                          : "text-fg-faint"
                        }`}
                      >
                        {po.status === "RECEIVED" ? "✓" : "🚚"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display text-sm font-semibold text-fg">{po.po_number}</span>
                        <span className="block truncate text-xs text-fg-faint">{po.vendor_name || "—"}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-display text-sm font-semibold tabular-nums text-fg">{format(po.total_amount)}</span>
                        <span className="flex items-center justify-end gap-1.5">
                          {po.status !== "RECEIVED" && po.expected_delivery && (() => {
                            const t = todayStr;
                            return po.expected_delivery < t ? (
                              <Badge tone="red">overdue</Badge>
                            ) : po.expected_delivery === t ? (
                              <Badge tone="amber">due today</Badge>
                            ) : null;
                          })()}
                          <Badge tone={poTone[po.status] ?? "slate"}>{po.status}</Badge>
                        </span>
                      </span>
                    </button>
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
                DineAI reads the bill and matches its lines to <b className="text-fg-soft">this order</b> — filling in the
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
                      <span className="shrink-0 text-xs text-fg-faint">ordered {fmtQtyNumber(it.ordered_qty)}</span>
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
                  className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none"
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

      {/* Indent detail — opens in place */}
      <DetailSheet
        open={!!openIndentObj}
        onClose={() => setOpenIndent(null)}
        width="lg"
        icon="📋"
        title={openIndentObj ? `Indent · ${openIndentObj.date}` : ""}
        subtitle={openIndentObj ? `raised ${openIndentObj.date} · ${openIndentObj.status.toLowerCase()}` : ""}
        badge={openIndentObj ? <Badge tone={indentTone[openIndentObj.status] ?? "slate"}>{openIndentObj.status}</Badge> : undefined}
        stats={
          openIndentObj
            ? [
                {
                  label: "Value",
                  // Only real once POs exist. Showing 0 for a pending indent would
                  // read as "this costs nothing", which is not what we know.
                  value: indentConsol[openIndentObj.id]?.po_count
                    ? format(indentConsol[openIndentObj.id].grand_total)
                    : "—",
                  hint: indentConsol[openIndentObj.id]?.po_count ? "ordered" : "not ordered yet",
                },
                { label: "Items", value: openIndentObj.items.length },
                {
                  label: "Vendors",
                  value:
                    indentConsol[openIndentObj.id]?.vendor_count ??
                    new Set(openIndentObj.items.map((i) => i.vendor_name).filter(Boolean)).size,
                  hint: "supplying this",
                },
              ]
            : undefined
        }
      >
        {openIndentObj && (
          <div>
                      <div className="mise-pop space-y-3 border-t border-line px-4 py-3">
                        <ul className="space-y-1.5">
                          {openIndentObj.items.map((it) => (
                            <li key={it.item_id} className="flex items-baseline justify-between gap-3 text-sm">
                              <button
                                type="button"
                                onClick={() => setHistoryItem(it.item_id)}
                                title="See everything this item has been ordered on"
                                className="min-w-0 truncate text-left text-fg-soft underline decoration-dotted underline-offset-4 transition hover:text-brand-300"
                              >
                                {it.item_name}
                              </button>
                              <span className="shrink-0 text-right">
                                <span className="text-fg">{fmtQty(it.required_qty, it.unit)}</span>
                                {it.vendor_name && <span className="ml-2 text-xs text-brand-300">→ {it.vendor_name}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {/* Once ordered: the POs this indent produced — one PDF per
                            vendor + ONE consolidated PDF for the whole indent. */}
                        {openIndentObj.status === "ORDERED" && indentConsol[openIndentObj.id] && indentConsol[openIndentObj.id].po_count > 0 && (
                          <div className="rounded-xl border border-brand-500/30 bg-brand-500/[0.06] p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <span className="text-xs font-semibold uppercase tracking-wide text-brand-300">
                                Orders from this indent
                              </span>
                              <span className="text-xs text-fg-faint">
                                {indentConsol[openIndentObj.id].vendor_count} vendor{indentConsol[openIndentObj.id].vendor_count === 1 ? "" : "s"} · <b className="text-fg-soft">{format(indentConsol[openIndentObj.id].grand_total)}</b>
                              </span>
                            </div>
                            {indentConsol[openIndentObj.id].vendors.length > 1 && (
                              // who's getting how much of this indent — at a glance
                              <div className="mise-well mb-2 rounded-lg p-2.5">
                                <Bars
                                  formatValue={(v) => format(String(v))}
                                  items={indentConsol[openIndentObj.id].vendors.map((v) => ({
                                    label: v.vendor_name || v.po_number,
                                    value: parseFloat(v.subtotal) || 0,
                                    color: "#d97742",
                                  }))}
                                />
                              </div>
                            )}
                            <div className="space-y-1.5">
                              {indentConsol[openIndentObj.id].vendors.map((v) => (
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
                              onClick={() => downloadFile(`/purchasing/indents/${openIndentObj.id}/consolidated.pdf`, `consolidated-${openIndentObj.date}.pdf`)}
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
                          {canApprove && openIndentObj.status !== "ORDERED" && (
                            <button
                              onClick={() => generate(openIndentObj.id)}
                              className="flex-1 rounded-lg border border-brand-400/30 bg-brand-400/10 px-3 py-2 text-sm font-medium text-brand-300 transition hover:bg-brand-400/20"
                            >
                              ✓ Approve &amp; generate purchase orders
                            </button>
                          )}
                          {canApprove && (
                            <button
                              onClick={() => deleteIndent(openIndentObj.id)}
                              title="Delete this indent"
                              className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-fg-faint transition hover:bg-rose-400/10 hover:text-rose-300"
                            >
                              🗑 Delete
                            </button>
                          )}
                        </div>
                      </div>
          </div>
        )}
      </DetailSheet>

      {/* Purchase-order detail — opens in place */}
      <DetailSheet
        open={!!openPoObj}
        onClose={() => setOpenPo(null)}
        width="lg"
        title={openPoObj ? openPoObj.po_number : ""}
        subtitle={openPoObj ? `${openPoObj.vendor_name} · ${openPoObj.status.toLowerCase()}` : ""}
      >
        {openPoObj && (
          <div>
                      <div className="mise-pop space-y-3 border-t border-line px-4 py-3">
                        {openPoObj.status !== "RECEIVED" && canApprove && (
                          <label className="flex flex-wrap items-center gap-2 text-xs text-fg-faint">
                            🚚 Expected delivery
                            <input
                              type="date"
                              value={openPoObj.expected_delivery ?? ""}
                              onChange={async (e) => {
                                const v = e.target.value || null;
                                try {
                                  await api.patch(`/purchasing/purchase-orders/${openPoObj.id}`, { expected_delivery: v });
                                  setPos((list) => list.map((x) => (x.id === openPoObj.id ? { ...x, expected_delivery: v } : x)));
                                } catch { /* leave as-was */ }
                              }}
                              className="mise-well rounded-lg px-2 py-1 text-xs text-fg outline-none"
                            />
                            {openPoObj.expected_delivery && <span>the dashboard will chase it on the day</span>}
                          </label>
                        )}
                        {openPoBusy && !openPoDetail ? (
                          <p className="py-1 text-center text-sm text-fg-faint">Loading items…</p>
                        ) : openPoDetail && openPoDetail.items.length > 0 ? (
                          <ul className="space-y-1.5">
                            {openPoDetail.items.map((it) => (
                              <li key={it.item_id} className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="min-w-0 truncate text-fg-soft">{it.item_name}</span>
                                <span className="shrink-0 text-fg-faint">
                                  {fmtQtyNumber(it.ordered_qty)} × {format(it.unit_price)}
                                  {openPoObj.status === "RECEIVED" && it.received_qty !== it.ordered_qty && (
                                    <span className="ml-2 font-medium text-rose-300">· got {fmtQtyNumber(it.received_qty)}</span>
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
                            onClick={() => downloadFile(`/purchasing/purchase-orders/${openPoObj.id}/pdf`, `${openPoObj.po_number}.pdf`)}
                            className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-brand-300"
                          >
                            ⬇ {openPoObj.status === "RECEIVED" ? "PO (ordered)" : "PDF"}
                          </button>
                          {openPoObj.status === "RECEIVED" && (
                            <button
                              onClick={() => downloadFile(`/purchasing/purchase-orders/${openPoObj.id}/pdf?received=1`, `${openPoObj.po_number}-received.pdf`)}
                              title="What actually arrived (ordered vs received + the note)"
                              className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-brand-300"
                            >
                              ⬇ Received note
                            </button>
                          )}
                          {canApprove && openPoObj.status !== "RECEIVED" && (
                            <button
                              onClick={() => openPoDetail && openReceive(openPoDetail)}
                              disabled={!openPoDetail}
                              className="mise-raised mise-press rounded-lg px-3 py-1.5 text-sm font-medium text-fg-soft disabled:opacity-50"
                            >
                              ✓ Receive into stock
                            </button>
                          )}
                          {canApprove && openPoObj.status !== "RECEIVED" && (
                            <button
                              onClick={() => revertPo(openPoObj)}
                              title="Send this PO back to its indent (re-opens it to edit/regenerate)"
                              className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-faint transition hover:bg-amber-400/10 hover:text-amber-300"
                            >
                              ↩ Revert to indent
                            </button>
                          )}
                        </div>
                      </div>
          </div>
        )}
      </DetailSheet>
      {/* One item's whole purchasing story — opened by Inventory's
          "Order / view in Purchasing" so the link lands on the record itself. */}
      <DetailSheet
        open={!!itemStory}
        onClose={() => setHistoryItem(null)}
        title={itemStory?.item.name ?? ""}
        subtitle="Everything this item has been ordered on"
        width="lg"
        actions={
          canWrite && itemStory ? (
            <button
              type="button"
              onClick={() => {
                const id = itemStory.item.id;
                setLines((prev) =>
                  prev.some((l) => l.item_id === id) ? prev : [...prev, { item_id: id, qty: "" }],
                );
                setHistoryItem(null);
                spotlight("indent-form");
              }}
              className="mise-press rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              🛒 Order this
            </button>
          ) : null
        }
      >
        {itemStory && (
          <div>
            <DetailStats
              stats={[
                { label: "Times requested", value: itemStory.rows.length },
                { label: "Total asked for", value: `${itemStory.ordered} ${itemStory.item.unit}` },
                { label: "Purchase orders", value: itemStory.orders.length },
              ]}
            />

            <DetailSection title={`Indents (${itemStory.rows.length})`}>
              {itemStory.rows.length === 0 ? (
                <p className="text-sm text-fg-faint">
                  Never requested yet — “Order this” starts the first one.
                </p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {itemStory.rows.map(({ indent, line }) => (
                    <li key={indent.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block text-sm text-fg">
                          {fmtQty(line.required_qty, line.unit)}
                          {line.vendor_name ? ` · ${line.vendor_name}` : ""}
                        </span>
                        <span className="text-[11px] text-fg-faint">{indent.date}</span>
                      </span>
                      <Badge tone={indentTone[indent.status] ?? "slate"}>{indent.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>

            <DetailSection title={`Purchase orders (${itemStory.orders.length})`}>
              {itemStory.orders.length === 0 ? (
                <p className="text-sm text-fg-faint">No PO has been raised from those indents yet.</p>
              ) : (
                <ul className="divide-y divide-line/60">
                  {itemStory.orders.map((po) => (
                    <li key={po.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-fg">{po.vendor_name}</span>
                        <span className="text-[11px] text-fg-faint">{po.po_number}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold text-fg">{format(po.total_amount)}</span>
                        <Badge tone={poTone[po.status] ?? "slate"}>{po.status}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </DetailSection>
          </div>
        )}
      </DetailSheet>
    </Workbench>
  );
}
