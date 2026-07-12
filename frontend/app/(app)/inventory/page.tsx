"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type Item,
  type PurchaseByVendorRow,
  type ReceiptLine,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { AreaChart, RadialBars } from "@/components/charts";
import { ComboBox } from "@/components/ComboBox";
import { categoryEmoji, fmtQty, QtyInput, stockState } from "@/components/ItemPicker";
import { ALLERGENS, parseAllergens } from "@/lib/allergens";
import { noDigits, numeric } from "@/lib/sanitize";
import { useConfirm } from "@/components/confirm";
import { useCurrency } from "@/lib/currency";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const STD_UNITS = ["kg", "g", "litre", "ml", "piece", "pack", "box", "bag", "dozen", "bottle"];

// Suggested item categories — these group the chef-friendly pickers on the
// Purchasing/Recipes/Price-Comparison pages, so consistent names matter.
// The ComboBox still lets you add a brand-new category any time.
const STD_CATEGORIES = [
  "Vegetables", "Fruits", "Meat", "Fish & Seafood", "Dairy", "Eggs", "Spices",
  "Grains & Rice", "Oil & Ghee", "Sauces & Tins", "Beverages", "Bakery",
  "Frozen", "Dry Goods", "Packaging", "Cleaning",
];

type StatusFilter = "all" | "ok" | "low" | "out";
type SortKey = "name" | "status" | "supplier" | "stock" | "cost";

function statusOf(item: Item): "ok" | "low" | "out" {
  const qty = parseFloat(item.current_stock || "0");
  const min = parseFloat(item.min_stock_level || "0");
  if (qty <= 0) return "out";
  if (min > 0 && qty <= min) return "low";
  return "ok";
}

// A slim stock-health bar: fill = current ÷ par (max level), else ÷ 2× min. Colour
// tracks the status (green healthy / amber low / red out) so a glance says "how stocked".
function StockBar({ item }: { item: Item }) {
  const cur = parseFloat(item.current_stock || "0");
  const min = parseFloat(item.min_stock_level || "0");
  const max = parseFloat(item.max_stock_level || "0");
  const cap = max > 0 ? max : min > 0 ? min * 2 : 0;
  const pct = cap > 0 ? Math.max(2, Math.min(100, (cur / cap) * 100)) : cur > 0 ? 100 : 0;
  const st = statusOf(item);
  const color = st === "out" ? "bg-rose-500" : st === "low" ? "bg-amber-400" : "bg-brand-500";
  return (
    <div className="mt-1 h-1.5 w-full max-w-[8rem] overflow-hidden rounded-full bg-glass/10" title={`${Math.round(pct)}% of par`}>
      <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// "≈ 4.9 boxes · 1 box = 5 kg" when the item is bought in packs.
function packLabel(item: Item): string | null {
  const size = parseFloat(item.pack_size || "0");
  if (!item.pack_unit || size <= 0) return null;
  const packs = parseFloat(item.current_stock || "0") / size;
  const n = packs < 10 ? packs.toFixed(1) : String(Math.round(packs));
  return `≈ ${n} ${item.pack_unit}${packs === 1 ? "" : "s"} · 1 ${item.pack_unit} = ${item.pack_size} ${item.unit}`;
}

const EMPTY = { name: "", category: "", unit: "kg", min: "", allergens: "", packUnit: "", packSize: "" };

export default function InventoryPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { user } = useAuth();
  const isSuper = user?.role === "SUPER_ADMIN";
  const canWrite = can(user?.role, "inventory:write");
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [catMgr, setCatMgr] = useState(false);
  const [catFrom, setCatFrom] = useState("");
  const [catTo, setCatTo] = useState("");
  const [allergensTouched, setAllergensTouched] = useState(false);
  // Per-item "purchases by supplier" record (expand a row to load + show it).
  const [expanded, setExpanded] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, PurchaseByVendorRow[]>>({});
  const [bdLoading, setBdLoading] = useState<string | null>(null);
  // The "chain": open a purchase into the full delivery it came on (shared reference).
  const [receipts, setReceipts] = useState<Record<string, ReceiptLine[]>>({});
  const [priceHist, setPriceHist] = useState<Record<string, { date: string; price: string; vendor_name?: string | null }[]>>({});
  const [openReceipt, setOpenReceipt] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);

  async function toggleReceipt(refId: string) {
    if (openReceipt === refId) {
      setOpenReceipt(null);
      return;
    }
    setOpenReceipt(refId);
    if (!receipts[refId]) {
      setReceiptLoading(true);
      try {
        const lines = await api.get<ReceiptLine[]>(`/inventory/receipts/${refId}`);
        setReceipts((r) => ({ ...r, [refId]: lines }));
      } catch {
        setReceipts((r) => ({ ...r, [refId]: [] }));
      } finally {
        setReceiptLoading(false);
      }
    }
  }
  // Edit affordance: scroll to + briefly highlight the form when editing starts.
  const formRef = useRef<HTMLDivElement>(null);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const { format } = useCurrency();

  function load() {
    return api.get<Item[]>("/inventory/items").then(setItems);
  }

  // ── Strict template import (Excel/CSV only — no AI) ─────────────────────────
  const templateInput = useRef<HTMLInputElement>(null);
  const [templateModal, setTemplateModal] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, unknown>[] | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [importNotes, setImportNotes] = useState<string[] | null>(null);

  // Strict template upload: validates the Excel/CSV against the exact column spec and
  // returns the precise problems (so the user fixes the file), or parsed rows to preview.
  async function onTemplateFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportBusy(true);
    setImportMsg(null);
    setImportErrors(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await postForm<{ rows: Record<string, unknown>[] }>(
        "/inventory/import-template", fd
      );
      if (!res.rows.length) setImportMsg("No data rows found — fill in at least one row.");
      else setImportRows(res.rows);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const d = err.detail as { errors?: string[] } | undefined;
        setImportErrors(d?.errors ?? ["The file didn't match the template."]);
      } else if (err instanceof ApiError && err.status === 403) {
        setImportMsg("You don't have permission to add stock items.");
      } else {
        setImportMsg("Sorry — couldn't read that file. Use the Excel/CSV template.");
      }
    } finally {
      setImportBusy(false);
    }
  }

  async function commitImport() {
    if (!importRows) return;
    setImportBusy(true);
    try {
      const res = await api.post<{ created: string[]; skipped: string[]; linked?: string[]; notes?: string[] }>(
        "/inventory/import-template/commit",
        { rows: importRows }
      );
      setImportRows(null);
      const skip = res.skipped.length ? `, ${res.skipped.length} already there` : "";
      const link = res.linked?.length ? `, ${res.linked.length} linked to a supplier` : "";
      setImportMsg(`Added ${res.created.length} item${res.created.length === 1 ? "" : "s"}${skip}${link}.`);
      setImportNotes(res.notes?.length ? res.notes : null);
      await load();
    } catch (err) {
      setImportMsg(err instanceof ApiError ? err.message : "Could not add those items.");
    } finally {
      setImportBusy(false);
    }
  }

  async function renameCategory() {
    if (!catFrom || !catTo.trim()) return;
    try {
      await api.post("/inventory/categories/rename", { from_name: catFrom, to_name: catTo.trim() });
      if (catFilter === catFrom) setCatFilter("all");
      setCatMgr(false);
      setCatFrom("");
      setCatTo("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not rename category");
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    // Deep links: /inventory?filter=low (dashboard KPI), ?cat=Spices (money
    // page donut drill-down), ?q=Saffron (chart legends)
    const sp = new URLSearchParams(window.location.search);
    const want = sp.get("filter");
    if (want === "low" || want === "out" || want === "ok") setStatusFilter(want);
    const cat = sp.get("cat");
    if (cat) setCatFilter(cat === "Uncategorised" ? "Other" : cat);
    const query = sp.get("q");
    if (query) setQ(query);
  }, []);

  function startEdit(item: Item) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      category: item.category ?? "",
      unit: item.unit,
      min: item.min_stock_level ?? "",
      allergens: item.allergens ?? "",
      packUnit: item.pack_unit ?? "",
      packSize: item.pack_size ?? "",
    });
    setAllergensTouched(false);
    setError(null);
    // Smoothly bring the edit form into view (the real scroll container is
    // <main>, so window.scrollTo did nothing — scrollIntoView always works) and
    // pulse it so the click clearly "lands" up top.
    requestAnimationFrame(() =>
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
    setFlash(true);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 1200);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY);
    setAllergensTouched(false);
    setError(null);
  }

  function toggleAllergen(code: string) {
    const set = new Set(parseAllergens(form.allergens));
    if (set.has(code)) set.delete(code);
    else set.add(code);
    setForm({ ...form, allergens: [...set].join(",") });
    setAllergensTouched(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: form.name,
      unit: form.unit,
      category: form.category || null,
      min_stock_level: form.min || null,
      // Pack is optional: 1 packUnit = packSize units. Blank pack_size clears it.
      pack_unit: form.packUnit.trim() || null,
      pack_size: form.packUnit.trim() && form.packSize ? form.packSize : null,
    };
    // Write allergens whenever the user touched the picker (works for add + edit).
    // Left untouched → stays "not reviewed" so the Allergens sheet still prompts.
    if (allergensTouched) payload.allergens = form.allergens;
    try {
      if (editingId) {
        await api.patch<Item>(`/inventory/items/${editingId}`, payload);
      } else {
        // Price/supplier live on Vendors (single source of truth) — not set here.
        await api.post<Item>("/inventory/items", payload);
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save item");
    } finally {
      setSaving(false);
    }
  }

  // Add the curated starter catalogue (name + unit only) in one click, so a new
  // hotel doesn't start with an empty inventory. Existing names are skipped.
  async function addCommonItems() {
    const ok = await confirm({
      title: "Add common restaurant items?",
      message:
        "Adds a ready-made list of ~90 everyday items (vegetables, spices, dairy, rice, oils, packaging, cleaning…) — name + unit only. Prices and suppliers are left blank for you to set on the Vendors page. Anything already in your list is skipped, and you can edit or remove any item afterwards.",
      confirmText: "Add items",
    });
    if (!ok) return;
    setSeeding(true);
    setError(null);
    try {
      const res = await api.post<{ added: number; skipped: number }>("/inventory/seed-starter", {});
      await load();
      setNotice(
        `Added ${res.added} item${res.added === 1 ? "" : "s"}` +
          (res.skipped ? `, skipped ${res.skipped} already in your list.` : "."),
      );
      setTimeout(() => setNotice(null), 5000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add starter items");
    } finally {
      setSeeding(false);
    }
  }

  async function removeItem(item: Item) {
    // Look up how tied-in the item is, so the warning is specific + honest about
    // whether this permanently deletes (unused) or archives (has history).
    let usage: {
      recipes: number;
      purchase_orders: number;
      movements: number;
      can_hard_delete: boolean;
    } | null = null;
    try {
      usage = await api.get(`/inventory/items/${item.id}/usage`);
    } catch {
      /* fall back to the safe (archive) wording below */
    }
    const willDelete = usage?.can_hard_delete ?? false;
    const bits: string[] = [];
    if (usage?.recipes) bits.push(`${usage.recipes} recipe${usage.recipes === 1 ? "" : "s"}`);
    if (usage?.purchase_orders)
      bits.push(`${usage.purchase_orders} purchase-order line${usage.purchase_orders === 1 ? "" : "s"}`);
    if (usage?.movements)
      bits.push(`${usage.movements} stock movement${usage.movements === 1 ? "" : "s"}`);

    const ok = await confirm({
      title: `Remove “${item.name}”?`,
      message: willDelete
        ? `“${item.name}” isn’t used anywhere yet, so it will be permanently DELETED. This can’t be undone.`
        : `“${item.name}” is used in ${bits.join(", ") || "your records"}. To keep your past numbers correct it will be ARCHIVED (hidden from inventory, pickers and ordering) — its history stays intact. It won’t appear in new entries.`,
      confirmText: willDelete ? "Delete permanently" : "Archive item",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      const res = await api.delete<{ action: string }>(`/inventory/items/${item.id}`);
      await load();
      setNotice(
        res.action === "deleted"
          ? `Deleted “${item.name}”.`
          : `Archived “${item.name}” — hidden from new use, history kept.`,
      );
      setTimeout(() => setNotice(null), 5000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove item");
    }
  }

  function orderItem(item: Item) {
    router.push(`/purchasing?item=${item.id}`);
  }

  async function toggleBreakdown(item: Item) {
    setOpenReceipt(null);
    if (expanded === item.id) {
      setExpanded(null);
      return;
    }
    setExpanded(item.id);
    if (!breakdown[item.id]) {
      setBdLoading(item.id);
      try {
        const rows = await api.get<PurchaseByVendorRow[]>(
          `/inventory/items/${item.id}/purchases-by-vendor`,
        );
        setBreakdown((b) => ({ ...b, [item.id]: rows }));
      } catch {
        setBreakdown((b) => ({ ...b, [item.id]: [] }));
      } finally {
        setBdLoading(null);
      }
    }
    if (!priceHist[item.id]) {
      // What you actually paid over time (received POs) — drawn as an area line.
      api
        .get<{ date: string; price: string; vendor_name?: string | null }[]>(`/reports/price-history/${item.id}`)
        .then((pts) => setPriceHist((h) => ({ ...h, [item.id]: pts })))
        .catch(() => setPriceHist((h) => ({ ...h, [item.id]: [] })));
    }
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25";

  const categoryOptions = [
    ...new Set([...STD_CATEGORIES, ...(items.map((i) => i.category).filter(Boolean) as string[])]),
  ];
  const unitOptions = [...new Set([...STD_UNITS, ...items.map((i) => i.unit)])];

  const counts = {
    all: items.length,
    ok: items.filter((i) => statusOf(i) === "ok").length,
    low: items.filter((i) => statusOf(i) === "low").length,
    out: items.filter((i) => statusOf(i) === "out").length,
  };
  const categories = [...new Set(items.map((i) => i.category?.trim() || "Other"))].sort((a, b) =>
    a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)
  );

  const query = q.trim().toLowerCase();
  const filtered = items.filter((i) => {
    if (query && !i.name.toLowerCase().includes(query)) return false;
    if (statusFilter !== "all" && statusOf(i) !== statusFilter) return false;
    if (catFilter !== "all" && (i.category?.trim() || "Other") !== catFilter) return false;
    return true;
  });

  // Column sorting. Status sorts by severity (out → low → ok) so problems
  // surface first; supplier is alphabetical (items with no supplier go last).
  const statusRank = { out: 0, low: 1, ok: 2 } as const;
  const visible = [...filtered].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "status":
        cmp = statusRank[statusOf(a)] - statusRank[statusOf(b)];
        break;
      case "supplier":
        cmp = (a.best_vendor || "￿").localeCompare(b.best_vendor || "￿");
        break;
      case "stock":
        cmp = parseFloat(a.current_stock || "0") - parseFloat(b.current_stock || "0");
        break;
      case "cost":
        cmp = parseFloat(a.average_cost || "0") - parseFloat(b.average_cost || "0");
        break;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });


  const statusChips: { key: StatusFilter; label: string; dot?: string }[] = [
    { key: "all", label: `🧺 All (${counts.all})` },
    { key: "ok", label: `In stock (${counts.ok})`, dot: "bg-brand-400 ring-2 ring-brand-400/20" },
    { key: "low", label: `Low (${counts.low})`, dot: "bg-amber-300 ring-2 ring-amber-300/20" },
    { key: "out", label: `Out (${counts.out})`, dot: "bg-rose-400 ring-2 ring-rose-400/20" },
  ];

  // Stock-status chips = emerald (the brand). Category chips = indigo, so the two
  // filter groups read as clearly DIFFERENT things that combine, not one long list.
  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25"
        : "border border-line-2 text-fg-soft hover:bg-glass/5"
    }`;
  const catChip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
      active
        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/25"
        : "border border-indigo-400/30 text-fg-soft hover:bg-indigo-500/10"
    }`;

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  // A sortable column header: click to sort, arrow shows direction.
  const sortTh = (k: SortKey, label: string, right = false) => (
    <th className={`px-5 py-3 font-medium ${right ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 transition hover:text-fg ${right ? "flex-row-reverse" : ""} ${sortKey === k ? "text-fg" : ""}`}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <span aria-hidden className={`text-[9px] ${sortKey === k ? "text-brand-300" : "text-fg-faint/50"}`}>
          {sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Inventory" subtitle="Items, stock levels, suppliers and weighted-average cost." />
        <div className="flex gap-2">
          <input
            ref={templateInput}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onTemplateFile}
          />
          {canWrite && (
            <button
              onClick={addCommonItems}
              disabled={seeding}
              title="One-click: add a ready-made list of common restaurant items (name + unit only) so you don't start empty"
              className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-sm font-medium text-brand-300 hover:bg-brand-500/20 disabled:opacity-50"
            >
              {seeding ? "Adding…" : "✨ Add common items"}
            </button>
          )}
          <button
            onClick={() => setTemplateModal(true)}
            title="Download a blank import template (Excel, CSV or PDF)"
            className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-1.5 text-sm font-medium text-brand-300 hover:bg-brand-500/20"
          >
            ⬇ Template
          </button>
          <button
            onClick={() => templateInput.current?.click()}
            disabled={importBusy}
            title="Upload a filled Excel/CSV template — checked strictly, with exact errors if anything's off"
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {importBusy ? "Checking…" : "⬆ Import (template)"}
          </button>
          <span className="mx-1 hidden w-px self-stretch bg-line sm:block" aria-hidden />
          <button
            onClick={() => downloadFile("/inventory/items.xlsx", "mise-stock-valuation.xlsx")}
            title="Export your current stock valuation (Excel)"
            className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
          >
            ⬇ Export
          </button>
          <button
            onClick={() => downloadFile("/inventory/items.csv", "mise-stock-valuation.csv")}
            title="Export your current stock valuation (CSV)"
            className="rounded-lg border border-line-2 px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
          >
            CSV
          </button>
        </div>
      </div>

      {notice && (
        <p className="mt-3 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-200">
          {notice}
        </p>
      )}

      <p className="mt-3 mb-5 max-w-3xl text-xs leading-relaxed text-fg-faint">
        Bulk add items the reliable way: tap{" "}
        <button onClick={() => setTemplateModal(true)} className="font-medium text-brand-400 underline hover:text-brand-300">⬇ Template</button>
        {" "}to download a blank sheet, fill it in, then{" "}
        <b className="text-fg-soft">⬆ Import (template)</b> — it&apos;s checked strictly and tells you the exact fix
        if anything&apos;s off. No AI involved.
      </p>

      {importErrors && (
        <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-rose-200">Your file doesn&apos;t match the template — fix these and re-upload:</p>
            <button onClick={() => setImportErrors(null)} className="text-fg-faint hover:text-fg" aria-label="Dismiss">✕</button>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-rose-100/90">
            {importErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-faint">
            Tip: keep the template&apos;s headers exactly, and make number columns (stock, cost) numbers only.
          </p>
        </div>
      )}

      {importMsg && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-brand-500/10 px-3 py-2 text-sm text-brand-200">
          <span>{importMsg}</span>
          <button onClick={() => setImportMsg(null)} className="text-fg-faint hover:text-fg" aria-label="Dismiss">✕</button>
        </div>
      )}

      {importNotes && (
        <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-medium text-amber-200">Supplier links — a few rows need attention:</p>
            <button onClick={() => setImportNotes(null)} className="text-fg-faint hover:text-fg" aria-label="Dismiss">✕</button>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-soft">
            {importNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-faint">
            Set these prices on the <Link href="/vendors" className="text-brand-400 underline">Vendors</Link> page — the items themselves were added.
          </p>
        </div>
      )}

      {importRows && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !importBusy && setImportRows(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <h3 className="font-semibold text-fg">
                Review {importRows.length} item{importRows.length === 1 ? "" : "s"} from your file
              </h3>
              <button onClick={() => setImportRows(null)} disabled={importBusy} className="text-fg-faint hover:text-fg" aria-label="Close">✕</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-fg-faint">
                    <th className="py-1">Name</th>
                    <th>Unit</th>
                    <th>Category</th>
                    <th className="text-right">Opening stock</th>
                    <th>Supplier</th>
                  </tr>
                </thead>
                <tbody>
                  {importRows.map((r, i) => (
                    <tr key={i} className="border-t border-line/50">
                      <td className="py-1.5 font-medium text-fg">{String(r.name ?? "")}</td>
                      <td className="text-fg-soft">{String(r.unit ?? "")}</td>
                      <td className="text-fg-soft">{String(r.category ?? "")}</td>
                      <td className="text-right text-fg-soft">
                        {r.current_stock != null && r.current_stock !== "" ? String(r.current_stock) : "—"}
                      </td>
                      <td className="text-fg-soft">{String(r.supplier ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3">
              <p className="mr-auto text-xs text-fg-faint">Nothing is saved until you add them. Duplicates are skipped.</p>
              <button onClick={() => setImportRows(null)} disabled={importBusy} className="rounded-lg border border-line px-4 py-2 text-sm text-fg-soft hover:bg-paper-2">
                Cancel
              </button>
              <button onClick={commitImport} disabled={importBusy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
                {importBusy ? "Adding…" : `Add ${importRows.length} item${importRows.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={formRef} className="scroll-mt-4">
      <Card className={`mb-6 ${flash ? "mise-flash" : ""}`}>
        <p className="mb-3 text-sm font-medium text-fg-soft">
          {editingId ? "Edit item" : "Add a new item"}
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex-1 sm:min-w-[12rem]">
              <label className="block text-sm font-medium text-fg-soft">Item name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                placeholder="e.g. Basmati Rice"
                className={inputCls}
              />
            </div>
            <div className="w-full sm:w-44">
              <label className="block text-sm font-medium text-fg-soft">Category</label>
              <div className="mt-1">
                <ComboBox
                  value={form.category}
                  onChange={(v) => setForm({ ...form, category: v })}
                  options={categoryOptions}
                  placeholder="Select category…"
                  className="w-full"
                />
              </div>
            </div>
            <div className="w-full sm:w-32">
              <label className="block text-sm font-medium text-fg-soft">Unit</label>
              <div className="mt-1">
                <ComboBox
                  value={form.unit}
                  onChange={(v) => setForm({ ...form, unit: v })}
                  options={unitOptions}
                  placeholder="Select unit…"
                  className="w-full"
                  sanitize={noDigits}
                />
              </div>
            </div>
            <div className="w-full sm:w-auto">
              <label className="block text-sm font-medium text-fg-soft">Min stock</label>
              <div className="mt-1">
                <QtyInput
                  unit={form.unit}
                  value={form.min}
                  onChange={(v) => setForm({ ...form, min: v })}
                  label="Minimum stock level"
                  plainClassName={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Optional purchase pack: 1 pack = N base units. Stock/recipes stay in the base unit. */}
          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-paper-2/40 p-3">
            <div className="w-full text-xs text-fg-faint sm:max-w-xs">
              <span className="text-sm font-medium text-fg-soft">Sold in packs?</span>{" "}
              <span className="text-fg-faint">(optional)</span>
              <p className="mt-0.5">
                If you buy this in a box/bag/case, say how much is inside. Ordering can then use packs, but
                stock &amp; recipes still count in <b className="text-fg-soft">{form.unit || "the base unit"}</b>.
              </p>
            </div>
            <div className="w-28">
              <label className="block text-sm font-medium text-fg-soft">Pack name</label>
              <input value={form.packUnit} onChange={(e) => setForm({ ...form, packUnit: noDigits(e.target.value) })} placeholder="e.g. box" className={inputCls} />
            </div>
            <div className="flex items-end gap-1.5">
              <span className="pb-2 text-sm text-fg-faint">1 {form.packUnit.trim() || "pack"} =</span>
              <div className="w-24">
                <label className="block text-sm font-medium text-fg-soft">Pack size</label>
                <input
                  value={form.packSize}
                  onChange={(e) => setForm({ ...form, packSize: numeric(e.target.value) })}
                  inputMode="decimal"
                  placeholder="0"
                  disabled={!form.packUnit.trim()}
                  className={`${inputCls} disabled:opacity-50`}
                />
              </div>
              <span className="pb-2 text-sm text-fg-faint">{form.unit || "unit"}</span>
            </div>
          </div>

          {!editingId && (
            <div className="rounded-xl border border-line bg-paper-2/60 p-3 text-xs text-fg-faint">
              💡 Prices live with the supplier. After adding the item, set who supplies it and
              at what price on the{" "}
              <Link href="/vendors" className="font-medium text-brand-400 hover:underline">Vendors</Link>{" "}
              page (or bulk-load them with the Vendors price-list import) — that keeps one price per supplier,
              no clashes.
            </div>
          )}

          {(
            <div className="rounded-xl border border-line bg-paper-2/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                Allergens (Natasha&apos;s Law)
              </p>
              <p className="mb-2 text-xs text-fg-faint">
                Tag what this ingredient contains — every dish that uses it inherits these
                automatically on the Allergens sheet.
              </p>
              <div className="flex flex-wrap gap-2">
                {ALLERGENS.map((a) => {
                  const on = parseAllergens(form.allergens).includes(a.code);
                  return (
                    <button
                      key={a.code}
                      type="button"
                      onClick={() => toggleAllergen(a.code)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        on
                          ? "bg-rose-500 text-white shadow-lg shadow-rose-600/20"
                          : "border border-line-2 text-fg-soft hover:bg-glass/5"
                      }`}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-fg-faint">
                None selected + saved = &ldquo;contains none&rdquo; (marks it reviewed).
              </p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add item"}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-lg border border-line-2 px-4 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      </Card>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* Where the stock money sits — activity-ring style, top items by £ on shelf */}
          {items.length > 0 && (() => {
            const valued = items
              .filter((i) => i.is_active)
              .map((i) => ({
                label: i.name,
                value: (parseFloat(i.current_stock) || 0) * (parseFloat(i.average_cost) || 0),
              }))
              .filter((x) => x.value > 0);
            if (valued.length < 2) return null;
            const total = valued.reduce((s, x) => s + x.value, 0);
            return (
              <Card className="mise-feel mb-4">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold text-fg">Where your stock money sits</h3>
                  <span className="font-mono text-xs text-copper-300">{format(String(total))} on the shelf</span>
                </div>
                <p className="text-xs text-fg-faint">
                  top 5 of {valued.length} valued items — tap one to jump to it in the table
                </p>
                <RadialBars
                  className="mt-4"
                  items={valued}
                  formatValue={(v) => format(String(v))}
                  onItemClick={(it) => {
                    setQ(it.label);
                    setStatusFilter("all");
                    setCatFilter("all");
                  }}
                />
              </Card>
            );
          })()}

          {/* Reorder nudge — the shelf talks to you */}
          {(() => {
            const lows = items.filter((i) => i.is_active && stockState(i).label === "running low").length;
            const outs = items.filter((i) => i.is_active && stockState(i).label === "out of stock").length;
            if (lows + outs === 0) return null;
            return (
              <div className="mise-well mise-feel mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 px-4 py-3">
                <p className="text-sm text-fg">
                  <span aria-hidden className="mr-1.5">🛎️</span>
                  <b>{lows + outs}</b> item{lows + outs === 1 ? "" : "s"} need{lows + outs === 1 ? "s" : ""} ordering
                  <span className="ml-1 text-xs text-fg-faint">
                    ({lows} running low{outs > 0 ? ` · ${outs} out of stock` : ""})
                  </span>
                </p>
                <div className="flex gap-2">
                  {lows > 0 && (
                    <button type="button" onClick={() => setStatusFilter("low")} className="mise-press rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-400/20">
                      Show low
                    </button>
                  )}
                  {outs > 0 && (
                    <button type="button" onClick={() => setStatusFilter("out")} className="mise-press rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-400/20">
                      Show out
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Search + filters */}
          <div className="mb-3 space-y-2">
            <div className="relative max-w-md">
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint">🔍</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search items…"
                aria-label="Search items"
                className="mise-well w-full rounded-xl py-2.5 pl-9 pr-3 text-sm text-fg outline-none"
              />
            </div>
            {/* Two SEPARATE filters that combine (AND). Kept on their own labelled
                rows + different colours so picking a stock status and a category
                doesn't look like one list (which surprised people with 0 results). */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-fg-faint">Stock</span>
                {statusChips.map((s) => (
                  <button key={s.key} type="button" onClick={() => setStatusFilter(s.key)} className={chip(statusFilter === s.key)}>
                    {s.dot && <span aria-hidden className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${s.dot}`} />}
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-fg-faint">Category</span>
                <button type="button" onClick={() => setCatFilter("all")} className={catChip(catFilter === "all")}>
                  All categories
                </button>
                {categories.map((c) => (
                  <button key={c} type="button" onClick={() => setCatFilter(c)} className={catChip(catFilter === c)}>
                    {categoryEmoji(c)} {c}
                  </button>
                ))}
              </div>
              {(statusFilter !== "all" || catFilter !== "all") && (
                <p className="text-xs text-fg-faint">
                  Showing <b className="text-fg-soft">{filtered.length}</b> item{filtered.length === 1 ? "" : "s"}
                  {statusFilter !== "all" && catFilter !== "all"
                    ? " — the stock filter and the category filter are combined."
                    : "."}
                  <button
                    type="button"
                    onClick={() => { setStatusFilter("all"); setCatFilter("all"); }}
                    className="ml-2 font-medium text-brand-400 underline hover:text-brand-300"
                  >
                    Clear filters
                  </button>
                </p>
              )}
            </div>
            {/* Rename / merge a category across all its items */}
            <div className="mt-2">
              {!catMgr ? (
                <button type="button" onClick={() => setCatMgr(true)} className="text-xs text-fg-faint hover:text-fg-soft">
                  ✎ Rename / merge a category
                </button>
              ) : (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-paper-2/60 p-3">
                  <div>
                    <label className="block text-xs font-medium text-fg-faint">Rename</label>
                    <select value={catFrom} onChange={(e) => setCatFrom(e.target.value)} className={inputCls}>
                      <option value="">Pick category…</option>
                      {categories.filter((c) => c !== "Other").map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-fg-faint">to</label>
                    <div className="mt-1">
                      <ComboBox value={catTo} onChange={setCatTo} options={categoryOptions} placeholder="New or existing…" className="w-48" />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={renameCategory}
                    disabled={!catFrom || !catTo.trim()}
                    className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                  >
                    Apply
                  </button>
                  <button type="button" onClick={() => setCatMgr(false)} className="rounded-lg border border-line-2 px-3 py-2 text-sm text-fg-soft hover:bg-paper-2">
                    Cancel
                  </button>
                  <span className="text-xs text-fg-faint">Renaming into an existing category merges them.</span>
                </div>
              )}
            </div>
          </div>

          <Card className="p-0">
            <div className="max-h-[62vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-paper">
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-faint">
                    {sortTh("name", "Item")}
                    {sortTh("status", "Status")}
                    {sortTh("supplier", "Supplier")}
                    {sortTh("stock", "Stock", true)}
                    {sortTh("cost", "Avg cost", true)}
                    <th className="px-5 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-fg-faint">
                        {items.length === 0 ? "No items yet — add your first above." : "Nothing matches the filters."}
                      </td>
                    </tr>
                  ) : (
                    visible.map((item) => {
                      const st = stockState(item);
                      // Click-to-open the purchase history whenever the item has EVER
                      // been bought — even from a single vendor (to show price changes
                      // over time). The "N suppliers" badge only shows for >1 vendor.
                      const hasHistory = (item.purchase_vendor_count ?? 0) > 0;
                      const multiVendor = (item.purchase_vendor_count ?? 0) > 1;
                      const isOpen = expanded === item.id;
                      const rows = breakdown[item.id];
                      return (
                        <Fragment key={item.id}>
                        <tr
                          className={`border-b border-line transition hover:bg-glass/[0.04] ${
                            hasHistory ? "cursor-pointer" : ""
                          } ${isOpen ? "bg-glass/[0.04]" : ""} ${st.label === "running low" ? "mise-low-pulse" : ""}`}
                          onClick={hasHistory ? () => toggleBreakdown(item) : undefined}
                          aria-expanded={hasHistory ? isOpen : undefined}
                        >
                          <td className="px-5 py-3">
                            <p className="font-medium text-fg">
                              <span aria-hidden className="mr-1.5">{categoryEmoji(item.category?.trim() || "Other")}</span>
                              {item.name}
                            </p>
                            <p className="mt-0.5 text-xs text-fg-faint">{item.category || "Uncategorised"}</p>
                          </td>
                          <td className="px-5 py-3">
                            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${st.cls}`}>
                              {st.dot} {st.label}
                            </span>
                          </td>
                          <td className="px-5 py-3">
                            {item.best_vendor ? (
                              <span className="text-fg-soft" title="Chosen supplier — recipes & purchase orders use this one">
                                <span className="text-brand-400">★</span> {item.best_vendor}
                              </span>
                            ) : (item.vendor_count ?? 0) > 0 ? (
                              <Link
                                href="/price-comparison"
                                onClick={(e) => e.stopPropagation()}
                                title="This item has suppliers but none is chosen — pick which one to use"
                                className="inline-flex transition hover:opacity-80"
                              >
                                <Badge tone="amber">★ choose supplier</Badge>
                              </Link>
                            ) : (
                              <Link
                                href="/vendors"
                                onClick={(e) => e.stopPropagation()}
                                title="No vendor sells this yet — add a price for it on the Vendors page"
                                className="inline-flex transition hover:opacity-80"
                              >
                                <Badge tone="amber">+ add supplier</Badge>
                              </Link>
                            )}
                            {multiVendor && (
                              <span className="ml-2 inline-flex items-center rounded-full border border-brand-400/30 bg-brand-400/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">
                                {item.purchase_vendor_count} suppliers
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className="flex items-center justify-end gap-1 text-fg-soft">
                              {hasHistory && (
                                <span
                                  aria-hidden
                                  title="Click the row to see purchase history"
                                  className={`text-[10px] text-brand-300 transition-transform duration-300 ${isOpen ? "rotate-90" : ""}`}
                                >
                                  ▶
                                </span>
                              )}
                              {fmtQty(item.current_stock, item.unit)}
                            </span>
                            <StockBar item={item} />
                            <p className="text-xs text-fg-faint">{item.min_stock_level ? `min ${fmtQty(item.min_stock_level, item.unit)}` : "no min"}</p>
                            {packLabel(item) && <p className="text-xs text-indigo-300">📦 {packLabel(item)}</p>}
                          </td>
                          <td className="px-5 py-3 text-right text-fg-soft">{format(item.average_cost)}</td>
                          <td className="px-5 py-3">
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); orderItem(item); }}
                                disabled={(item.vendor_count ?? 0) === 0}
                                title={(item.vendor_count ?? 0) === 0 ? "Add a vendor price first (Vendors page)" : "Order this item — opens Purchasing with it picked"}
                                className="mise-press rounded-md border border-brand-400/30 bg-brand-400/10 px-2.5 py-1 text-xs font-medium text-brand-300 hover:bg-brand-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                🛒 Order
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); startEdit(item); }}
                                className="mise-raised mise-press rounded-md px-2.5 py-1 text-xs font-medium text-fg-soft"
                              >
                                Edit
                              </button>
                              {isSuper && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeItem(item); }}
                                  title="Remove from inventory (Super Admin)"
                                  className="rounded-md border border-line px-2 py-1 text-xs text-fg-faint hover:bg-rose-400/10 hover:text-rose-300"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-line bg-paper-2">
                            <td colSpan={6} className="px-5 pb-4 pt-1">
                              <div className="mise-panel-in rounded-2xl border border-line bg-paper-2 p-4">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                                    🏷 Purchases by supplier
                                  </p>
                                  {rows && rows.length > 0 && (
                                    <span className="text-xs text-fg-faint">
                                      {rows.length} recent purchase{rows.length === 1 ? "" : "s"}
                                    </span>
                                  )}
                                </div>
                                {bdLoading === item.id ? (
                                  <p className="mt-3 text-xs text-fg-faint">Loading…</p>
                                ) : rows && rows.length > 0 ? (
                                  <>
                                    {(priceHist[item.id]?.length ?? 0) >= 2 && (
                                      <div className="mise-well mt-3 rounded-xl p-3">
                                        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                                          Price you paid per {item.unit} — over time
                                        </p>
                                        <AreaChart
                                          data={priceHist[item.id].map((p) => parseFloat(p.price) || 0)}
                                          labels={priceHist[item.id].map((p) => p.date)}
                                          color={
                                            (parseFloat(priceHist[item.id][priceHist[item.id].length - 1].price) || 0) >
                                            (parseFloat(priceHist[item.id][0].price) || 0)
                                              ? "#f43f5e"
                                              : "#10b981"
                                          }
                                          height={90}
                                          formatValue={(v) => format(String(v))}
                                        />
                                      </div>
                                    )}
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                      {rows.map((r, idx) => (
                                        <div
                                          key={idx}
                                          role={r.vendor ? "button" : undefined}
                                          tabIndex={r.vendor ? 0 : undefined}
                                          onClick={r.vendor && r.vendor_id ? () => router.push(`/vendors?focus=${r.vendor_id}`) : undefined}
                                          title={r.vendor ? `View ${r.vendor} on the Vendors page` : undefined}
                                          className={`mise-well flex items-center justify-between rounded-xl px-3.5 py-2.5 ${
                                            r.vendor ? "mise-feel cursor-pointer" : ""
                                          }`}
                                        >
                                          <div className="flex min-w-0 items-center gap-3">
                                            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-base text-brand-300">🏷</span>
                                            <div className="min-w-0">
                                              <p className="truncate font-medium text-fg">
                                                {r.vendor ?? "No supplier recorded"}
                                                {r.vendor && <span aria-hidden className="ml-1 text-brand-300">›</span>}
                                              </p>
                                              <p className="text-xs text-fg-faint">
                                                {new Date(r.received_at).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="shrink-0 pl-2 text-right">
                                            <p className="font-semibold text-fg">{fmtQty(r.quantity, item.unit)}</p>
                                            {r.unit_cost != null && (
                                              <p className="font-mono text-xs text-brand-300">{format(r.unit_cost)}/{item.unit}</p>
                                            )}
                                            {r.reference_id && (
                                              <button
                                                onClick={(e) => { e.stopPropagation(); toggleReceipt(r.reference_id!); }}
                                                className="mt-1 text-[11px] font-medium text-brand-300 hover:underline"
                                                title="See everything received on this delivery"
                                              >
                                                {openReceipt === r.reference_id ? "▾ hide delivery" : "🔗 full delivery"}
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                    {openReceipt && (
                                      <div className="mise-panel-in mt-3 rounded-xl border border-brand-400/30 bg-paper-3 p-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                                          📦 The chain — everything received together on this delivery
                                        </p>
                                        {receiptLoading && !receipts[openReceipt] ? (
                                          <p className="mt-2 text-xs text-fg-faint">Loading…</p>
                                        ) : receipts[openReceipt] && receipts[openReceipt].length > 0 ? (
                                          <div className="mt-2 divide-y divide-line/50">
                                            {receipts[openReceipt].map((l, i) => (
                                              <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                                                <span className="min-w-0 truncate text-fg-soft">
                                                  {l.item_name}
                                                  {l.item_name.toLowerCase() === item.name.toLowerCase() && (
                                                    <span className="ml-1 text-brand-300">(this item)</span>
                                                  )}
                                                  {l.vendor && <span className="ml-1 text-fg-faint">· {l.vendor}</span>}
                                                </span>
                                                <span className="shrink-0 pl-2 text-right">
                                                  <b className="text-fg">{fmtQty(l.quantity, l.unit)}</b>
                                                  {l.unit_cost != null && (
                                                    <span className="ml-2 font-mono text-xs text-brand-300">{format(l.unit_cost)}/{l.unit}</span>
                                                  )}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="mt-2 text-xs text-fg-faint">Just this item was on that delivery.</p>
                                        )}
                                      </div>
                                    )}
                                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line pt-3 text-xs text-fg-faint">
                                      <span>On hand <b className="font-semibold text-fg-soft">{fmtQty(item.current_stock, item.unit)}</b></span>
                                      <span>Avg cost <b className="font-semibold text-fg-soft">{format(item.average_cost)}/{item.unit}</b></span>
                                      <span>Bought (recent) <b className="font-semibold text-fg-soft">{fmtQty(rows.reduce((s, r) => s + parseFloat(r.quantity || "0"), 0), item.unit)}</b></span>
                                      <span>Last received <b className="font-semibold text-fg-soft">{new Date(rows[0].received_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b></span>
                                    </div>
                                    <p className="mt-2.5 text-[11px] leading-relaxed text-fg-faint">
                                      Stock from different suppliers mixes into one pool — so Mise values your {fmtQty(item.current_stock, item.unit)} on hand at the weighted-average {format(item.average_cost)}/{item.unit} rather than guessing whose stock is left.
                                    </p>
                                    <div className="mt-3">
                                      <Link
                                        href={`/purchasing?item=${item.id}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex items-center gap-1 rounded-lg border border-brand-400/30 bg-brand-400/10 px-3 py-1.5 text-xs font-medium text-brand-300 transition hover:bg-brand-400/20"
                                      >
                                        🛒 Order / view in Purchasing →
                                      </Link>
                                    </div>
                                  </>
                                ) : (
                                  <p className="mt-3 text-xs text-fg-faint">No purchase history yet.</p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {templateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setTemplateModal(false)} aria-hidden />
          <div className="mise-pop-lg relative w-full max-w-sm rounded-2xl border border-line bg-paper-2 p-5 shadow-2xl shadow-black/50">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-fg">Download import template</h3>
                <p className="mt-0.5 text-xs text-fg-faint">
                  Fill the Excel or CSV, then use <b className="text-fg-soft">⬆ Import (template)</b>. PDF is a printable reference.
                </p>
              </div>
              <button onClick={() => setTemplateModal(false)} className="shrink-0 text-fg-faint hover:text-fg" aria-label="Close">✕</button>
            </div>
            <div className="mt-4 grid gap-2">
              {[
                { ext: "xlsx", label: "Excel (.xlsx)", desc: "Best for filling on a computer", icon: "📊" },
                { ext: "csv", label: "CSV (.csv)", desc: "Universal — opens anywhere", icon: "📄" },
                { ext: "pdf", label: "PDF (reference)", desc: "Printable — can't be uploaded back", icon: "📑" },
              ].map((o) => (
                <button
                  key={o.ext}
                  onClick={() => { downloadFile(`/inventory/template.${o.ext}`, `mise-inventory-template.${o.ext}`); setTemplateModal(false); }}
                  className="flex items-center gap-3 rounded-xl border border-line bg-paper-3 px-3.5 py-3 text-left transition hover:border-brand-400/60 hover:bg-paper-2"
                >
                  <span className="text-xl" aria-hidden>{o.icon}</span>
                  <span className="min-w-0">
                    <span className="block font-medium text-fg">{o.label}</span>
                    <span className="block text-xs text-fg-faint">{o.desc}</span>
                  </span>
                  <span className="ml-auto text-brand-300" aria-hidden>⬇</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
