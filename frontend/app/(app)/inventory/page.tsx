"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { revealForm } from "@/lib/reveal";
import { DetailSheet, SheetRing } from "@/components/DetailSheet";
import { SheetPopup } from "@/components/SheetPopup";
import { InlineEdit } from "@/components/InlineEdit";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type Item,
  type ItemSuppliers,
  type PurchaseByVendorRow,
  type ReceiptLine,
  type SupplierOption,
} from "@/lib/api";
import { Card, Spinner } from "@/components/ui";
import { Workbench, BenchMenu } from "@/components/Workbench";
import { chainSummary, levelName, packDisagreement, packSizes, pricePerBase, stockInPacks, supplierPackSize } from "@/lib/packs";
import { FormShell } from "@/components/EditModal";
import { Select } from "@/components/Select";
import { SubNav } from "@/components/SubNav";
import { AreaChart, RadialBars } from "@/components/charts";
import { ComboBox } from "@/components/ComboBox";
import { categoryEmoji, fmtQty, QtyInput, stockState } from "@/components/ItemPicker";
import { ALLERGENS, parseAllergens } from "@/lib/allergens";
import { noDigits, numeric } from "@/lib/sanitize";
import { useConfirm } from "@/components/confirm";
import { CURRENCIES, useCurrency } from "@/lib/currency";
import { AnimatedNumber, spotlight } from "@/components/fx";
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
  /** Supplier and price, given while ADDING an item.
   *
   *   "their staff feel so tired when they come to the inventory section — add
   *    vendor, add item, then go to vendor and choose that vendor for that
   *    item, then come back to inventory and check. it's like a cycle."
   *
   * The price genuinely belongs to (vendor × item), and that stays true — this
   * writes to the same `/vendors/{id}/items` endpoint the Vendors page uses.
   * What changes is only WHERE you are standing when you write it. The old
   * comment here said "price/supplier live on Vendors — not set here", and that
   * sentence is the round trip his staff are tired of.
   *
   * `newVendorName` covers the other half: a brand-new supplier used to mean
   * leaving the half-typed item to go and create one. */
  const [addVendor, setAddVendor] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [newVendorName, setNewVendorName] = useState("");
  const [vendorList, setVendorList] = useState<{ id: string; name: string }[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Adding used to happen in a 180-line form nailed to the top of the page,
  // so reaching your own stock meant scrolling past it. Now it opens where
  // editing already opened: in place, over the list.
  const [adding, setAdding] = useState(false);
  // The buying chain, smallest first. Held apart from `form` because it is a
  // list of rows rather than a field, and it is saved as a whole.
  // The money bento starts closed so the stock list is the first thing on
  // the page, which is what the page is for.
  const [showMoney, setShowMoney] = useState(false);
  // item_id -> every vendor that prices it. Drives the form's supplier picker:
  // you can only choose a supplier who actually quotes this item.
  const [itemSuppliers, setItemSuppliers] = useState<Record<string, SupplierOption[]>>({});
  const [formVendor, setFormVendor] = useState("");
  const [vendorMsg, setVendorMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [catFilter, setCatFilter] = useState<string>("all");
  // "Show me what THIS supplier sells me." Column sorting can only order by the
  // best vendor's name, which answers a different question — this one is how you
  // review a single supplier before calling them.
  const [vendorFocus, setVendorFocus] = useState<string>("all");
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
  const { format, currency } = useCurrency();

  function load() {
    // who prices what, loaded alongside the items so the supplier picker is
    // never a second round-trip when you open the form
    api
      .get<ItemSuppliers[]>("/purchasing/item-suppliers")
      .then((rows) =>
        setItemSuppliers(Object.fromEntries(rows.map((r) => [r.item_id, r.vendors]))),
      )
      .catch(() => {});
    // The supplier list, so the add form can offer one without a page change.
    api
      .get<{ id: string; name: string; is_active?: boolean }[]>("/vendors")
      .then((vs) => setVendorList(vs.filter((v) => v.is_active !== false)))
      .catch(() => {});
    return api.get<Item[]>("/inventory/items").then(setItems);
  }

  // The suppliers for whatever the form is currently editing, cheapest first.
  const formSuppliers = editingId ? itemSuppliers[editingId] ?? [] : [];
  // The saved item behind the form — its chain has the ids and base sizes that
  // the in-progress draft does not.
  const editingItem = editingId ? items.find((i) => i.id === editingId) ?? null : null;
  const pickedSupplier = formSuppliers.find((v) => v.vendor_id === formVendor) ?? null;

  /** Set an item's chosen supplier. `itemId` is explicit because this is no
   *  longer only the edit form's job — "in inventory I need to change the
   *  vendor of an item from the inventory screen itself", so the detail sheet
   *  calls it too and the two must not drift into two different rules. */
  async function setChosenSupplier(itemId: string, vendorId: string) {
    setVendorMsg(null);
    if (!itemId || !vendorId) return;
    try {
      // picking here IS the decision — recipe costing follows the chosen supplier
      await api.post(`/vendors/items/${itemId}/preferred`, { vendor_id: vendorId });
      setItemSuppliers((prev) => ({
        ...prev,
        [itemId]: (prev[itemId] ?? []).map((v) => ({
          ...v,
          is_preferred: v.vendor_id === vendorId,
        })),
      }));
      // The row shows the chosen supplier's price, so leaving the list alone
      // would show the old one until a reload — the change would look like it
      // had not happened.
      await load();
      setVendorMsg("Chosen supplier saved — costing now uses this price.");
    } catch (err) {
      setVendorMsg(err instanceof ApiError ? err.message : "Could not save that supplier");
    }
  }

  async function chooseSupplier(vendorId: string) {
    setFormVendor(vendorId);
    if (!editingId) return;
    await setChosenSupplier(editingId, vendorId);
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
    // preselect whoever is already the chosen supplier
    setFormVendor((itemSuppliers[item.id] ?? []).find((v) => v.is_preferred)?.vendor_id ?? "");
    setVendorMsg(null);
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
    // No scrolling: the form opens over the row you clicked. The modal focuses
    // its first field itself, so the caret still lands where you need it.
  }

  function cancelEdit() {
    setEditingId(null);
    setAdding(false);
    setFormVendor("");
    setVendorMsg(null);
    setAddVendor("");
    setAddPrice("");
    setNewVendorName("");
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
      // NOTE: no pack_unit / pack_size / pack_levels. This page no longer owns
      // how a thing is bought — suppliers do. Sending the chain from here would
      // be actively destructive now that they can add to it: `set_levels`
      // REPLACES the chain, and `vendor_items.pack_level_id` is ON DELETE SET
      // NULL, so one save from a stale form would silently un-set the pack
      // every supplier had chosen. Omitting the field leaves the chain alone —
      // the API treats "not mentioned" and "sent empty" differently for exactly
      // this reason.
    };
    // Write allergens whenever the user touched the picker (works for add + edit).
    // Left untouched → stays "not reviewed" so the Allergens sheet still prompts.
    if (allergensTouched) payload.allergens = form.allergens;
    try {
      if (editingId) {
        await api.patch<Item>(`/inventory/items/${editingId}`, payload);
      } else {
        const created = await api.post<Item>("/inventory/items", payload);

        // FINISH THE JOB. The price still belongs to (vendor × item) and is
        // still written through the Vendors endpoint — the single source of
        // truth is unchanged. Only the round trip is gone.
        const price = parseFloat(addPrice);
        if ((addVendor || newVendorName.trim()) && price > 0) {
          let vendorId = addVendor;
          if (!vendorId && newVendorName.trim()) {
            const v = await api.post<{ id: string }>("/vendors", {
              name: newVendorName.trim(),
            });
            vendorId = v.id;
          }
          if (vendorId) {
            await api.post(`/vendors/${vendorId}/items`, {
              item_id: created.id,
              price_per_unit: addPrice,
            });
            // One supplier is unambiguously THE supplier, so choosing it here
            // saves a second trip to do the obvious thing.
            await api.post(`/vendors/items/${created.id}/preferred`, { vendor_id: vendorId });
          }
        }
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save item");
    } finally {
      setSaving(false);
    }
  }

  // "Add common items" opens a pick-and-edit preview of the curated catalogue:
  // untick anything you don't want, rename categories, THEN add.
  type SeedRow = { name: string; unit: string; category: string; exists: boolean; include: boolean };
  const [seedRows, setSeedRows] = useState<SeedRow[] | null>(null);

  async function addCommonItems() {
    setSeeding(true);
    setError(null);
    try {
      const res = await api.get<{ items: { name: string; unit: string; category: string; exists: boolean }[] }>(
        "/inventory/seed-starter",
      );
      setSeedRows(res.items.map((r) => ({ ...r, include: !r.exists })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the starter list");
    } finally {
      setSeeding(false);
    }
  }

  async function commitSeed() {
    if (!seedRows) return;
    const chosen = seedRows.filter((r) => r.include && !r.exists);
    if (chosen.length === 0) {
      setSeedRows(null);
      return;
    }
    setSeeding(true);
    setError(null);
    try {
      const res = await api.post<{ added: number; skipped: number }>("/inventory/seed-starter", {
        items: chosen.map((r) => ({ name: r.name, unit: r.unit, category: r.category || "Other" })),
      });
      setSeedRows(null);
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

  const seedModal = seedRows && (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="mise-fade absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSeedRows(null)} aria-hidden />
      <div className="mise-pop-lg relative flex max-h-[86dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-glass/10 bg-paper-2/95 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="border-b border-line px-5 py-4">
          <h3 className="font-semibold text-fg">✨ Common restaurant items — pick what you want</h3>
          <p className="mt-1 text-xs text-fg-faint">
            Untick anything you don&apos;t need, or rename a category (it applies to that whole group).
            Greyed items are already in your kitchen. Prices &amp; suppliers stay blank for the Vendors page.
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-3">
          {[...new Set(seedRows.map((r) => r.category))].map((cat) => {
            const rows = seedRows.filter((r) => r.category === cat);
            const allOn = rows.every((r) => r.exists || r.include);
            return (
              <div key={cat} className="mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={cat}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSeedRows((list) => list && list.map((r) => (r.category === cat ? { ...r, category: v } : r)));
                    }}
                    className="mise-well w-40 rounded-lg px-2.5 py-1 text-xs font-semibold text-fg outline-none"
                    aria-label={`Rename category ${cat}`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setSeedRows((list) =>
                        list && list.map((r) => (r.category === cat && !r.exists ? { ...r, include: !allOn } : r)),
                      )
                    }
                    className="mise-press text-[11px] font-medium text-brand-400 hover:underline"
                  >
                    {allOn ? "untick all" : "tick all"}
                  </button>
                </div>
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {rows.map((r) => (
                    <label
                      key={r.name}
                      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${
                        r.exists ? "opacity-45" : "mise-feel cursor-pointer hover:bg-glass/5"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={r.exists ? false : r.include}
                        disabled={r.exists}
                        onChange={() =>
                          setSeedRows((list) =>
                            list && list.map((x) => (x.name === r.name ? { ...x, include: !x.include } : x)),
                          )
                        }
                        className="h-4 w-4 accent-emerald-500"
                      />
                      {r.exists ? (
                        <>
                          <span className="min-w-0 flex-1 truncate text-fg">{r.name}</span>
                          <span className="shrink-0 text-[11px] text-fg-faint">already added</span>
                        </>
                      ) : (
                        <>
                          <input
                            value={r.name}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSeedRows((list) => list && list.map((x) => (x === r ? { ...x, name: v } : x)));
                            }}
                            onClick={(e) => e.preventDefault()}
                            className="mise-well min-w-0 flex-1 rounded-md px-2 py-1 text-sm text-fg outline-none"
                            aria-label={`Rename ${r.name}`}
                          />
                          <select
                            value={r.unit}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSeedRows((list) => list && list.map((x) => (x === r ? { ...x, unit: v } : x)));
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="mise-well shrink-0 rounded-md px-1.5 py-1 text-[11px] text-fg-soft outline-none"
                            aria-label={`Unit for ${r.name}`}
                          >
                            {[...new Set([r.unit, "kg", "g", "litre", "ml", "piece", "packet", "roll", "box", "bottle", "tin", "bunch"])].map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-5 py-3.5">
          <p className="flex-1 text-xs text-fg-faint">
            <b className="text-fg-soft">{seedRows.filter((r) => r.include && !r.exists).length}</b> selected of{" "}
            {seedRows.filter((r) => !r.exists).length} available
          </p>
          <button type="button" onClick={() => setSeedRows(null)} className="mise-press rounded-lg border border-line px-4 py-2 text-sm text-fg-soft">
            Cancel
          </button>
          <button
            type="button"
            onClick={commitSeed}
            disabled={seeding || seedRows.filter((r) => r.include && !r.exists).length === 0}
            className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {seeding ? "Adding…" : `Add ${seedRows.filter((r) => r.include && !r.exists).length} items`}
          </button>
        </div>
      </div>
    </div>
  );

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

  // The item whose detail sheet is open (click a row -> opens in place).
  const openItem = items.find((i) => i.id === expanded) ?? null;
  const openRows = expanded ? breakdown[expanded] : undefined;

  function orderItem(item: Item) {
    router.push(`/purchasing?item=${item.id}`);
  }

  // Arriving from somewhere else, pointed at one item.
  //
  // "once I clicked done it needs to take me to the inventory page, exactly at
  // that item" — receiving stock is the moment you want to see what it did to
  // that item, and a page that lands you at the top of a list of 64 has made
  // you do the finding.
  useEffect(() => {
    if (loading || !items.length) return;
    const want = new URLSearchParams(window.location.search).get("item");
    if (!want) return;
    const found = items.find((i) => i.id === want);
    if (!found) return;
    void toggleBreakdown(found);
    // Take it out of the address bar so a refresh does not reopen it forever.
    window.history.replaceState({}, "", "/inventory");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, items.length]);

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
    "mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-brand-500/30";

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
    // Focused on one supplier: show only what THEY sell. Filtering rather than
    // re-ordering, because "everything, with theirs near the top" still leaves
    // you scanning a list to answer "what do I buy from them?".
    if (vendorFocus !== "all") {
      const opts = itemSuppliers[i.id] ?? [];
      if (!opts.some((o) => o.vendor_id === vendorFocus)) return false;
    }
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
    <Workbench
      title="Inventory"
      subtitle="Items, stock levels, suppliers and weighted-average cost."
      action={
        <>
          <input
            ref={templateInput}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onTemplateFile}
          />
          {canWrite && (
            <button
              onClick={() => {
                cancelEdit();
                setAdding(true);
              }}
              className="mise-press rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-900/30 hover:bg-brand-700"
            >
              ＋ Add item
            </button>
          )}
          <BenchMenu
            items={[
              ...(canWrite
                ? [
                    {
                      label: seeding ? "Adding…" : "Add common items",
                      icon: "✨",
                      hint: "a ready-made starter list, so you don’t begin empty",
                      disabled: seeding,
                      onSelect: addCommonItems,
                    },
                  ]
                : []),
              {
                label: "Download template",
                icon: "⬇",
                hint: "a blank sheet to fill in",
                onSelect: () => setTemplateModal(true),
              },
              {
                label: importBusy ? "Checking…" : "Import a filled template",
                icon: "⬆",
                hint: "checked strictly, and it tells you the exact fix. No AI.",
                disabled: importBusy,
                onSelect: () => templateInput.current?.click(),
              },
              { label: "sep", divider: true },
              {
                label: "Export stock valuation",
                icon: "⬇",
                hint: "Excel",
                onSelect: () => downloadFile("/inventory/items.xlsx", "mise-stock-valuation.xlsx"),
              },
              {
                label: "Export as CSV",
                icon: "⬇",
                onSelect: () => downloadFile("/inventory/items.csv", "mise-stock-valuation.csv"),
              },
            ]}
          />
        </>
      }
      tools={
        <SubNav
          items={[
            {
              key: "add",
              label: "Add item",
              icon: "＋",
              onSelect: () => {
                cancelEdit();
                setAdding(true);
              },
            },
            {
              key: "search",
              label: "Find an item",
              icon: "🔍",
              onSelect: () => {
                setStatusFilter("all");
                setCatFilter("all");
                setVendorFocus("all");
                spotlight("inventory-search");
              },
            },
            {
              key: "low",
              label: "Running low",
              icon: "⚠",
              count: counts.low + counts.out,
              tone: counts.out > 0 ? "bad" : "warn",
              onSelect: () => {
                setStatusFilter(counts.out > 0 ? "out" : "low");
                spotlight("inventory-search");
              },
            },
            {
              key: "items",
              label: "View items",
              icon: "📋",
              count: items.length,
              focus: "inventory-list",
              onSelect: () => {
                setStatusFilter("all");
                setCatMgr(false);
              },
            },
            {
              key: "categories",
              label: "Categories",
              icon: "🗂",
              onSelect: () => setCatMgr(true),
            },
          ]}
          active={statusFilter === "low" || statusFilter === "out" ? "low" : undefined}
        />
      }
      tally={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-faint">
          <span>
            <b className="text-fg-soft">{filtered.length}</b>
            {filtered.length === items.length ? " items" : ` of ${items.length} shown`}
          </span>
          <span>
            <b className="text-fg-soft">
              {format(
                items.reduce(
                  (t, i) => t + Number(i.current_stock ?? 0) * Number(i.average_cost ?? 0),
                  0,
                ),
              )}
            </b>{" "}
            on hand
          </span>
          {counts.low > 0 && (
            <span className="text-amber-300">
              <b>{counts.low}</b> running low
            </span>
          )}
          {counts.out > 0 && (
            <span className="text-rose-300">
              <b>{counts.out}</b> out of stock
            </span>
          )}
        </div>
      }
    >
      {seedModal}

      {notice && (
        <p className="mt-3 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-200">
          {notice}
        </p>
      )}


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
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4"
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

      {/* Adding happens at the top of the page (you came here to do it);
          editing opens WHERE YOU CLICKED, because you were deep in the list. */}
      <FormShell
        editing={!!editingId || adding}
        onClose={cancelEdit}
        title={editingId ? "Edit item" : "Add an item"}
        subtitle={form.name || (editingId ? undefined : "A name and a unit are enough to start")}
        icon={categoryEmoji(form.category || "")}
        innerRef={formRef}
        flash={flash}
      >
      <Card className="border-0 bg-transparent p-0 shadow-none">
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

          {/* The buying chain. One "Sold in packs?" box could say
              "1 box = 15 kg" and nothing else — it could not say a box holds
              10 small boxes holding 30 packets of 50 g, which is what he
              actually buys, and so ordering could only ever offer the one
              shape somebody picked when the item was created. */}
          <div className="mt-3">
            {editingId ? (
              <>
                {/* The size editor is GONE from here, on his instruction:
                    "still you have that add-size feature in inventory itself —
                     that size needs to be auto-picked like price bro, auto pick
                     from vendor and show in inventory."
                    Which is right, and consistent with how price already works:
                    nothing about how a thing is BOUGHT is typed on this page,
                    because none of it is a fact about the ingredient. It is a
                    fact about whoever sells it. So this reads the suppliers
                    back instead of asking.

                    What each supplier ACTUALLY sells. "We can
                    clearly see these are from vendor side, so in vendor
                    section only we need to do this — and inventory need to
                    gather information and show it in detail." */}
                <div className="rounded-xl border border-line bg-paper-2/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                    How each supplier sells it
                  </p>
                  {formSuppliers.length === 0 ? (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint">
                      Nobody prices this yet. Say who sells it, in what — bottle, box, packet —
                      and for how much on the{" "}
                      <Link href="/vendors" className="font-medium text-brand-400 hover:underline">
                        Vendors
                      </Link>{" "}
                      page, and it appears here.
                    </p>
                  ) : (
                    <>
                      <ul className="mt-2 space-y-1">
                        {formSuppliers.map((sv) => {
                          const own = parseFloat(sv.pack_size_override ?? "");
                          const differs = Number.isFinite(own) && own > 0;
                          // The SAVED chain — only it carries ids and a computed
                          // base_size, and a supplier's quote points at a saved rung.
                          const lvl = sv.pack_level_id
                            ? (editingItem?.pack_levels ?? []).find((l) => l.id === sv.pack_level_id)
                            : null;
                          const size = differs ? own : parseFloat(lvl?.base_size ?? "0") || 0;
                          const price = parseFloat(sv.price_per_unit) || 0;
                          return (
                            <li key={sv.vendor_id}>
                              {/* The whole row goes to that supplier's prices —
                                  "click anything, do anything". The old version
                                  only had a link in the paragraph underneath,
                                  which is what he clicked and nothing happened. */}
                              <Link
                                href={`/vendors?vendor=${sv.vendor_id}`}
                                className="mise-press flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-xs transition hover:bg-paper-3"
                              >
                                <span className="font-medium text-fg">
                                  {sv.vendor_name}
                                  {sv.is_preferred && <span className="ml-1 text-amber-300">★</span>}
                                </span>
                                <span className="text-fg-soft">
                                  {lvl && size > 0 ? (
                                    <>
                                      1 {lvl.name} = <b className="text-fg">{size}</b> {form.unit}
                                      {price > 0 && ` · ${format(price.toFixed(2))}`}
                                      {differs && (
                                        <span className="mise-tone-warn ml-1.5 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium">
                                          their own size
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      sold loose, per {form.unit}
                                      {price > 0 && ` · ${format(price.toFixed(2))}`}
                                    </>
                                  )}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
                        Read from whoever quoted it, the same way the price is — tap a supplier to
                        change what they sell it in. Two suppliers can both say
                        &ldquo;bottle&rdquo; and mean different sizes, and both stay right.
                      </p>
                    </>
                  )}
                </div>
              </>
            ) : (
              /* Paused on a NEW item, exactly like the supplier field above it.
                 How something is bought — box, bottle, pack, and how much is
                 inside — is a fact about the SUPPLIER, and there is no supplier
                 yet. Asking here invites a number that later turns out to be
                 only one supplier's version of a bottle. */
              <div className="rounded-xl border border-line bg-paper-2/60 p-3 text-xs text-fg-faint">
                📦 <span className="font-medium text-fg-soft">How it is bought comes later.</span>{" "}
                Box, bottle, pack — and how many {form.unit || "units"} are inside — is set per
                supplier, because 1 bottle is not the same size at every supplier. Add the item
                first, then say how each one sells it on the{" "}
                <Link href="/vendors" className="font-medium text-brand-400 hover:underline">
                  Vendors
                </Link>{" "}
                page.
              </div>
            )}
          </div>

          {/* Supplier + price. You can only pick a vendor who actually quotes
              this item, and the price is theirs — never typed here, because a
              hand-typed price would quietly diverge from what you really pay. */}
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-paper-2/40 p-3 sm:flex-row sm:items-end">
            <div className="flex-1 sm:min-w-[12rem]">
              <label className="block text-sm font-medium text-fg-soft">Supplier</label>
              <select
                value={formVendor}
                onChange={(e) => chooseSupplier(e.target.value)}
                disabled={formSuppliers.length === 0}
                className={`${inputCls} disabled:opacity-50`}
              >
                <option value="">
                  {formSuppliers.length === 0 ? "No supplier prices this yet" : "Choose a supplier…"}
                </option>
                {formSuppliers.map((v) => (
                  <option key={v.vendor_id} value={v.vendor_id}>
                    {v.vendor_name} — {format(v.price_per_unit)}
                    {v.is_preferred ? " ★" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full sm:w-40">
              <label className="block text-sm font-medium text-fg-soft">Their price</label>
              <input
                value={pickedSupplier ? format(pickedSupplier.price_per_unit) : ""}
                readOnly
                placeholder="—"
                title="Comes from the supplier's price list"
                className={`${inputCls} cursor-not-allowed opacity-70`}
              />
            </div>
            <p className="w-full text-xs text-fg-faint sm:max-w-[16rem]">
              {!editingId
                ? "Add the item first, then price it against a supplier."
                : formSuppliers.length === 0
                  ? "Nobody prices this item yet — add a price on the Vendors page and it appears here."
                  : vendorMsg ?? "Picking a supplier makes it the chosen one for costing."}
            </p>
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

          {/* WHO SELLS IT, AND FOR HOW MUCH — while you are still here.
              The round trip his hotel's staff are tired of was: add the item,
              leave for Vendors, find it again, set a price, come back to check.
              This writes to the same place the Vendors page writes to; the only
              thing that changed is where you are standing when you do it.
              Optional on purpose — a name and a unit are still enough to start,
              and an item you have not priced yet is a real thing. */}
          {!editingId && (
            <div className="mise-card-inset p-3.5">
              <p className="text-sm font-medium text-fg">
                Who supplies it? <span className="text-fg-faint">(optional)</span>
              </p>
              <p className="mt-0.5 text-xs text-fg-faint">
                Add the price here and you will not have to go to Vendors and come back.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_9rem]">
                <select
                  value={addVendor}
                  onChange={(e) => {
                    setAddVendor(e.target.value);
                    if (e.target.value) setNewVendorName("");
                  }}
                  aria-label="Supplier"
                  className={inputCls}
                >
                  <option value="">— pick one, or type a new name below —</option>
                  {vendorList.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <label className="block">
                  <span className="sr-only">Price</span>
                  <input
                    value={addPrice}
                    onChange={(e) => setAddPrice(e.target.value.replace(/[^\d.]/g, ""))}
                    inputMode="decimal"
                    placeholder={`price per ${form.unit || "unit"}`}
                    aria-label={`Price per ${form.unit || "unit"}`}
                    className={inputCls}
                  />
                </label>
              </div>
              {!addVendor && (
                <input
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  placeholder="…or type a new supplier's name"
                  aria-label="New supplier name"
                  className={`${inputCls} mt-2`}
                />
              )}
              {(addVendor || newVendorName.trim()) && parseFloat(addPrice) > 0 && (
                <p className="mt-2 text-[11px] text-brand-300">
                  Saved together — and this becomes the ★ chosen supplier, since it is the
                  only one.
                </p>
              )}
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
            {(editingId || adding) && (
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
      </FormShell>

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* ── the shelf, as a bento: rings + live vitals + the nudge ──
              CLOSED by default. His correction on what "no scroll" means:
              "we need to show data in different UI style where no need to
              scroll... but if i want to see i need to scroll". This panel is a
              donut and six tiles, and it owned the entire first screen of a
              page whose job is showing stock — so you scrolled past a picture
              of your money to reach your money.
              The numbers it leads with are already on the pinned tally at the
              bottom, always visible. So it opens on request instead. */}
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => setShowMoney((v) => !v)}
              aria-expanded={showMoney}
              className="mise-press mb-3 flex w-full items-center gap-2 rounded-xl border border-line px-3.5 py-2 text-left text-sm text-fg-soft transition hover:border-brand-400/40"
            >
              <span aria-hidden>📊</span>
              <span className="flex-1">Where your stock money sits</span>
              <span aria-hidden className="text-fg-faint">{showMoney ? "▲" : "▼"}</span>
            </button>
          )}
          {showMoney && items.length > 0 && (() => {
            const active = items.filter((i) => i.is_active);
            const valued = active
              .map((i) => ({
                label: i.name,
                value: (parseFloat(i.current_stock) || 0) * (parseFloat(i.average_cost) || 0),
              }))
              .filter((x) => x.value > 0);
            const total = valued.reduce((s, x) => s + x.value, 0);
            const lows = active.filter((i) => stockState(i).label === "running low").length;
            const outs = active.filter((i) => stockState(i).label === "out of stock").length;
            const cats = new Set(active.map((i) => i.category?.trim() || "Other")).size;
            return (
              <div className="mb-4 grid gap-4 lg:grid-cols-3">
                {valued.length >= 2 && (
                  <Card className="mise-feel lg:col-span-2">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-semibold text-fg">Where your stock money sits</h3>
                      <span className="font-mono text-sm font-semibold text-copper-300">
                        <AnimatedNumber value={total * CURRENCIES[currency].rate} prefix={CURRENCIES[currency].symbol} decimals={2} />
                        <span className="ml-1 text-xs font-normal text-fg-faint">on the shelf</span>
                      </span>
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
                )}
                <div className={`flex flex-col gap-4 ${valued.length < 2 ? "lg:col-span-3" : ""}`}>
                  <div className="grid flex-1 grid-cols-2 gap-3">
                    {[
                      { label: "items on the shelf", value: String(active.length), cls: "text-fg" },
                      { label: "categories", value: String(cats), cls: "text-fg" },
                      { label: "running low", value: String(lows), cls: lows ? "text-amber-300" : "text-fg-faint" },
                      { label: "out of stock", value: String(outs), cls: outs ? "text-rose-300" : "text-fg-faint" },
                    ].map((kpi) => (
                      <div key={kpi.label} className="mise-well mise-feel flex flex-col justify-center rounded-2xl p-3.5">
                        <p className={`font-mono text-2xl font-bold ${kpi.cls}`}>{kpi.value}</p>
                        <p className="mt-0.5 text-[11px] leading-tight text-fg-faint">{kpi.label}</p>
                      </div>
                    ))}
                  </div>
                  {lows + outs > 0 && (
                    <div className="mise-well mise-feel rounded-2xl border border-amber-400/20 px-4 py-3">
                      <p className="text-sm text-fg">
                        <span aria-hidden className="mr-1.5">🛎️</span>
                        <b>{lows + outs}</b> item{lows + outs === 1 ? "" : "s"} need{lows + outs === 1 ? "s" : ""} ordering
                      </p>
                      <div className="mt-2 flex gap-2">
                        {lows > 0 && (
                          <button type="button" onClick={() => setStatusFilter("low")} className="mise-press rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-400/20">
                            Show {lows} low
                          </button>
                        )}
                        {outs > 0 && (
                          <button type="button" onClick={() => setStatusFilter("out")} className="mise-press rounded-lg border border-rose-400/40 bg-rose-400/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-400/20">
                            Show {outs} out
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Search + filters */}
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div id="inventory-search" className="relative min-w-0 flex-1 scroll-mt-24 sm:max-w-md">
                <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint">🔍</span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search items…"
                  aria-label="Search items"
                  className="mise-well w-full rounded-xl py-2.5 pl-9 pr-3 text-sm text-fg outline-none"
                />
              </div>
              {/* Every supplier that prices at least one item. Built from the
                  data rather than the vendor list, so it never offers a
                  supplier with nothing to show. */}
              {(() => {
                const seen = new Map<string, string>();
                Object.values(itemSuppliers).forEach((opts) =>
                  opts.forEach((o) => seen.set(o.vendor_id, o.vendor_name)),
                );
                if (seen.size === 0) return null;
                return (
                  <Select
                    value={vendorFocus}
                    onChange={setVendorFocus}
                    className="w-56"
                    options={[
                      { value: "all", label: "All suppliers" },
                      ...[...seen.entries()]
                        .sort((a, b) => a[1].localeCompare(b[1]))
                        .map(([id, name]) => ({ value: id, label: name })),
                    ]}
                  />
                );
              })()}
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
                {categories.map((c) => {
                  const n = items.filter((i) => i.is_active && (i.category?.trim() || "Other") === c).length;
                  return (
                    <button key={c} type="button" onClick={() => setCatFilter(c)} className={catChip(catFilter === c)}>
                      {categoryEmoji(c)} {c}
                      <span className="ml-1.5 rounded-full bg-glass/10 px-1.5 text-[10px] text-fg-faint">{n}</span>
                    </button>
                  );
                })}
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

          <p className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-faint">
            <span
              className="mise-press inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-bold"
              title="The bar under each stock figure = how full the shelf is vs its reorder line. Red: below minimum — order now. Amber: within 1.5× of minimum — getting close. Green: healthy."
            >
              i
            </span>
            Shelf bar:
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-rose-400" /> below min</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-amber-400" /> near min</span>
            <span className="inline-flex items-center gap-1"><span className="h-1.5 w-3 rounded-full bg-brand-500" /> healthy</span>
          </p>
          {/* phones: the shelf as cards — thumb-sized, no sideways table */}
          <div className="space-y-2.5 lg:hidden">
            {visible.length === 0 ? (
              <Card><p className="py-6 text-center text-sm text-fg-faint">{items.length === 0 ? "No items yet — add your first above." : "Nothing matches the filters."}</p></Card>
            ) : (
              visible.map((item) => {
                const st = stockState(item);
                return (
                  <Card key={item.id} className="mise-feel p-3.5">
                    {/* On a phone this card did NOTHING when tapped — the whole
                        detail sheet, purchases by supplier and all, existed on
                        desktop only, because the click lived on the table row.
                        "if i click item nothing happening in mobile." It opens
                        the same sheet now. No button sits inside this region,
                        so nothing is nested where it should not be. */}
                    <button
                      type="button"
                      onClick={() => toggleBreakdown(item)}
                      aria-expanded={expanded === item.id}
                      className="mise-press flex w-full items-center gap-3 text-left"
                    >
                      <span aria-hidden className="mise-well grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg">
                        {categoryEmoji(item.category?.trim() || "Other")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1">
                          <span className="truncate font-medium text-fg">{item.name}</span>
                          <span aria-hidden className="shrink-0 text-fg-faint">›</span>
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-fg-faint">
                          <span className={`inline-flex items-center gap-1 font-medium ${st.cls}`}>{st.dot} {st.label}</span>
                          · {item.category || "Uncategorised"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-sm font-semibold text-fg">{fmtQty(item.current_stock, item.unit)}</span>
                        {stockInPacks(item, undefined, itemSuppliers[item.id]) && (
                          <span className="block text-[10px] text-fg-faint">
                            {stockInPacks(item, undefined, itemSuppliers[item.id])}
                          </span>
                        )}
                        <span className="block text-[10px] text-fg-faint">{format(item.average_cost)} avg</span>
                      </span>
                    </button>
                    <StockBar item={item} />
                    <div className="mt-2.5 flex items-center gap-2">
                      {item.best_vendor ? (
                        <span className="min-w-0 truncate text-xs text-fg-soft"><span className="text-brand-400">★</span> {item.best_vendor}</span>
                      ) : (
                        <Link href="/vendors?new=1" className="text-xs text-amber-300">+ add supplier</Link>
                      )}
                      <span className="flex-1" />
                      {canWrite && (
                        <>
                          <button
                            onClick={() => orderItem(item)}
                            disabled={(item.vendor_count ?? 0) === 0}
                            className="mise-press rounded-lg border border-brand-400/30 bg-brand-400/10 px-3 py-1.5 text-xs font-semibold text-brand-300 disabled:opacity-40"
                          >
                            🛒 Order
                          </button>
                          <button onClick={() => startEdit(item)} className="mise-raised mise-press rounded-lg px-3 py-1.5 text-xs font-medium text-fg-soft">
                            ✎
                          </button>
                        </>
                      )}
                    </div>
                  </Card>
                );
              })
            )}
          </div>

          <Card id="inventory-list" className="hidden scroll-mt-24 p-0 lg:block">
            {/* No height cap and no overflow here on purpose. This div used to be
                max-h-[62vh] overflow-auto, which put a scrollbar inside the page's
                own scrollbar — the list could only ever show 62% of what was left
                after the form above it, and the two scrollers fought each other.
                The page is a Workbench now: it owns the height, the list takes
                what remains, and the sticky header below sticks against THAT. */}
            <div>
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
                          className={`border-b border-line/60 transition even:bg-glass/[0.02] hover:bg-glass/[0.05] ${
                            hasHistory ? "cursor-pointer" : ""
                          } ${isOpen ? "bg-glass/[0.04]" : ""} ${st.label === "running low" ? "mise-low-pulse" : ""}`}
                          onClick={hasHistory ? () => toggleBreakdown(item) : undefined}
                          aria-expanded={hasHistory ? isOpen : undefined}
                        >
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <span aria-hidden className="mise-well grid h-9 w-9 shrink-0 place-items-center rounded-xl text-base">
                                {categoryEmoji(item.category?.trim() || "Other")}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-fg">{item.name}</p>
                                <p className="mt-0.5 truncate text-xs text-fg-faint">{item.category || "Uncategorised"}</p>
                              </div>
                            </div>
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
                                className="mise-press inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-500 transition hover:bg-amber-400/20 dark:text-amber-300"
                              >
                                ★ choose{(item.vendor_count ?? 0) > 1 ? ` · ${item.vendor_count}` : ""}
                              </Link>
                            ) : (
                              <Link
                                href="/vendors?new=1"
                                onClick={(e) => e.stopPropagation()}
                                title="No vendor sells this yet — add a price for it on the Vendors page"
                                className="mise-press inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line px-2.5 py-1 text-[11px] font-medium text-fg-faint transition hover:border-amber-400/40 hover:text-amber-500 dark:hover:text-amber-300"
                              >
                                + supplier
                              </Link>
                            )}
                            {multiVendor && item.best_vendor && (
                              <span className="ml-2 inline-flex items-center whitespace-nowrap rounded-full border border-brand-400/30 bg-brand-400/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-300">
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
                            <div className="ml-auto max-w-[8rem]">
                              <StockBar item={item} />
                            </div>
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
        <SheetPopup
          onClose={() => setTemplateModal(false)}
          title="Download import template"
          subtitle="Fill the Excel or CSV, then use ⬆ Import (template). PDF is a printable reference."
        >
            <div className="grid gap-2">
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
        </SheetPopup>
      )}

      {/* Item detail — opens in place, with room for the full story */}
      <DetailSheet
        open={!!openItem}
        onClose={() => { setExpanded(null); setOpenReceipt(null); }}
        width="lg"
        icon={categoryEmoji(openItem?.category ?? "")}
        title={openItem ? openItem.name : ""}
        subtitle={openItem ? `${openItem.category || "uncategorised"} · ${openItem.vendor_count ?? 0} supplier${(openItem.vendor_count ?? 0) === 1 ? "" : "s"}` : ""}
        ring={
          openItem && (parseFloat(openItem.min_stock_level ?? "0") || 0) > 0 ? (
            <SheetRing
              pct={Math.min(
                100,
                ((parseFloat(openItem.current_stock) || 0) / (parseFloat(openItem.min_stock_level!) || 1)) * 100,
              )}
              label={`stock is at ${Math.round(
                ((parseFloat(openItem.current_stock) || 0) / (parseFloat(openItem.min_stock_level!) || 1)) * 100,
              )}% of your minimum level (capped at 100)`}
            />
          ) : undefined
        }
        stats={
          openItem
            ? [
                {
                  label: "On hand",
                  value: fmtQty(openItem.current_stock, openItem.unit),
                  // Counted in the unit recipes take, said in the sizes you buy
                  // it in — "45 g" and "1 packet + 15 g" are the same fact, but
                  // only one of them means anything in a store room.
                  hint: stockInPacks(openItem, undefined, itemSuppliers[openItem.id]) || undefined,
                },
                {
                  label: "Stock value",
                  value: format(
                    String((parseFloat(openItem.current_stock) || 0) * (parseFloat(openItem.average_cost) || 0)),
                  ),
                },
                {
                  label: "Avg cost",
                  value: format(openItem.average_cost),
                  // What that works out to per pack, when the item comes in
                  // packs. "£1.00 per piece" is true but a buyer thinks in
                  // bottles, and doing the multiplication in their head is how
                  // an order comes out thirty times wrong.
                  // ...but ONLY when there is one answer. With three suppliers
                  // whose box holds 100, 20 and 5 kg, "1 box = 50 kg" is not a
                  // simplification, it is a number nobody quoted. Inventory has
                  // no single supplier in view, so when they disagree it says so
                  // and names them instead of picking one.
                  hint: (() => {
                    const levels = openItem.pack_levels ?? [];
                    if (levels.length === 0) return `per ${openItem.unit}`;
                    const sizes = packSizes(openItem, itemSuppliers[openItem.id]);
                    const split = sizes.some((p) => p.agreed === null);
                    if (split) return `per ${openItem.unit} · packs differ by supplier`;
                    return `per ${openItem.unit} · ${chainSummary(openItem)[0]}`;
                  })(),
                },
              ]
            : undefined
        }
      >
        {openItem && (
          <>
            {/* EDIT IT WHERE IT IS WRITTEN.
                "in inventory I want useful UI UX bro... like in-place edit."
                These three were read-only, so changing a minimum level meant
                opening a form that asked about eight fields — seven of which
                you did not come to change. Click the value, change it, Enter.
                The full form still exists for creating an item and for the
                fields that genuinely travel together. */}
            <div className="mise-card-inset grid grid-cols-2 gap-3 p-3.5 sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                  Min level
                </p>
                <div className="mt-0.5 text-sm">
                  <InlineEdit
                    label="Minimum stock level"
                    type="number"
                    value={openItem.min_stock_level ?? ""}
                    suffix={openItem.unit}
                    disabled={!canWrite}
                    onSave={async (v) => {
                      await api.patch(`/inventory/items/${openItem.id}`, {
                        min_stock_level: v === "" ? null : v,
                      });
                      await load();
                    }}
                  />
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                  Category
                </p>
                <div className="mt-0.5 text-sm">
                  <InlineEdit
                    label="Category"
                    value={openItem.category ?? ""}
                    disabled={!canWrite}
                    /* The categories already in use, so this stays a small set
                       rather than becoming free text that spawns "Veg",
                       "veg" and "Vegetables" as three different things. */
                    options={[
                      { value: "", label: "— none —" },
                      ...[...new Set(items.map((i) => (i.category || "").trim()).filter(Boolean))]
                        .sort()
                        .map((c) => ({ value: c, label: c })),
                    ]}
                    onSave={async (v) => {
                      await api.patch(`/inventory/items/${openItem.id}`, { category: v || null });
                      await load();
                    }}
                  />
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                  Suppliers
                </p>
                <p className="mt-0.5 text-sm text-fg">{openItem.vendor_count ?? 0}</p>
              </div>
            </div>

            {/* Change the supplier from HERE.
                "in inventory I need to change the vendor of an item from the
                inventory screen itself." It was only possible inside the edit
                form, which meant opening a whole item to change one field —
                and the sheet was already showing you the number of suppliers
                while giving you no way to act on it.

                Prices are per BASE unit, which is what makes them comparable:
                one supplier's £50 is a 5 kg box and another's is 100 kg. */}
            {(() => {
              const sups = itemSuppliers[openItem.id] ?? [];
              if (sups.length === 0) return null;
              const chosen = sups.find((v) => v.is_preferred);
              return (
                <div className="mise-panel-in mt-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                      🚚 Chosen supplier
                    </p>
                    {chosen && (
                      <span className="text-[11px] text-fg-faint">
                        costing uses this price
                      </span>
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {sups.map((v) => {
                      const on = v.is_preferred;
                      const each = pricePerBase(openItem, v);
                      return (
                        <button
                          key={v.vendor_id}
                          type="button"
                          data-testid="inv-supplier-pick"
                          disabled={!canWrite || on}
                          onClick={() => setChosenSupplier(openItem.id, v.vendor_id)}
                          title={
                            canWrite
                              ? on
                                ? `${v.vendor_name} is already the chosen supplier`
                                : `Buy ${openItem.name} from ${v.vendor_name} instead`
                              : "You do not have permission to change this"
                          }
                          className={`mise-press flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
                            on
                              ? "border-brand-400/50 bg-brand-400/10"
                              : "border-line hover:border-brand-400/40 disabled:opacity-60"
                          }`}
                        >
                          <span aria-hidden className={on ? "text-brand-300" : "text-fg-faint"}>
                            {on ? "★" : "☆"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-fg">
                              {v.vendor_name}
                            </span>
                            <span className="block truncate text-[11px] text-fg-faint">
                              {supplierPackSize(openItem, v)
                                ? `${format(String(v.price_per_unit))} per ${levelName(openItem, v.pack_level_id)}`
                                : "no price yet"}
                            </span>
                          </span>
                          {each > 0 && (
                            <span className="shrink-0 text-right text-xs tabular-nums text-fg-soft">
                              {format(each.toFixed(2))}
                              <span className="block text-[10px] text-fg-faint">
                                per {openItem.unit}
                              </span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {vendorMsg && (
                    <p className="mt-2 text-[11px] text-brand-300">{vendorMsg}</p>
                  )}
                </div>
              );
            })()}
            <div className="mt-5">
                              <div className="mise-panel-in">
                                <div className="flex items-center justify-between">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                                    🏷 Purchases by supplier
                                  </p>
                                  {openRows && openRows.length > 0 && (
                                    <span className="text-xs text-fg-faint">
                                      {openRows.length} recent purchase{openRows.length === 1 ? "" : "s"}
                                    </span>
                                  )}
                                </div>
                                {bdLoading === openItem.id ? (
                                  <p className="mt-3 text-xs text-fg-faint">Loading…</p>
                                ) : openRows && openRows.length > 0 ? (
                                  <>
                                    {(priceHist[openItem.id]?.length ?? 0) >= 2 && (
                                      <div className="mise-well mt-3 rounded-xl p-3">
                                        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                                          Price you paid per {openItem.unit} — over time
                                        </p>
                                        <AreaChart
                                          data={priceHist[openItem.id].map((p) => parseFloat(p.price) || 0)}
                                          labels={priceHist[openItem.id].map((p) => p.date)}
                                          color={
                                            (parseFloat(priceHist[openItem.id][priceHist[openItem.id].length - 1].price) || 0) >
                                            (parseFloat(priceHist[openItem.id][0].price) || 0)
                                              ? "#f43f5e"
                                              : "#10b981"
                                          }
                                          height={90}
                                          formatValue={(v) => format(String(v))}
                                        />
                                      </div>
                                    )}
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                      {openRows.map((r, idx) => (
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
                                              {/* HOW BIG THEIR PACK IS, on the
                                                  delivery it arrived on. "we
                                                  need to show clearly that this
                                                  vendor box has 50kg, other
                                                  vendor 1 box 100kg." Without
                                                  it the quantities above look
                                                  like they disagree for no
                                                  reason. */}
                                              {/* A ONE-OFF, called out. He asked
                                                  for the per-purchase supplier
                                                  choice and warned about it in
                                                  the same breath: "we need to
                                                  note and show this clearly in
                                                  inventory or else it will be a
                                                  pile up confusion in future."
                                                  So when a delivery came from
                                                  anyone but the ★ chosen
                                                  supplier, the row says so. */}
                                              {(() => {
                                                const opts = itemSuppliers[openItem.id] ?? [];
                                                const star = opts.find((x) => x.is_preferred);
                                                if (!star || !r.vendor_id || star.vendor_id === r.vendor_id) {
                                                  return null;
                                                }
                                                return (
                                                  <p className="mise-tone-warn mt-0.5 text-[11px]">
                                                    one-off · your usual is {star.vendor_name}
                                                  </p>
                                                );
                                              })()}
                                              {(() => {
                                                const sv = (itemSuppliers[openItem.id] ?? []).find(
                                                  (s) => s.vendor_id === r.vendor_id,
                                                );
                                                if (!sv?.pack_level_id) return null;
                                                const lvl = (openItem.pack_levels ?? []).find(
                                                  (l) => l.id === sv.pack_level_id,
                                                );
                                                if (!lvl) return null;
                                                const own = parseFloat(sv.pack_size_override ?? "");
                                                const differs = Number.isFinite(own) && own > 0;
                                                const size = differs ? own : parseFloat(lvl.base_size) || 0;
                                                if (size <= 0) return null;
                                                return (
                                                  <p className="mt-0.5 text-[11px] text-fg-soft">
                                                    their 1 {lvl.name} ={" "}
                                                    <b className="text-fg">{size} {openItem.unit}</b>
                                                    {differs && (
                                                      <span className="mise-tone-warn ml-1">· their own size</span>
                                                    )}
                                                  </p>
                                                );
                                              })()}
                                            </div>
                                          </div>
                                          <div className="shrink-0 pl-2 text-right">
                                            <p className="font-semibold text-fg">{fmtQty(r.quantity, openItem.unit)}</p>
                                            {r.unit_cost != null && (
                                              <p className="font-mono text-xs text-brand-300">{format(r.unit_cost)}/{openItem.unit}</p>
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
                                                  {l.item_name.toLowerCase() === openItem.name.toLowerCase() && (
                                                    <span className="ml-1 text-brand-300">(this openItem)</span>
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
                                          <p className="mt-2 text-xs text-fg-faint">Just this openItem was on that delivery.</p>
                                        )}
                                      </div>
                                    )}
                                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-line pt-3 text-xs text-fg-faint">
                                      <span>On hand <b className="font-semibold text-fg-soft">{fmtQty(openItem.current_stock, openItem.unit)}</b></span>
                                      <span>Avg cost <b className="font-semibold text-fg-soft">{format(openItem.average_cost)}/{openItem.unit}</b></span>
                                      <span>Bought (recent) <b className="font-semibold text-fg-soft">{fmtQty(openRows.reduce((s, r) => s + parseFloat(r.quantity || "0"), 0), openItem.unit)}</b></span>
                                      <span>Last received <b className="font-semibold text-fg-soft">{new Date(openRows[0].received_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</b></span>
                                    </div>
                                    <p className="mt-2.5 text-[11px] leading-relaxed text-fg-faint">
                                      Stock from different suppliers mixes into one pool — so DineAI values your {fmtQty(openItem.current_stock, openItem.unit)} on hand at the weighted-average {format(openItem.average_cost)}/{openItem.unit} rather than guessing whose stock is left.
                                    </p>

                                    {/* When suppliers disagree about how big a
                                        pack is, SAY SO. Averaging the cost is
                                        fair because a kg is a kg whoever sent
                                        it — but a box is not a box, so there is
                                        no honest single box count to print. */}
                                    {packDisagreement(openItem, itemSuppliers[openItem.id]) && (
                                      <p className="mise-tone-warn mt-2 rounded-lg bg-amber-400/10 px-2.5 py-2 text-[11px] leading-relaxed">
                                        <b>Packs are not the same size here.</b>{" "}
                                        {packDisagreement(openItem, itemSuppliers[openItem.id])}. Your{" "}
                                        {fmtQty(openItem.current_stock, openItem.unit)} is counted in{" "}
                                        {openItem.unit} for that reason — there is no one box to count
                                        it in.
                                      </p>
                                    )}
                                    {/* ── EVERY WAY YOU CAN BUY IT ──────────
                                        "in inventory we need to show them
                                         clearly... even though they have
                                         different price they all (box, loose
                                         kg, g etc) are 1 item only."
                                        Cheapest per base unit first, because
                                        that is the only ranking that survives
                                        a box and a loose kilo being compared. */}
                                    {(() => {
                                      const opts = itemSuppliers[openItem.id] ?? [];
                                      if (opts.length === 0) return null;
                                      const ways = opts
                                        .map((v) => ({
                                          v,
                                          per: pricePerBase(openItem, v),
                                          form: v.pack_level_id
                                            ? levelName(openItem, v.pack_level_id)
                                            : `loose, per ${openItem.unit}`,
                                          size: v.pack_level_id
                                            ? supplierPackSize(openItem, v)
                                            : 0,
                                        }))
                                        .filter((w) => w.per > 0)
                                        .sort((a, b) => a.per - b.per);
                                      if (ways.length === 0) return null;
                                      return (
                                        <div className="mt-4 rounded-xl border border-line bg-paper-2/50 p-3">
                                          <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
                                            Every way you can buy it
                                          </p>
                                          <ul className="mt-2 space-y-1">
                                            {ways.map((w, i) => (
                                              <li
                                                key={`${w.v.vendor_id}-${w.v.pack_level_id ?? "loose"}`}
                                                className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
                                              >
                                                <span className="min-w-0 truncate">
                                                  <span className="font-medium text-fg">
                                                    {w.v.vendor_name}
                                                  </span>
                                                  <span className="ml-1.5 text-fg-faint">
                                                    {w.v.pack_level_id
                                                      ? `by the ${w.form}${w.size > 0 ? ` (${w.size} ${openItem.unit})` : ""}`
                                                      : w.form}
                                                  </span>
                                                  {w.v.is_preferred && (
                                                    <span className="ml-1 text-amber-300">★</span>
                                                  )}
                                                </span>
                                                <span
                                                  className={`shrink-0 tabular-nums ${
                                                    i === 0 ? "mise-tone-good font-semibold" : "text-fg-soft"
                                                  }`}
                                                >
                                                  {format(w.per.toFixed(2))}/{openItem.unit}
                                                  <span className="ml-1 text-[10px] text-fg-faint">
                                                    {format(w.v.price_per_unit)}
                                                    {w.v.pack_level_id ? `/${w.form}` : ""}
                                                  </span>
                                                </span>
                                              </li>
                                            ))}
                                          </ul>
                                          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
                                            Ranked by what one {openItem.unit} really costs — a big
                                            case with a big price can still be the cheapest.
                                          </p>
                                        </div>
                                      );
                                    })()}

                                    <div className="mt-3">
                                      <Link
                                        href={`/purchasing?openItem=${openItem.id}`}
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
            </div>
          </>
        )}
      </DetailSheet>
    </Workbench>
  );
}
