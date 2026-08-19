"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { OrderFlow } from "@/components/order/OrderFlow";
import type { ListFilter } from "@/components/ListControls";
import {
  EMPTY_FILTER,
  ListControls,
  Pager,
  applyFilter,
  pageOf,
  useListFilter,
} from "@/components/ListControls";
import { burstBasket } from "@/components/order/burst";
import { localISODate } from "@/lib/date";
import { DetailSection, DetailSheet, DetailStats } from "@/components/DetailSheet";
import { SubNav } from "@/components/SubNav";
import { Bars } from "@/components/charts";
import { categoryEmoji, type PickedLine } from "@/components/ItemPicker";
import type { OrderLine } from "@/components/order/OrderFlow";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useLiveRefresh } from "@/lib/useLiveRefresh";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { spotlight, useDeepLink } from "@/components/fx";
import { pricePerBase, stockInPacks } from "@/lib/packs";

// A basket line carries its own supplier choice now, so the same item bought
// from two vendors is two lines rather than one overwriting the other.
type Line = OrderLine;

/** `next` is either the new list or a function of the old one. */
function value0(next: Line[], _prev: Line[]): Line[] {
  return next;
}

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
  const router = useRouter();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "indent:write");
  const canApprove = can(user?.role, "indent:approve");

  const [items, setItems] = useState<Item[]>([]);
  const [indents, setIndents] = useState<Indent[]>([]);
  // How many there are in total, and how many per status — computed by the
  // database over EVERYTHING, not by counting the page in front of us. A chip
  // that counts only the current page is a chip that lies.
  const [indentTotal, setIndentTotal] = useState(0);
  /** Everything there is, filter or no filter — "showing 4 of 36". */
  const [indentGrand, setIndentGrand] = useState(0);
  /** Bumped after any action, so the indent page refetches itself. */
  const [refresh, setRefresh] = useState(0);
  const [indentCounts, setIndentCounts] = useState<Record<string, number>>({});
  const [pos, setPos] = useState<POSummary[]>([]);
  const [todayStr] = useState(() => new Date().toISOString().slice(0, 10)); // frozen at mount
  const [loading, setLoading] = useState(true);

  // item_id -> every vendor pricing it (cheapest first), for the line picker
  const [suppliers, setSuppliers] = useState<Record<string, SupplierOption[]>>({});
  // item_id -> the vendor PICKED for this order ("" / missing = automatic)
  const [vendorPick, setVendorPick] = useState<Record<string, string>>({});
  // Which of that supplier's FORMS the line buys — "" = their loose price,
  // a level id = that pack. Absent = let the server take their cheapest.
  const [formPick, setFormPick] = useState<Record<string, string>>({});

  // Read inside a debounced timer, so the saver always sees the CURRENT picks
  // without re-creating itself (and cancelling its own pending save) every time
  // a supplier changes.
  const pickRef = useRef<Record<string, string>>({});
  useEffect(() => {
    pickRef.current = vendorPick;
  }, [vendorPick]);

  // ── The basket lives on the server ───────────────────────────────────────
  //
  // It was in localStorage, which is per BROWSER and per profile — so a basket
  // built on the kitchen tablet was invisible on a phone, and a private window
  // showed an empty one. He found that in about a minute:
  //
  //   "if i go to incognito and login same account, see basket is not there...
  //    i guess u not storing in db — please store in db"
  //
  // Saved on a short debounce rather than on every keystroke: typing a quantity
  // fires a change per character, and one request per character is a lot of
  // requests for a draft nobody else can see.
  const [lines, setLinesRaw] = useState<Line[]>([]);
  const basketLoaded = useRef(false);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (basketLoaded.current) return;
    basketLoaded.current = true;
    void (async () => {
      try {
        const saved = await api.get<{ lines: { item_id: string; qty: string; vendor_id: string | null }[] }>(
          "/purchasing/basket",
        );
        if (saved.lines?.length) {
          setLinesRaw(saved.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })));
          const picks: Record<string, string> = {};
          for (const l of saved.lines) if (l.vendor_id) picks[l.item_id] = l.vendor_id;
          if (Object.keys(picks).length) setVendorPick((v) => ({ ...picks, ...v }));
        }
      } catch {
        /* an unreachable basket must not stop the page loading */
      }
    })();
  }, []);

  const setLines = useCallback(
    (next: Line[] | ((prev: Line[]) => Line[])) => {
      setLinesRaw((prev) => {
        const value = typeof next === "function" ? next(prev) : value0(next, prev);
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          void api
            .put("/purchasing/basket", {
              lines: value
                .filter((l) => l.item_id && parseFloat(l.qty) > 0)
                // The chosen supplier travels with the line — picking a vendor
                // is part of building the order, so losing it on a device swap
                // would lose half the work.
                .map((l) => ({
                  item_id: l.item_id,
                  qty: l.qty,
                  vendor_id: pickRef.current[l.item_id] || null,
                })),
            })
            .catch(() => {
              /* offline — the basket is still right on screen */
            });
        }, 600);
        return value;
      });
    },
    [],
  );

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

  /** Indents come a page at a time now — the database no longer reads every
   *  row, and each row costs its own query for its items, so this is the
   *  difference between 37 round trips and 11. Search and status went with it,
   *  because filtering here while paging there would only ever search the page
   *  you are on. */
  const loadIndents = useCallback(async (f: ListFilter) => {
    const params = new URLSearchParams({
      sort: f.sort === "oldest" ? "oldest" : "newest",
      limit: String(f.size || 0),
      offset: String(f.size ? (f.page - 1) * f.size : 0),
    });
    if (f.q.trim()) params.set("q", f.q.trim());
    if (f.status !== "all") params.set("status_filter", f.status);
    const page = await api.get<{
      rows: Indent[];
      total: number;
      grand_total: number;
      counts: Record<string, number>;
    }>(
      `/purchasing/indents?${params.toString()}`,
    );
    setIndents(page.rows);
    setIndentTotal(page.total);
    setIndentGrand(page.grand_total ?? page.total);
    setIndentCounts(page.counts ?? {});
  }, []);

  /** Refresh everything after an action.
   *
   *  Indents are refreshed by BUMPING A COUNTER rather than called directly:
   *  the effect that owns the fetch also owns the current search and page, so
   *  reloading through it keeps whatever the user had typed. Calling the loader
   *  here would have to pass a filter this function cannot see, and would
   *  silently throw the search away. */
  async function load() {
    const p = await api.get<POSummary[]>("/purchasing/purchase-orders");
    setPos(p);
    setIndentConsol({}); // POs may have changed → drop cached consolidations
    setRefresh((n) => n + 1);
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
          // The choice lives ON THE LINE now, so two lines of the same item
          // against different suppliers each carry their own and become two
          // purchase orders rather than overwriting each other.
          vendor_id: l.vendor_id || undefined,
          pack_level_id: l.vendor_id ? l.pack_level_id || undefined : undefined,
        })),
    };
    if (payload.items.length === 0) {
      setMsg("Pick at least one item and enter how much you need.");
      return;
    }
    try {
      await api.post("/purchasing/indents", payload);
      const n = payload.items.length;
      setLines([]); // this writes the empty basket back to the server too
      setVendorPick({});
      // It said nothing at all before — "i clicked the submit but nothing
      // happened in UI pov". The indent WAS created; the screen just never
      // mentioned it, and an action with no acknowledgement reads as a broken
      // button. Say what happened and where it went.
      setMsg(
        `Indent raised with ${n} item${n === 1 ? "" : "s"} — it is waiting for approval under Indents.`,
      );
      // Take him TO the confirmation rather than leaving it somewhere above.
      // A message you have to go looking for has not been delivered. Waits for
      // the burst so the scroll is not competing with the smoke.
      window.setTimeout(() => {
        document
          .getElementById("mise-indent-said")
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 900);
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

  // The per-line supplier override lived here, for the old picker's tray rows.
  // The pad already shows every line grouped under the supplier it will
  // actually be sent to, so the override belongs on THAT row when it is built
  // rather than surviving as a control nothing renders.
  // TODO(purchasing): re-add as an inline control on the order rows.


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
      // Carry them to what they just made.
      //
      // "once I clicked that approve button it needs to take me to the next
      // area, which is purchase orders — instead of staying here itself like a
      // dead site. We need to be playful with users bro, we should not be
      // idle." Approving an indent HAS a next step, and it is one tap away in
      // a tab nobody was looking at, so nothing appeared to happen.
      setOpenIndent(null);
      setTab("orders");
      // Show the orders that were just born, not whatever filter was left over.
      setPoFilter(EMPTY_FILTER);
      if (!res.skipped_items?.length) {
        setMsg("Approved — here are the purchase orders it created, one per supplier.");
      }
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

  /** Receive every order in one purchase run, as ordered. */
  async function receiveWholeRun(g: { pos: POSummary[] }) {
    const open = g.pos.filter((p) => p.status !== "RECEIVED");
    if (!open.length) return;
    const ok = await confirm({
      title: `Mark all ${open.length} order${open.length === 1 ? "" : "s"} as arrived?`,
      message:
        "Every line goes into stock at the quantity it was ordered. If something came up short " +
        "or the price changed, open that supplier's order instead and enter what actually arrived.",
      confirmText: "Yes, it all arrived",
    });
    if (!ok) return;

    setMsg(null);
    let done = 0;
    for (const po of open) {
      try {
        // The lines are needed to receive them, and the row only carries a
        // summary — so fetch each order's detail first.
        const full = poDetail[po.id] ?? (await api.get<POOut>(`/purchasing/purchase-orders/${po.id}`));
        await api.post(`/purchasing/purchase-orders/${po.id}/receive`, {
          lines: full.items.map((it) => ({
            po_item_id: it.po_item_id,
            received_qty: it.ordered_qty,
            unit_price: null,
          })),
          note: "Received with the whole purchase",
          update_prices: false,
        });
        done += 1;
      } catch {
        /* keep going — one bad order should not strand the rest */
      }
    }
    await load();
    setMsg(
      done === open.length
        ? `All ${done} order${done === 1 ? "" : "s"} received — stock and costs are updated.`
        : `${done} of ${open.length} received. Open the rest individually to see what went wrong.`,
    );
  }

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
      // Which item to land on. One is enough — he said so: "if so many
      // purchase means any 1 item you can choose to show".
      const landOn = recvPo.items[0]?.item_id ?? null;
      setRecvPo(null);
      setPoDetail((p) => {
        const next = { ...p };
        delete next[poId]; // drop stale copy so re-open shows received qty/status
        return next;
      });
      await load();
      // Receiving stock is the moment you want to see what it did to the item.
      // Standing still on the order you just closed is the "dead site" feeling
      // he described.
      if (landOn) {
        setOpenPo(null);
        router.push(`/inventory?item=${landOn}`);
        return;
      }
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

  // ── Finding one row without scrolling for it ────────────────────────────
  // "here I need to scroll to see any particular indent — please have a sort,
  // search, filter" and then "not only indent but also the partner purchase
  // order too". One control serves both, so the two lists cannot behave
  // differently.
  const [indentFilter, setIndentFilter] = useListFilter("indents");
  const [poFilter, setPoFilter] = useListFilter("pos");

  const matchedIndents = useMemo(
    () =>
      applyFilter(indents, { ...indentFilter, q: "", status: "all" }, (i) => ({
        // Searchable by date, status AND what is in it — "the one with the
        // lemons" is how people actually remember an order.
        text: `${i.date} ${i.status} ${i.items.map((x) => `${x.item_name} ${x.vendor_name ?? ""}`).join(" ")}`,
        status: i.status,
        date: i.date,
        value: indentConsol[i.id]?.grand_total
          ? parseFloat(indentConsol[i.id].grand_total)
          : 0,
      })),
    [indents, indentFilter, indentConsol],
  );
  // The server did the filtering, so what came back IS the page.
  const shownIndents = indents;

  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadIndents(indentFilter).catch(() => {
        /* a failed refetch leaves the last good page on screen */
      });
    }, 250);
    return () => window.clearTimeout(t);
  }, [indentFilter, refresh, loadIndents]);

  /** The bucket a purchase order is in, as a person would name it.
   *
   *  NOT its raw status. A PO's status is DRAFT / SENT / RECEIVED, and the chip
   *  filtered on "ORDERED" — a value that does not exist — so it counted 15 and
   *  then showed "0 of 45". The count and the filter have to be the same
   *  function or they will disagree again. */
  const poBucket = useCallback(
    (p: POSummary) => {
      if (p.status === "RECEIVED") return "RECEIVED";
      return "WAITING";
    },
    [todayStr],
  );

  /** Late is a FLAG on an order, not a place it goes. */
  const isLate = useCallback(
    (p: POSummary) =>
      p.status !== "RECEIVED" && !!p.expected_delivery && p.expected_delivery < todayStr,
    [todayStr],
  );

  const matchedPos = useMemo(
    () =>
      applyFilter(pos, poFilter, (p) => ({
        text: `${p.po_number} ${p.vendor_name ?? ""} ${p.status}`,
        // "LATE" is offered as a filter, but an order in it is ALSO still to
        // arrive — so it answers to both rather than disappearing from one.
        status: poFilter.status === "LATE" ? (isLate(p) ? "LATE" : "_") : poBucket(p),
        // Sort by WHEN THE ORDER WAS RAISED, not by when it is due.
        //
        // This was `expected_delivery ?? po_number`, which caused both of the
        // things he reported. The dates looked scrambled because some orders
        // sorted by a delivery date and others by a PO number. And setting a
        // promise date physically MOVED an order to a different position —
        // "now I'm going to give promise as 12, yesterday... now see, that PO
        // itself gone." It had not gone anywhere; it had been re-sorted to
        // somewhere he was not looking.
        //
        // PO numbers are sequential (PO-2026-061), so they ARE the order of
        // creation, and changing a delivery date can no longer move a row.
        // SORT BY THE DATE THE ROW SHOWS. He said it plainly: "it's confusing
        // even me, then think about laymen." An order sorted by a date that is
        // not on screen can only look random, whichever field it is.
        //
        // The run header shows the purchase date, so that is what orders by.
        // What you see is what it is sorted by, and nothing can move a row
        // except the thing printed on it. (Falling back to the PO number, which
        // is sequential, when an order has no indent behind it.)
        date: p.indent_date ?? p.po_number,
        value: parseFloat(p.total_amount || "0"),
      })),
    [pos, poFilter, poBucket, isLate],
  );
  const shownPos = useMemo(() => pageOf(matchedPos, poFilter), [matchedPos, poFilter]);

  const indentStatuses = useMemo(() => {
    const n = (st: string) => indentCounts[st] ?? 0;
    return [
      { key: "PENDING", label: "Awaiting approval", count: n("PENDING"), tone: "warn" as const },
      // He asked what this was twice, and the second time was my answer's
      // fault: "approved · nothing ordered" reads like a THIRD step between
      // awaiting and ordered. It is not a step at all — it is a failure. The
      // indent was signed off and no purchase order could be raised because no
      // active vendor prices those items. So it is named for the problem, and
      // coloured like one.
      {
        key: "APPROVED",
        label: "Stuck · no supplier",
        count: n("APPROVED"),
        tone: "bad" as const,
        hint:
          "Approved, but no purchase order could be raised because no active vendor prices those items. Rare on purpose — it only happens if you approve an indent for something nobody sells you.",
      },
      { key: "ORDERED", label: "Ordered", count: n("ORDERED") },
      { key: "REJECTED", label: "Rejected", count: n("REJECTED") },
    ].filter((x) => x.count > 0);
  }, [indentCounts]);

  const poStatuses = useMemo(() => {
    const n = (b: string) => pos.filter((p) => poBucket(p) === b).length;
    // Named for what they mean to a person. "With suppliers" was my phrase and
    // he was right to ask what it meant — "still to arrive" is the actual
    // question, and "late" is the one you act on.
    return [
      {
        key: "LATE",
        label: "Late",
        count: pos.filter(isLate).length,
        tone: "bad" as const,
        hint: "Past the date the supplier promised. These are still under 'Still to arrive' too — late is a warning on an order, not a different place it lives.",
      },
      {
        key: "WAITING",
        label: "Still to arrive",
        count: n("WAITING"),
        hint: "Ordered and not yet received, including anything that is late.",
      },
      {
        key: "RECEIVED",
        label: "Arrived",
        count: n("RECEIVED"),
        hint: "Received into stock. Costs and stock levels are updated.",
      },
    ].filter((x) => x.count > 0);
  }, [pos, poBucket, isLate]);

  // "also I need one filter like multi vendor / single vendor" — a purchase run
  // that split across four suppliers is a different kind of thing from one that
  // went to a single supplier, and you chase them differently.
  const [runSize, setRunSize] = useState<"all" | "single" | "multi">("all");

  /** Which purchase runs are opened out into their per-supplier orders. The
   *  consolidated line is the default view; the split is on request. */
  /** The indent whose whole purchase is being read as one document. */
  const [runSheet, setRunSheet] = useState<string | null>(null);
  const [runSort, setRunSort] = useState<"vendor" | "price" | "name">("vendor");
  const [runQ, setRunQ] = useState("");

  async function openRunSheet(indentId: string) {
    setRunSheet(indentId);
    setRunQ("");
    if (!indentConsol[indentId]) {
      try {
        const c = await api.get<Consolidated>(`/purchasing/indents/${indentId}/consolidated`);
        setIndentConsol((m) => ({ ...m, [indentId]: c }));
      } catch {
        /* the sheet says so rather than showing a lie */
      }
    }
  }

  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const toggleRun = (key: string) =>
    setOpenRuns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const poGroups = useMemo(() => {
    const byIndent = new Map<string, POSummary[]>();
    const order: string[] = [];
    for (const po of shownPos) {
      const key = po.indent_id ?? "__none__";
      if (!byIndent.has(key)) { byIndent.set(key, []); order.push(key); }
      byIndent.get(key)!.push(po);
    }
    return order.map((key) => {
      const groupPos = byIndent.get(key)!;
      const total = groupPos.reduce((s, p) => s + parseFloat(p.total_amount || "0"), 0);
      const indent = key === "__none__" ? null : indents.find((i) => i.id === key) ?? null;
      // The date comes off the ORDER when the indent is not on the current
      // page — which, with ten rows to a page, is almost always.
      const runDate = indent?.date ?? groupPos.find((p) => p.indent_date)?.indent_date ?? null;
      const vendorCount = new Set(groupPos.map((p) => p.vendor_id)).size;
      return { key, indentId: key === "__none__" ? null : key, pos: groupPos, total, indent, runDate, vendorCount };
    }).filter((g) =>
      runSize === "all"
        ? true
        : runSize === "single"
          ? g.vendorCount <= 1
          : g.vendorCount > 1,
    );
  }, [shownPos, indents, runSize]);

  /** Items by id, so a sheet can price a line without searching the array. */
  const itemById = useMemo(
    () => Object.fromEntries(items.map((i) => [i.id, i])) as Record<string, Item>,
    [items],
  );

  if (loading) return <Spinner />;

  // Only items a vendor actually prices can be ordered — keeps the chain honest.
  const orderable = items.filter((it) => (it.vendor_count ?? 0) > 0);

  return (
    <Workbench
      title="Purchasing"
      subtitle="Kitchen indents → vendor-wise purchase orders."
      // No page action. "+ New order" top-right did exactly what the first tab
      // does, one inch away from it — "remove it, it's a dead button".
      action={undefined}
      tools={
          <SubNav
            active={tab}
            items={[
              ...(canWrite
                ? [{ key: "new", label: "New order", shortLabel: "New", icon: "＋", onSelect: () => setTab("new") }]
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
                label: "Orders",
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
      {/* "that (Approved — here are the purchase orders it created) is also not
          nice to see, it's very plain text UI." It was a tinted paragraph.
          Something just HAPPENED — the message should arrive like it. */}
      {msg && (
        <div className="mise-card3d mise-card3d-wide mise-say relative mb-4 flex items-start gap-3 overflow-hidden px-4 py-3" id="mise-indent-said">
          <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-brand-400" />
          <span
            aria-hidden
            className="mise-pocket-bump grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-500/15 text-base"
          >
            ✓
          </span>
          <p className="min-w-0 flex-1 pt-1 text-sm font-medium text-fg">{msg}</p>
          <button
            type="button"
            onClick={() => setMsg(null)}
            aria-label="Dismiss"
            className="mise-press -mr-1 shrink-0 rounded-lg px-1.5 py-1 text-fg-faint transition hover:text-fg"
          >
            <span className="mise-say-x block">✕</span>
          </button>
        </div>
      )}

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

      {/* One job on screen at a time. Everything is one tap away; nothing is
          reachable only by scrolling. */}
      {/* The same SubNav every other section uses, so Purchasing stops being
          the odd one out — and the counts now say what needs attention rather
          than just how many exist. */}

      {/* The pipeline goes FIRST — "keep this one in top, i mean that status
          thing". It answers "where is everything" before you start adding to
          the next order, which is the right order to think in.
          The tiles were flat wells; they are raised now, with a real shadow and
          a ring, so each one reads as its own card. */}
      {/* ── The purchasing pipeline — where every order sits, at a glance ── */}
      {/* ── Where everything is, in one bar ──────────────────────────────
          "this top portion needs complete redesigning... that status tracking
          also not good to see. Previously we had, it is nice, but that took a
          lot of space so we made it like this. Just think in different
          perspectives."

          The different perspective: there were TWO rows saying the same thing —
          a chip row (6 awaiting · 0 overdue · 13 in flight · £1,856 committed)
          and a pipeline (6 raised → 2 approved → 13 out → 26 received). Four
          numbers each, three of them shared. So it was not too big, it was said
          twice.

          One bar now, and it is not a readout — it is the WAY THROUGH the page.
          Every stage is the filter for that stage, so the status and the
          navigation are the same object and neither costs extra height. On a
          phone it becomes a 2x2 grid rather than something you drag sideways —
          "this status in mobile is showing horizontal scroll because of no
          space". A status you have to scroll to read is not a status. */}
      {(indents.length > 0 || pos.length > 0) && (() => {
        const today = localISODate();
        const openPos = pos.filter((x) => x.status !== "RECEIVED");
        const overdue = openPos.filter(
          (x) => x.expected_delivery && x.expected_delivery < today,
        ).length;
        const committed = openPos.reduce((sum, x) => sum + (parseFloat(x.total_amount) || 0), 0);
        const stages: {
          icon: string; n: number; label: string; tone: string;
          go: "indents" | "orders"; alert?: string; why: string;
        }[] = [
          {
            icon: "📝",
            n: indents.filter((x) => x.status === "PENDING").length,
            label: "waiting for you to approve",
            tone: "text-amber-300",
            go: "indents",
            why: "Someone in the kitchen asked for these. Nothing has been ordered yet — they are waiting for you to say yes.",
          },
          {
            icon: "✅",
            n: indents.filter((x) => x.status === "APPROVED").length,
            label: "approved, nothing ordered",
            tone: "text-rose-300",
            go: "indents",
            why: "You approved these, but no purchase order could be raised — no active vendor prices those items. Set a price on Vendors and try again. Normally this is zero.",
          },
          {
            icon: "🚚",
            n: openPos.length,
            label: "ordered, not arrived",
            tone: "text-sky-300",
            go: "orders",
            alert: overdue > 0 ? `${overdue} late` : undefined,
            why: "Purchase orders are with your suppliers and the goods have not come in yet. 'Late' means the date they promised has passed.",
          },
          {
            icon: "🏠",
            n: pos.filter((x) => x.status === "RECEIVED").length,
            label: "arrived, in your stock",
            tone: "text-emerald-300",
            go: "orders",
            why: "Received. Stock levels and average costs have been updated from these.",
          },
        ];
        return (
          <div className="mise-card3d mise-card3d-wide mb-4 p-2.5">
            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:items-stretch sm:gap-0">
              {stages.map((st, i) => (
                <div key={st.label} className="flex min-w-0 flex-1 items-center">
                  <button
                    type="button"
                    onClick={() => setTab(st.go)}
                    title={st.why}
                    className="mise-press group min-w-0 flex-1 rounded-xl px-2.5 py-2 text-left transition hover:bg-glass/[0.06]"
                  >
                    <span className="flex items-baseline gap-1.5">
                      <span aria-hidden className="text-sm">{st.icon}</span>
                      <span className={`font-display text-xl font-semibold leading-none tabular-nums ${st.tone}`}>
                        {st.n}
                      </span>
                      {st.alert && (
                        <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                          {st.alert}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-fg-faint">
                      {st.label}
                    </span>
                  </button>
                  {/* The flow, drawn — it is a pipeline, so it should look like
                      one. Hidden on the phone grid, where the arrows would
                      point at the wrong neighbours. */}
                  {i < stages.length - 1 && (
                    <span aria-hidden className="hidden shrink-0 px-1 text-fg-faint/50 sm:block">
                      →
                    </span>
                  )}
                </div>
              ))}
              <div className="col-span-2 mt-1 flex items-center justify-between gap-2 border-t border-line/60 px-2.5 pt-2 sm:col-auto sm:mt-0 sm:flex-col sm:items-end sm:justify-center sm:border-l sm:border-t-0 sm:pl-3 sm:pt-0">
                <span className="text-[11px] text-fg-faint">committed</span>
                <span className="font-display text-lg font-semibold tabular-nums text-fg">
                  {format(String(committed))}
                </span>
              </div>
            </div>
          </div>
        );
      })()}

      {canWrite && tab === "new" && (
        <Card className="mb-4 p-3 sm:p-4" id="indent-form">
          {orderable.length === 0 ? (
            <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              No orderable items yet — add a vendor price for at least one item on the <b>Vendors</b> page.
            </p>
          ) : (
          <form onSubmit={submitIndent} className="space-y-3">
            {/* Submit lives INSIDE the tray. It used to sit under the whole
                picker, so the more you ordered the further away it got. */}
            {/* The order pad. See docs/PURCHASING_REDESIGN.md.
                What this replaces was a catalogue: search, category chips, and
                sixty rows to scroll and scan — for someone who already knows
                they need onions. Ordering is not shopping, it is writing a
                list, and his constraint was that picking must never scroll.

                So: type "onion 25" and it is done, or tap one level into a
                category whose items fit the panel as tiles. The order builds
                beside you, grouped by the supplier it will actually be sent
                to, with the money live. */}
            {/* The flow he described, layer by layer:
                  categories -> a category's items as a POPUP
                             -> an item as a POPUP ON TOP
                                -> how many, and in which size
                                   -> "Add to basket" BURSTS it into a bubble
                                      that shrinks across into the basket
                  and the basket opens on tap with the full detail.
                See docs/PURCHASING_REDESIGN.md. */}
            <OrderFlow
              items={orderable}
              suppliers={suppliers}
              lines={lines}
              onChange={setLines}
              onAddAllLow={orderAllLow}
              vendorPick={vendorPick}
              formPick={formPick}
              // For THIS order only — `is_preferred` is never written, so the
              // ★ chosen supplier survives untouched. The server applies the
              // same precedence when it splits the indent: picked, then chosen,
              // then cheapest.
              onVendorPick={(itemId, vendorId, packLevelId) => {
                setVendorPick((p) => {
                  const next = { ...p };
                  if (vendorId) next[itemId] = vendorId;
                  else delete next[itemId];
                  return next;
                });
                setFormPick((p) => {
                  const next = { ...p };
                  if (vendorId) next[itemId] = packLevelId;
                  else delete next[itemId];
                  return next;
                });
              }}
              footer={
                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={lines.length === 0}
                    // The form still submits; this only makes the basket come
                    // apart as it goes, so you land back on the page having SEEN
                    // the order leave rather than finding the panel gone.
                    onClick={() => { if (lines.length) void burstBasket(); }}
                    className="mise-btn-key mise-press flex-1 px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
                  >
                    Submit indent · {lines.length}
                  </button>
                  <button
                    type="button"
                    onClick={resetIndent}
                    className="mise-btn mise-press px-4 py-2.5 text-sm font-medium text-fg-soft"
                  >
                    Clear
                  </button>
                </div>
              }
            />
          </form>
          )}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6">
        {/* Indents — tap a row to see its items, suppliers and the approve action. */}
        <Card className={`overflow-hidden p-0 ${tab === "indents" ? "" : "hidden"}`}>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="font-semibold text-fg">Indents</h3>
            <span className="text-xs text-fg-faint">{indentGrand} total</span>
          </div>
          <ListControls
            value={indentFilter}
            onChange={setIndentFilter}
            statuses={indentStatuses}
            placeholder="Search by date, status or what is in it…"
            total={indentGrand}
            shown={indentTotal}
          />
          <div className="mise-sheet-cascade space-y-2 p-3">
            {shownIndents.length === 0 ? (
              <p className="py-10 text-center text-sm text-fg-faint">
                {indentTotal === 0 ? "Nothing matches that." : "No indents yet."}
              </p>
            ) : (
              shownIndents.map((ind) => {
                const open = openIndent === ind.id;
                return (
                  <button
                    key={ind.id}
                    type="button"
                    onClick={() => toggleIndent(ind)}
                    aria-expanded={open}
                    className={`mise-card3d mise-press flex w-full items-center gap-3 border px-4 py-3 text-left ${
                      ind.status === "PENDING"
                        ? "border-amber-400/30 !bg-amber-400/[0.07]"
                        : "border-line hover:border-line-2"
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
          <Pager value={indentFilter} onChange={setIndentFilter} matched={indentTotal} />
        </Card>

        {/* Purchase orders — same tap-to-expand; line items load on open, no side-scroll. */}
        <Card className={`overflow-hidden p-0 ${tab === "orders" ? "" : "hidden"}`}>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="font-semibold text-fg">Purchase orders</h3>
            <span className="text-xs text-fg-faint">{pos.length} total</span>
          </div>
          <ListControls
            value={poFilter}
            onChange={setPoFilter}
            statuses={poStatuses}
            placeholder="Search by PO number, supplier or status…"
            total={pos.length}
            shown={matchedPos.length}
          />
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
            <span className="mr-0.5 text-[11px] text-fg-faint">purchase runs</span>
            {([
              ["all", "any"],
              ["single", "one supplier"],
              ["multi", "split across suppliers"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setRunSize(k)}
                className={`mise-press rounded-full px-2.5 py-1 text-[11px] transition ${
                  runSize === k
                    ? "bg-brand-500 font-semibold text-white"
                    : "border border-line text-fg-soft hover:border-brand-400/40"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="space-y-3 p-3">
            {matchedPos.length === 0 || poGroups.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm text-fg-faint">
                  {pos.length === 0
                    ? "No purchase orders yet."
                    : "Nothing here matches the filters."}
                </p>
                {/* An order that leaves the visible list because of a filter
                    reads as an order that was DELETED. "I gave date as
                    yesterday and suddenly that PO disappeared, can't find it
                    anywhere." It was under Late all along. Say so, and give
                    him the way back in one press. */}
                {pos.length > 0 && (
                  <>
                    <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-fg-faint">
                      {pos.length} order{pos.length === 1 ? "" : "s"} exist — the filters above are
                      hiding {pos.length - matchedPos.length} of them. Setting a delivery date in the
                      past moves an order into <b className="text-rose-300">Late</b>, which is a
                      different filter from <b className="text-fg-soft">Still to arrive</b>.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setPoFilter(EMPTY_FILTER);
                        setRunSize("all");
                      }}
                      className="mise-btn mise-press mt-3 px-3 py-1.5 text-xs font-semibold text-brand-300"
                    >
                      Show me every order
                    </button>
                  </>
                )}
              </div>
            ) : (
              poGroups.map((g) => (
              <div key={g.key} className="mise-card3d relative overflow-hidden p-3 pl-4">
                {(() => {
                  const late = g.pos.filter(
                    (p) => p.status !== "RECEIVED" && p.expected_delivery && p.expected_delivery < todayStr,
                  ).length;
                  const arrived = g.pos.filter((p) => p.status === "RECEIVED").length;
                  const done = arrived === g.pos.length;
                  return (
                    <span
                      aria-hidden
                      className={`absolute inset-y-0 left-0 w-1 ${
                        late > 0 ? "bg-rose-400" : done ? "bg-emerald-400" : "bg-sky-400"
                      }`}
                    />
                  );
                })()}
                {/* THE CONSOLIDATED VIEW. A purchase run is one purchase that
                    happened to be split by supplier, so it is headed like one
                    thing — what it cost, how far along it is, one PDF for all
                    of it — and the per-supplier orders fold away underneath. */}
                {/* NOT a button wrapping buttons. It was role="button" with
                    three <button>s inside it — invalid markup, and the browser
                    ran the outer handler instead of the inner ones, so his
                    download / list / receive icons did nothing at all however
                    many times he pressed them. The toggle is its own control
                    now and the actions are simply buttons. */}
                <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => toggleRun(g.key)}
                    aria-expanded={openRuns.has(g.key)}
                    className="mise-press flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      aria-hidden
                      className={`text-[10px] text-fg-faint transition-transform ${
                        openRuns.has(g.key) ? "rotate-90" : ""
                      }`}
                    >
                      ▶
                    </span>
                    <span className="min-w-0">
                      {/* The DATE is what identifies a run, so it must never be
                          the part that gets cut. On a phone "Purchase · 2026-08-11"
                          truncated to "Purchase…", which named nothing. The word
                          wraps away instead; the date stays whole. */}
                      <span className="block font-display text-base font-semibold leading-tight text-fg">
                        {g.runDate ? (
                          <>
                            <span className="hidden sm:inline">Purchase · </span>
                            <span className="tabular-nums">{g.runDate}</span>
                          </>
                        ) : (
                          "Orders with no indent"
                        )}
                      </span>
                      <span className="block text-[11px] text-fg-faint">
                        {g.pos.length} order{g.pos.length === 1 ? "" : "s"} ·{" "}
                        {g.vendorCount} supplier{g.vendorCount === 1 ? "" : "s"} ·{" "}
                        {(() => {
                          const arrived = g.pos.filter((p) => p.status === "RECEIVED").length;
                          return arrived === g.pos.length
                            ? "all arrived"
                            : `${arrived} of ${g.pos.length} arrived`;
                        })()}
                      </span>
                    </span>
                  </button>
                  {/* Money, then a gap, then the actions — and the actions are
                      ICONS with a tooltip rather than two labels fighting for
                      the same inch. "See everything, consolidated button, price,
                      all are very nearby which is making the UI clumsy and
                      giving an awkward feel." The price is the headline here;
                      the buttons are things you might do to it, so they get to
                      be quieter and to stand apart. */}
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <span className="block font-display text-lg font-semibold leading-none tabular-nums text-fg">
                        {format(String(g.total.toFixed(2)))}
                      </span>
                      <span className="block text-[10px] text-fg-faint">the whole purchase</span>
                    </span>
                    {g.indentId && (
                      <span className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void openRunSheet(g.indentId as string);
                        }}
                        title="Every supplier and every line on this purchase, in one list"
                        aria-label="See every line on this purchase"
                        className="mise-btn mise-press grid h-8 w-8 shrink-0 place-items-center text-sm text-fg-soft"
                      >
                        ☰
                      </button>
                      <button
                        type="button"
                        onClick={() => downloadFile(`/purchasing/indents/${g.indentId}/consolidated.pdf`, `consolidated-${g.runDate ?? "po"}.pdf`)}
                        title="One PDF for this whole purchase — every supplier, every item"
                        aria-label="Download one PDF for this whole purchase"
                        onClickCapture={(e) => e.stopPropagation()}
                        className="mise-btn mise-press grid h-8 w-8 shrink-0 place-items-center text-sm text-brand-300"
                      >
                        ⤓
                      </button>
                      {/* One press for a delivery day. The paperwork is one
                          order per supplier; the van is not. */}
                      {canApprove && g.pos.some((p) => p.status !== "RECEIVED") && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void receiveWholeRun(g);
                          }}
                          title="Mark every order in this purchase as arrived"
                          aria-label="Receive this whole purchase into stock"
                          className="mise-btn mise-press grid h-8 w-8 shrink-0 place-items-center text-sm text-emerald-300"
                        >
                          ✓
                        </button>
                      )}
                      </span>
                    )}
                  </span>
                </div>
                {openRuns.has(g.key) && (
                <div className="space-y-2">
              {g.pos.map((po) => {
                const open = openPo === po.id;
                const detail = poDetail[po.id];
                const busy = poBusy === po.id;
                return (
                  <div key={po.id} className={`mise-card3d overflow-hidden border transition ${
                    po.status !== "RECEIVED" && po.expected_delivery && po.expected_delivery < todayStr
                      ? "border-rose-400/30 !bg-rose-400/[0.06]"
                      : "border-line hover:border-line-2"
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
                )}
              </div>
              ))
            )}
          </div>
          <Pager value={poFilter} onChange={setPoFilter} matched={matchedPos.length} />
        </Card>
      </div>

      {recvPo && (
        <div
          /* z-[150]: this opens FROM the purchase-order sheet, so it has to sit
             above it. At z-50 it tied with the sheet (DetailSheet is 50 +
             depth*10) and lost on document order — which is why pressing
             "Receive into stock" looked like it did nothing and he had to close
             the sheet to find the dialog waiting underneath. Third time he has
             reported this shape of bug; the confirm dialog had it too. */
          className="fixed inset-0 z-[150] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
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

            {/* Scan the vendor bill → auto-fill received qty + new prices. */}
            <div className="mb-4 rounded-xl border border-brand-500/30 bg-brand-500/[0.05] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-fg">📷 Scan the vendor bill <span className="text-fg-faint">(optional)</span></span>
                <label className="cursor-pointer rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-300 hover:bg-brand-500/20">
                  {recvScanBusy ? "Reading…" : "Upload bill"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={recvScanBusy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) scanBill(f); e.currentTarget.value = ""; }}
                  />
                </label>
              </div>
              {/* "who does the bill scan?" — named, and named accurately. It
                  is the same assistant that answers questions elsewhere in the
                  app; there is no second document service any more. */}
              <p className="mt-1 text-[11px] leading-relaxed text-fg-faint">
                Read by the <b className="text-fg-soft">DineAI assistant</b>. It is given{" "}
                <b className="text-fg-soft">this order&apos;s own lines</b>, so it matches what is on the bill to what
                you actually ordered, and fills in what arrived and the{" "}
                <b className="text-fg-soft">price actually charged</b>. It only suggests: nothing changes until you
                press Receive, and the old prices stay in each item&apos;s{" "}
                <b className="text-fg-soft">price history</b>.
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
            ? (() => {
                const ordered = indentConsol[openIndentObj.id]?.po_count;
                // A PENDING indent has no purchase orders, so it has no ordered
                // value — but it is not unknowable. Price it from the same
                // supplier prices the order form used, and say it is an
                // estimate. "What will this cost me" is the entire question you
                // open a pending indent to answer.
                const estimate = openIndentObj.items.reduce((t, it) => {
                  const item = itemById[it.item_id];
                  const sup = suppliers[it.item_id]?.[0];
                  if (!item || !sup) return t;
                  return t + (parseFloat(it.required_qty) || 0) * pricePerBase(item, sup);
                }, 0);
                const wouldSupply = new Set(
                  openIndentObj.items
                    .map((it) => it.vendor_name || suppliers[it.item_id]?.[0]?.vendor_name)
                    .filter(Boolean),
                ).size;
                const noPrice = openIndentObj.items.filter(
                  (it) => !suppliers[it.item_id]?.length,
                ).length;
                return [
                  {
                    label: ordered ? "Value" : "About",
                    value: ordered
                      ? format(indentConsol[openIndentObj.id].grand_total)
                      : estimate > 0
                        ? format(estimate.toFixed(2))
                        : "—",
                    hint: ordered
                      ? "ordered"
                      : estimate > 0
                        ? "estimate at today's prices"
                        : "no supplier prices these",
                  },
                  {
                    label: "Items",
                    value: openIndentObj.items.length,
                    hint: noPrice > 0 ? `${noPrice} with no supplier` : "on this request",
                    tone: noPrice > 0 ? ("warn" as const) : undefined,
                  },
                  {
                    label: "Suppliers",
                    value: indentConsol[openIndentObj.id]?.vendor_count ?? wouldSupply,
                    hint: ordered ? "supplying this" : "would supply it",
                  },
                ];
              })()
            : undefined
        }
      >
        {openIndentObj && (
          <div>
                      <div className="mise-pop space-y-3 border-t border-line px-4 py-3">
                        {/* A stuck indent has to say WHY it is stuck and offer
                            the way out, or the status is just a word. */}
                        {openIndentObj.status === "APPROVED" && (
                          <div className="mise-card3d relative overflow-hidden p-3 pl-4">
                            <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-rose-400" />
                            <p className="text-sm font-semibold text-fg">
                              Approved, but nothing could be ordered
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-fg-soft">
                              A purchase order can only be raised for an item some active
                              vendor prices. Nobody prices these yet, so this indent is
                              signed off and waiting. Set a price on{" "}
                              <b className="text-brand-300">Vendors</b>, then try again —
                              nothing is lost in the meantime.
                            </p>
                            {canApprove && (
                              <button
                                type="button"
                                onClick={() => generate(openIndentObj.id)}
                                className="mise-btn-key mise-press mt-2.5 px-3 py-1.5 text-xs font-semibold"
                              >
                                Try creating the purchase orders again
                              </button>
                            )}
                          </div>
                        )}
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
                              className="mise-btn mise-press mt-2.5 w-full px-3 py-2 text-sm font-semibold text-brand-300"
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
      {/* ── The whole purchase, as one document ─────────────────────────
          Split across suppliers is how it must be ORDERED; it is not how you
          want to READ it. Here every line from every supplier is one list you
          can search and sort — which is the only way to answer "what did this
          purchase actually buy, and where is the money going". */}
      <DetailSheet
        open={!!runSheet}
        onClose={() => setRunSheet(null)}
        width="lg"
        icon="🧾"
        title="The whole purchase"
        subtitle={
          runSheet && indentConsol[runSheet]
            ? `${indentConsol[runSheet].vendor_count} supplier${indentConsol[runSheet].vendor_count === 1 ? "" : "s"} · ${indentConsol[runSheet].item_count} line${indentConsol[runSheet].item_count === 1 ? "" : "s"} · ${format(indentConsol[runSheet].grand_total)}`
            : "loading…"
        }
      >
        {runSheet && !indentConsol[runSheet] ? (
          <p className="px-4 py-8 text-center text-sm text-fg-faint">Loading the lines…</p>
        ) : runSheet && indentConsol[runSheet] ? (
          (() => {
            const c = indentConsol[runSheet];
            const lines = c.vendors.flatMap((v) =>
              v.items.map((it) => ({ ...it, vendor: v.vendor_name, po: v.po_number })),
            );
            const q = runQ.trim().toLowerCase();
            const shown = lines
              .filter((l) => !q || l.item_name.toLowerCase().includes(q) || l.vendor.toLowerCase().includes(q))
              .sort((a, b) =>
                runSort === "price"
                  ? (parseFloat(b.line_total) || 0) - (parseFloat(a.line_total) || 0)
                  : runSort === "name"
                    ? a.item_name.localeCompare(b.item_name)
                    : a.vendor.localeCompare(b.vendor) || a.item_name.localeCompare(b.item_name),
              );
            return (
              <div className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={runQ}
                    onChange={(e) => setRunQ(e.target.value)}
                    placeholder="Find an item or a supplier…"
                    className="mise-well min-w-0 flex-1 rounded-xl px-3 py-2 text-sm text-fg outline-none"
                  />
                  <span className="mise-well flex shrink-0 gap-1 rounded-xl p-1">
                    {([
                      ["vendor", "by supplier"],
                      ["price", "dearest"],
                      ["name", "A–Z"],
                    ] as const).map(([k, label]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setRunSort(k)}
                        className={`mise-press rounded-lg px-2.5 py-1 text-[11px] transition ${
                          runSort === k ? "mise-btn-key font-semibold" : "text-fg-soft"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                </div>

                <p className="text-[11px] text-fg-faint">
                  showing <b className="text-fg-soft">{shown.length}</b> of {lines.length} lines
                </p>

                <ul className="space-y-1.5">
                  {shown.map((l, i) => (
                    <li key={`${l.po}-${l.item_name}-${i}`} className="mise-card3d flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{l.item_name}</span>
                        <span className="block truncate text-[11px] text-fg-faint">
                          {l.vendor} · {l.po} · {fmtQty(l.ordered_qty, "")} at {format(l.unit_price)} each
                        </span>
                      </span>
                      <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-fg">
                        {format(l.line_total)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
                  <span className="text-xs text-fg-faint">
                    every supplier, every line on this purchase
                  </span>
                  <span className="font-display text-xl font-semibold tabular-nums text-fg">
                    {format(c.grand_total)}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => downloadFile(`/purchasing/indents/${runSheet}/consolidated.pdf`, `consolidated-${runSheet}.pdf`)}
                  className="mise-btn-key mise-press w-full px-4 py-2.5 text-sm font-semibold"
                >
                  Download all of it as one PDF
                </button>
              </div>
            );
          })()
        ) : null}
      </DetailSheet>

      <DetailSheet
        open={!!openPoObj}
        onClose={() => setOpenPo(null)}
        width="lg"
        title={openPoObj ? openPoObj.po_number : ""}
        subtitle={openPoObj ? `${openPoObj.vendor_name} · ${openPoObj.status.toLowerCase()}` : ""}
      >
        {openPoObj && (
          <div className="space-y-4 px-4 py-3">
            {/* ── The heading of a document, not four tiles in a row ──────
                What it is worth and who it is with, once, at the size that
                says which is the headline. */}
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-line pb-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wide text-fg-faint">
                  {openPoObj.status === "RECEIVED" ? "Received from" : "Ordered from"}
                </p>
                <p className="truncate font-display text-lg font-semibold text-fg">
                  {openPoObj.vendor_name || "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wide text-fg-faint">
                  {openPoDetail ? `${openPoDetail.items.length} line${openPoDetail.items.length === 1 ? "" : "s"}` : "value"}
                </p>
                <p className="font-display text-2xl font-semibold leading-none tabular-nums text-fg">
                  {format(openPoObj.total_amount)}
                </p>
              </div>
            </div>

            {/* ── What is on it ─────────────────────────────────────────── */}
            {openPoBusy && !openPoDetail ? (
              <p className="py-6 text-center text-sm text-fg-faint">Loading the lines…</p>
            ) : openPoDetail && openPoDetail.items.length > 0 ? (
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {openPoDetail.items.map((it) => (
                  <li key={it.item_id} className="mise-card3d p-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 flex-1 truncate font-medium text-fg">
                        {it.item_name}
                      </span>
                      <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-fg">
                        {format(it.line_total)}
                      </span>
                    </div>
                    {/* "just showing 1 x 30 is not clear — we need to explain
                        clearly to a layman." So the line reads as a sentence. */}
                    <p className="mt-0.5 text-[11px] text-fg-faint">
                      {fmtQty(it.ordered_qty, it.unit ?? "")} at {format(it.unit_price)} each
                      {it.pack_note ? ` · ${it.pack_note}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-fg-faint">No lines on this order.</p>
            )}

            {/* ── When it is due ────────────────────────────────────────────
                "what is this 'when did they promise it', what's the use of
                this feature, explain me with example." Now it does, with one. */}
            {openPoObj.status !== "RECEIVED" && canApprove && (
              <div className="rounded-2xl border border-line bg-paper-2/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="po-promised"
                    className="text-sm font-medium text-fg"
                  >
                    When did the supplier promise it?
                  </label>
                  <input
                    id="po-promised"
                    type="date"
                    value={openPoObj.expected_delivery ?? ""}
                    onChange={async (e) => {
                      const v = e.target.value || null;
                      try {
                        await api.patch(`/purchasing/purchase-orders/${openPoObj.id}`, { expected_delivery: v });
                        setPos((list) => list.map((x) => (x.id === openPoObj.id ? { ...x, expected_delivery: v } : x)));
                        // Tell him where it just went. A date in the past moves
                        // the order into Late, and silently leaving the list he
                        // was looking at is indistinguishable from being deleted.
                        if (v && v < todayStr) {
                          setMsg(
                            `${openPoObj.po_number} is now counted as Late — that date has already passed. Find it under the Late filter on this page.`,
                          );
                        }
                      } catch { /* leave as-was */ }
                    }}
                    className="mise-well rounded-xl px-2.5 py-1.5 text-sm text-fg outline-none"
                  />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-fg-soft">
                  {openPoObj.expected_delivery ? (
                    <>
                      They said <b className="text-fg">{openPoObj.expected_delivery}</b>. From the
                      morning after that, this order is counted <b className="text-rose-300">Late</b> —
                      it moves into the Late filter on this page and the dashboard starts asking about
                      it, so nobody has to remember to chase.
                    </>
                  ) : (
                    <>
                      For example: today you order 20kg of onions and the supplier says Friday. Put
                      Friday here. If Friday passes and nothing has arrived, this order turns up under{" "}
                      <b className="text-fg">Late</b> by itself. Leave it empty and the order can never
                      be flagged — nothing will remind you it is missing.
                    </>
                  )}
                </p>
              </div>
            )}

            {/* ── What you can do about it ──────────────────────────────────
                One row, equal weights, primary action first. */}
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {openPoObj.status !== "RECEIVED" && canApprove && openPoDetail && (
                <button
                  type="button"
                  onClick={() => openReceive(openPoDetail)}
                  className="mise-btn-key mise-press flex-1 px-4 py-2.5 text-sm font-semibold"
                >
                  Receive into stock
                </button>
              )}
              <button
                type="button"
                onClick={() => downloadFile(`/purchasing/purchase-orders/${openPoObj.id}/pdf`, `${openPoObj.po_number}.pdf`)}
                className="mise-btn mise-press px-4 py-2.5 text-sm font-medium text-fg-soft"
              >
                Download PDF
              </button>
              {openPoObj.status !== "RECEIVED" && canApprove && (
                <button
                  type="button"
                  onClick={() => revertPo(openPoObj)}
                  title="Cancel this order and put its items back on the indent"
                  className="mise-btn mise-press px-4 py-2.5 text-sm font-medium text-fg-soft"
                >
                  Back to indent
                </button>
              )}
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
              className="mise-btn-key mise-press px-3 py-1.5 text-sm font-semibold"
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
                {
                  label: "In stock now",
                  value: fmtQty(itemStory.item.current_stock, itemStory.item.unit),
                  hint: stockInPacks(itemStory.item) || "what you have today",
                },
                {
                  label: "Ordered so far",
                  value: `${itemStory.ordered} ${itemStory.item.unit}`,
                  hint: `across ${itemStory.rows.length} request${itemStory.rows.length === 1 ? "" : "s"}`,
                },
                {
                  label: "What it costs",
                  value: (() => {
                    const sup = suppliers[itemStory.item.id]?.[0];
                    return sup ? format(pricePerBase(itemStory.item, sup).toFixed(2)) : "—";
                  })(),
                  hint: (() => {
                    const sup = suppliers[itemStory.item.id]?.[0];
                    return sup
                      ? `per ${itemStory.item.unit} · ${sup.vendor_name}`
                      : "no supplier prices this";
                  })(),
                },
              ]}
            />

            {/* Said in a sentence, because three numbers in boxes is a report
                and this screen is meant to be readable by whoever is standing
                in the store room. */}
            <p className="px-1 pb-1 text-sm leading-relaxed text-fg-soft">
              You have asked for <b className="text-fg">{itemStory.item.name}</b>{" "}
              {itemStory.rows.length === 0 ? (
                <>never yet.</>
              ) : (
                <>
                  <b className="text-fg">{itemStory.rows.length}</b> time
                  {itemStory.rows.length === 1 ? "" : "s"}, {itemStory.ordered}{" "}
                  {itemStory.item.unit} in all, which turned into{" "}
                  <b className="text-fg">{itemStory.orders.length}</b> purchase order
                  {itemStory.orders.length === 1 ? "" : "s"}
                  {itemStory.orders.filter((o) => o.status === "RECEIVED").length > 0 && (
                    <>
                      {" "}
                      — {itemStory.orders.filter((o) => o.status === "RECEIVED").length} of them
                      already arrived
                    </>
                  )}
                  .
                </>
              )}
            </p>

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
                      <span className="flex shrink-0 items-center gap-2 text-right">
                        <span>
                          <span className="block text-sm font-semibold text-fg">
                            {format(po.total_amount)}
                          </span>
                          <span className="block text-[10px] text-fg-faint">
                            whole order, all items
                          </span>
                        </span>
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
