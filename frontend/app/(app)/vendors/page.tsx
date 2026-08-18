"use client";

import { chainSummary, levelName, priceLines, pricePerBase, stockInPacks } from "@/lib/packs";

import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/Select";
import { DetailSheet, DetailRow, SheetRing } from "@/components/DetailSheet";
import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type Item,
  type ItemSuppliers,
  type ExpenseCategory,
  type Vendor,
  type VendorItem,
  type SupplierOption,
} from "@/lib/api";
import { Badge, Card, Spinner } from "@/components/ui";
import { EditModal } from "@/components/EditModal";
import { Workbench } from "@/components/Workbench";
import { Bars } from "@/components/charts";
import { spotlight, useDeepLink } from "@/components/fx";
import { SubNav } from "@/components/SubNav";
import { VendorLedger } from "@/components/VendorLedger";
import { ItemPickerSingle } from "@/components/ItemPicker";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { numeric } from "@/lib/sanitize";
import { fmtQty } from "@/lib/quantity";

const CATEGORIES = ["FOOD", "BEVERAGE", "BAR", "UTILITY", "SERVICE", "PROPERTY"];
const TYPE_EMOJI: Record<string, string> = {
  FOOD: "🥕", BEVERAGE: "🧃", BAR: "🍷", UTILITY: "🔌", SERVICE: "🧰", PROPERTY: "🏠",
};
const inputCls =
  "mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none";

export default function VendorsPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "vendors:write");

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [vendorItems, setVendorItems] = useState<VendorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // add-vendor form
  const [spend, setSpend] = useState<
    { vendor_name: string; total: string; orders?: number; price_rises?: number }[]
  >([]);
  // item_id -> the cheapest price ANY vendor quotes (for the emerald cell)
  const [cheapest, setCheapest] = useState<Record<string, number>>({});
  useEffect(() => {
    api
      .get<ExpenseCategory[]>("/expenses/categories")
      .then(setExpenseCats)
      .catch(() => {});
  }, []);

  useEffect(() => {
    api
      .get<{ vendors: { vendor_name: string; total: string; orders?: number; price_rises?: number }[] }>(
        "/vendors/spend?days=90",
      )
      .then((r) => setSpend(r.vendors))
      .catch(() => {});
  }, []);

  const [vName, setVName] = useState("");
  const [vCat, setVCat] = useState("FOOD");
  const [extraCats, setExtraCats] = useState<string[]>([]); // superadmin-added types
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [vContact, setVContact] = useState("");
  const [vMobile, setVMobile] = useState("");

  // add-price form
  const [piItem, setPiItem] = useState("");
  // Creating a stock item without leaving the price you came here to enter.
  // A unit is required — an item with no unit cannot be costed, ordered or
  // put in a recipe — so this asks for one rather than guessing "each".
  const [newItem, setNewItem] = useState<{ name: string; unit: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const priceRef = useRef<HTMLInputElement>(null);
  const [sheetTab, setSheetTab] = useState<"supply" | "price" | "money" | "details">("supply");
  // Editing the supplier WITHOUT leaving the sheet. "Edit details" used to
  // close it and open a page-level form, which is precisely the "edit button
  // not working" he reported — the thing he clicked vanished.
  const [ed, setEd] = useState<{ name: string; category: string; contact: string; mobile: string } | null>(null);
  const [edBusy, setEdBusy] = useState(false);
  // One supplied item, opened from the list: a sheet on top of a sheet.
  const [priceRow, setPriceRow] = useState<VendorItem | null>(null);
  // Which size the open sheet is quoting. Held in state rather than read off
  // the form, because the "1 bottle holds ___" line has to appear and vanish
  // as the size changes — a pack has a size, loose does not.
  const [sheetLevel, setSheetLevel] = useState("");
  const [expenseCats, setExpenseCats] = useState<ExpenseCategory[]>([]);
  const [piPrice, setPiPrice] = useState("");
  // The supplier NAMES what they sell in, right next to the price, rather than
  // picking a rung somebody had to create in Inventory first:
  //   "that size need to be auto-picked like price bro, auto pick from vendor
  //    and show in inventory... where we having price input field there itself
  //    we have this too, so that all at once even layman can do."
  // Empty name = sold loose, per the base unit.
  const [piPackName, setPiPackName] = useState("");
  const [piPackSize, setPiPackSize] = useState("");

  function load() {
    return Promise.all([
      api.get<Vendor[]>("/vendors").then(setVendors),
      api.get<Item[]>("/inventory/items").then(setItems),
      api
        .get<ItemSuppliers[]>("/purchasing/item-suppliers")
        .then((rows) => {
          const map: Record<string, number> = {};
          for (const r of rows) {
            const prices = r.vendors.map((v) => parseFloat(v.price_per_unit) || Infinity);
            if (prices.length > 1) map[r.item_id] = Math.min(...prices);
          }
          setCheapest(map);
        })
        .catch(() => {}),
    ]);
  }

  useEffect(() => {
    load().finally(() => {
      setLoading(false);
      // Deep link from Inventory's "purchases by supplier": /vendors?focus=<id>
      // opens that vendor straight away.
      const focus = new URLSearchParams(window.location.search).get("focus");
      if (focus) selectVendor(focus);
    });
  }, []);

  // Deep link from Inventory's "+ add supplier": /vendors?new=1 lands the user
  // ON the add-vendor form, scrolled in, ringed, first field focused.
  useDeepLink(
    {
      new: () => spotlight("vendor-form"),
      // /vendors?vendor=<id> opens that supplier's sheet. Price Comparison links
      // here so "who are they, what else do they sell, what do I owe them" is
      // one tap from the price that raised the question.
      vendor: () => {
        const id = new URLSearchParams(window.location.search).get("vendor");
        if (id && vendors.some((v) => v.id === id)) selectVendor(id);
      },
    },
    !loading && vendors.length > 0,
  );

  function selectVendor(id: string) {
    setSelected(id);
    setError(null);
    api.get<VendorItem[]>(`/vendors/${id}/items`).then(setVendorItems).catch(() => setVendorItems([]));
    // opens in a sheet right where you clicked — no scrolling to the bottom
  }

  /** Empty the add-a-vendor form. */
  function clearVendorForm() {
    setVName(""); setVContact(""); setVMobile(""); setVCat("FOOD");
    setError(null);
  }

  // The add form used to sit permanently above the supplier list, so the
  // page opened on a form rather than on your suppliers. It opens in place
  // now, like everything else.
  const [addingVendor, setAddingVendor] = useState(false);

  async function addVendor(e: React.FormEvent) {
    e.preventDefault();
    if (!vName.trim()) {
      setError("Vendor name is required.");
      return;
    }
    setError(null);
    try {
      const v = await api.post<Vendor>("/vendors", {
        name: vName.trim(),
        category: vCat,
        contact_person: vContact.trim() || undefined,
        mobile: vMobile.trim() || undefined,
      });
      setVName("");
      setVContact("");
      setVMobile("");
      setAddingVendor(false);
      await load();
      selectVendor(v.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add vendor");
    }
  }

  /** Open the Details section with the current values loaded. */
  function editHere(v: Vendor) {
    setEd({
      name: v.name ?? "",
      category: v.category ?? "FOOD",
      contact: v.contact_person ?? "",
      mobile: v.mobile ?? "",
    });
    setSheetTab("details");
  }

  async function saveDetails() {
    if (!selectedVendor || !ed) return;
    setEdBusy(true);
    setError(null);
    try {
      await api.patch<Vendor>(`/vendors/${selectedVendor.id}`, {
        name: ed.name.trim(),
        category: ed.category,
        contact_person: ed.contact.trim() || null,
        mobile: ed.mobile.trim() || null,
      });
      setNotice("Saved.");
      setEd(null);
      setSheetTab("supply");
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setEdBusy(false);
    }
  }

  /** Make this vendor the chosen supplier for that item. */
  async function chooseSupplier(vi: VendorItem) {
    try {
      await api.post(`/vendors/items/${vi.item_id}/preferred`, { vendor_id: selected });
      selectVendor(selected);
      setPriceRow(null);
      setNotice("Chosen supplier updated.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not set the chosen supplier.");
    }
  }

  async function addPrice(e: React.FormEvent) {
    e.preventDefault();
    if (!piItem || !piPrice) {
      setError("Pick an item and enter a price.");
      return;
    }
    setError(null);
    try {
      // The price is saved EXACTLY as the supplier quoted it, together with the
      // size it buys. It used to be divided down to a per-unit figure first —
      // £120 a box became 0.0080, rounded to four places and the real number
      // gone. Now £120 stays £120 and the app does the maths when it compares.
      const name = piPackName.trim();
      if (name && !(parseFloat(piPackSize) > 0)) {
        setError(`Say how many ${itemName(piItem) ? "units" : "units"} are in one ${name}.`);
        return;
      }
      await api.post<VendorItem>(`/vendors/${selected}/items`, {
        item_id: piItem,
        price_per_unit: piPrice,
        // The supplier's own words. An unfamiliar name joins the item's chain
        // server-side; a familiar one is reused, and the size they quoted stays
        // on THEIR row — which is the whole point when two suppliers both say
        // "bottle" and mean different numbers.
        pack_name: name,
        pack_size: name ? piPackSize : null,
      });
      setPiPrice("");
      setPiPackName("");
      setPiPackSize("");
      selectVendor(selected);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save price");
    }
  }

  async function createItemInline() {
    if (!newItem || !newItem.name.trim() || !newItem.unit.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const made = await api.post<Item>("/inventory/items", {
        name: newItem.name.trim(),
        unit: newItem.unit.trim(),
      });
      // Put it in the list in memory so the picker can select it immediately —
      // a refetch would work too, but this keeps the price form untouched.
      setItems((prev) => [...prev, made]);
      setPiItem(made.id);
      setNewItem(null);
      window.setTimeout(() => priceRef.current?.focus(), 60);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create that item");
    } finally {
      setCreating(false);
    }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setError(null);
    setNotice(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await postForm<{ created_items: number; priced_items: number; skipped: string[] }>(
        `/vendors/${selected}/items/import`,
        form,
      );
      await load();
      selectVendor(selected);
      setNotice(
        `Imported ${res.priced_items} price${res.priced_items === 1 ? "" : "s"}` +
          (res.created_items ? `, ${res.created_items} new item${res.created_items === 1 ? "" : "s"} created` : "") +
          (res.skipped.length ? `, ${res.skipped.length} row${res.skipped.length === 1 ? "" : "s"} skipped` : "") +
          ".",
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const d = err.detail as { errors?: string[] } | undefined;
        setError("Couldn't import — " + (d?.errors ?? ["the file didn't match the template."]).join("  •  "));
      } else {
        setError(err instanceof ApiError ? err.message : "Import failed");
      }
    } finally {
      e.target.value = "";
    }
  }

  async function toggleActive(v: Vendor) {
    if (v.is_active) {
      const ok = await confirm({
        title: `Deactivate ${v.name}?`,
        message: "They'll be hidden from new orders and price comparison. You can reactivate later.",
        confirmText: "Deactivate",
        tone: "danger",
      });
      if (!ok) return;
    }
    try {
      await api.patch<Vendor>(`/vendors/${v.id}`, { is_active: !v.is_active });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update vendor");
    }
  }

  async function removeVendorItem(vi: VendorItem) {
    const name = itemName(vi.item_id);
    const ok = await confirm({
      title: `Remove ${selectedVendor?.name}'s price for ${name}?`,
      message:
        "This removes ONLY this supplier's price for the item — the item, its stock and recipes all " +
        "stay. If this is the cheapest / ★ chosen supplier, recipe costs and ordering switch to the " +
        "next option (or fall back to average cost if no supplier is left). Past purchase orders are " +
        "unaffected and the price history is kept. You can re-add the price anytime.",
      confirmText: "Remove price",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/vendors/${selected}/items/${vi.item_id}`);
      setVendorItems(await api.get<VendorItem[]>(`/vendors/${selected}/items`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove the price");
    }
  }

  if (loading) return <Spinner />;

  const itemName = (id: string) => {
    const it = items.find((i) => i.id === id);
    return it ? `${it.name} (${it.unit})` : "—";
  };
  const selectedVendor = vendors.find((v) => v.id === selected);

  // The three questions a supplier row exists to answer: what do they cost us,
  // are they actually competitive, and are they creeping their prices up. These
  // sit in the sheet header so opening a vendor answers them without scrolling.
  const vendorStats = (() => {
    const mine = spend.find((r) => r.vendor_name === selectedVendor?.name);
    const total = spend.reduce((sum, r) => sum + (parseFloat(r.total) || 0), 0);
    const spent = parseFloat(mine?.total ?? "0") || 0;
    const bestCount = vendorItems.filter((vi) => {
      const best = cheapest[vi.item_id];
      return best != null && (parseFloat(vi.price_per_unit) || 0) <= best;
    }).length;
    return {
      spend: spent,
      orders: mine?.orders ?? 0,
      rises: mine?.price_rises ?? 0,
      bestCount,
      // Share of ALL supplier spend. Null when there is no spend at all, because
      // a ring reading 0% of nothing implies a fact we do not have.
      sharePct: total > 0 ? (spent / total) * 100 : null,
    };
  })();
  const pricedCount = (vid: string) => (vid === selected ? vendorItems.length : null);

  // Built-in types + any custom ones already used by vendors + ones added this
  // session — so superadmins aren't limited to the six built-ins.
  const usedCats = vendors
    .map((v) => (v.category || "").toUpperCase())
    .filter((c) => c && !CATEGORIES.includes(c));
  const allCats = [...new Set([...CATEGORIES, ...usedCats, ...extraCats])];

  function addCustomCat() {
    const c = newCat.trim().toUpperCase().slice(0, 40);
    if (!c) return;
    if (!allCats.includes(c)) setExtraCats((p) => [...p, c]);
    setVCat(c);
    setNewCat("");
    setAddingCat(false);
  }

  return (
    <Workbench
      title="Vendors"
      subtitle="Your suppliers and what each one sells."
      action={
        canWrite ? (
          <button
            type="button"
            onClick={() => {
              clearVendorForm();
              setAddingVendor(true);
            }}
            className="mise-press rounded-xl bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-900/30 hover:bg-brand-700"
          >
            ＋ Add supplier
          </button>
        ) : undefined
      }
      tools={
          <SubNav
            items={[
              {
                key: "add",
                label: "Add supplier",
                icon: "＋",
                onSelect: () => { clearVendorForm(); setAddingVendor(true); },
              },
              {
                key: "owed",
                label: "Who I owe",
                icon: "💷",
                onSelect: () => {
                  // Straight into the supplier you spend most with, on the Money
                  // tab — the question is "who do I owe", not "open a vendor".
                  const top = [...spend].sort(
                    (a, b) => (parseFloat(b.total) || 0) - (parseFloat(a.total) || 0),
                  )[0];
                  const match = vendors.find((v) => v.name === top?.vendor_name) ?? vendors[0];
                  if (match) { setSheetTab("money"); selectVendor(match.id); }
                },
              },
              {
                key: "rises",
                label: "Price rises",
                icon: "↗",
                count: spend.reduce((n, r) => n + (r.price_rises ?? 0), 0),
                tone: "warn",
                onSelect: () => spotlight("vendor-spend"),
              },
            ]}
          />
      }
      tally={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-faint">
          <span>
            <b className="text-fg-soft">{vendors.length}</b> supplier
            {vendors.length === 1 ? "" : "s"}
          </span>
          <span>
            <b className="text-fg-soft">
              {format(spend.reduce((t, r) => t + (parseFloat(r.total) || 0), 0))}
            </b>{" "}
            spent with them
          </span>
          {spend.reduce((n, r) => n + (r.price_rises ?? 0), 0) > 0 && (
            <span className="text-amber-300">
              <b>{spend.reduce((n, r) => n + (r.price_rises ?? 0), 0)}</b> price rise
              {spend.reduce((n, r) => n + (r.price_rises ?? 0), 0) === 1 ? "" : "s"} to look at
            </span>
          )}
        </div>
      }
    >


      {vendors.length === 0 && (
      <div className="mb-6 rounded-xl border border-line bg-paper-2 p-4 text-sm text-fg-soft">
        <b>How it works:</b> add a vendor → open them → add the items they supply <i>with a price</i>. Those prices feed{" "}
        <b>Price Comparison</b> and let <b>Purchasing</b> turn an indent into a PO. An item with no
        vendor price can&apos;t be ordered yet.
      </div>
      )}

      <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={onImportFile} />
      {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-brand-400/10 px-3 py-2 text-sm text-brand-300">{notice}</p>}

      {canWrite && addingVendor && (
        <EditModal
          open
          onClose={() => setAddingVendor(false)}
          title="Add a supplier"
          subtitle="A name is enough — prices and items come after"
          icon="🚚"
          width="lg"
        >
          <div id="vendor-form">

          <form onSubmit={addVendor} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-fg-soft">Name</label>
              <input value={vName} onChange={(e) => setVName(e.target.value)} placeholder="e.g. Farm2Land" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Contact (optional)</label>
              <input value={vContact} onChange={(e) => setVContact(e.target.value)} placeholder="person" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Mobile (optional)</label>
              <input value={vMobile} onChange={(e) => setVMobile(e.target.value)} placeholder="phone" className={inputCls} />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-sm font-medium text-fg-soft">Type</label>
              <div className="mt-1 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Vendor type">
                {allCats.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={vCat === c}
                    onClick={() => setVCat(c)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      vCat === c
                        ? "bg-brand-600 text-white shadow-lg shadow-brand-600/25"
                        : "border border-line-2 text-fg-soft hover:bg-glass/5"
                    }`}
                  >
                    {TYPE_EMOJI[c] ?? "🏷"} {c.toLowerCase()}
                  </button>
                ))}
                {addingCat ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      autoFocus
                      value={newCat}
                      onChange={(e) => setNewCat(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); addCustomCat(); }
                        if (e.key === "Escape") { setAddingCat(false); setNewCat(""); }
                      }}
                      placeholder="new type…"
                      maxLength={40}
                      className="w-28 rounded-full border border-brand-500 bg-glass/5 px-3 py-1.5 text-xs outline-none"
                    />
                    <button
                      type="button"
                      onClick={addCustomCat}
                      className="rounded-full bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                    >
                      Add
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingCat(true)}
                    title="Add a custom vendor type"
                    className="rounded-full border border-dashed border-line-2 px-3 py-1.5 text-xs font-medium text-fg-faint transition hover:border-brand-400/50 hover:text-brand-300"
                  >
                    ✛ Add type
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-2 sm:col-span-3">
              <button type="submit" className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Add vendor
              </button>
            </div>
          </form>
          </div>
        </EditModal>
      )}

      {spend.length > 0 && (
        <Card className="mise-feel mb-6 scroll-mt-24" id="vendor-spend">
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold text-fg">Who gets your money</h3>
            <span className="text-xs text-fg-faint">received orders · last 90 days</span>
          </div>
          <div className="mise-well mt-4 rounded-xl p-3">
            <Bars
              formatValue={(v) => format(String(v))}
              items={spend.slice(0, 8).map((x) => ({
                label: x.vendor_name,
                value: parseFloat(x.total) || 0,
                color: "#d97742",
              }))}
            />
          </div>
          {/* the scorecard: how often you order them, how often they raise prices */}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {spend.slice(0, 6).map((x) => (
              <div key={x.vendor_name} className="mise-well mise-feel flex items-baseline gap-2 rounded-lg px-3 py-2 text-xs">
                <span className="truncate font-medium text-fg">{x.vendor_name}</span>
                <span className="mb-1 flex-1 border-b border-dotted border-line" />
                <span className="shrink-0 text-fg-soft">{x.orders ?? 0} order{(x.orders ?? 0) === 1 ? "" : "s"}</span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 font-medium ${
                    (x.price_rises ?? 0) > 0 ? "bg-rose-500/15 text-rose-300" : "bg-brand-500/15 text-brand-300"
                  }`}
                  title="times this vendor moved a price UP in the last 90 days"
                >
                  {(x.price_rises ?? 0) > 0 ? `▲ ${x.price_rises} rise${x.price_rises === 1 ? "" : "s"}` : "no rises ✓"}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Vendor cards */}
      <p className="mb-2 text-sm font-medium text-fg-soft">All vendors ({vendors.length})</p>
      {vendors.length === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-fg-faint">No vendors yet. Add one above.</p>
        </Card>
      ) : (
        <div className="mise-stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map((v) => {
            const sel = selected === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => selectVendor(v.id)}
                className={`mise-feel rounded-2xl border p-4 text-left transition duration-200 ${
                  sel
                    ? "border-brand-500 bg-brand-400/10 shadow-lg shadow-brand-600/20"
                    : "mise-raised border-line"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-fg">
                      <span aria-hidden className="mr-1.5">{TYPE_EMOJI[v.category ?? ""] ?? "🤝"}</span>
                      {v.name}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-faint">
                      {(v.category || "—").toLowerCase()} supplier
                      {v.contact_person ? ` · ${v.contact_person}` : ""}
                      {v.mobile ? ` · ${v.mobile}` : ""}
                    </p>
                  </div>
                  <Badge tone={v.is_active ? "green" : "slate"}>{v.is_active ? "active" : "inactive"}</Badge>
                </div>
                <p className="mt-3 text-xs font-medium text-brand-300">
                  {sel && pricedCount(v.id) !== null ? `${pricedCount(v.id)} item${pricedCount(v.id) === 1 ? "" : "s"} priced · ` : ""}
                  Manage →
                </p>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected vendor — opens in place, so you never scroll to the bottom */}
      <DetailSheet
        open={!!selectedVendor}
        onClose={() => setSelected("")}
        width="lg"
        icon={TYPE_EMOJI[selectedVendor?.category ?? ""] ?? "🤝"}
        title={selectedVendor?.name ?? ""}
        subtitle={selectedVendor ? `${(selectedVendor.category || "—").toLowerCase()} supplier · ${vendorItems.length} item${vendorItems.length === 1 ? "" : "s"} priced` : ""}
        ring={
          vendorStats.sharePct !== null ? (
            <SheetRing
              pct={vendorStats.sharePct}
              invert
              label={`${Math.round(vendorStats.sharePct)}% of your 90-day spend goes to this supplier`}
            />
          ) : undefined
        }
        stats={
          selectedVendor
            ? [
                { label: "Spend · 90d", value: format(vendorStats.spend), hint: vendorStats.orders ? `${vendorStats.orders} order${vendorStats.orders === 1 ? "" : "s"}` : "no orders yet" },
                {
                  label: "Best price on",
                  value: `${vendorStats.bestCount}/${vendorItems.length || 0}`,
                  hint: "items vs other suppliers",
                  tone: vendorItems.length === 0 ? "plain" : vendorStats.bestCount === 0 ? "bad" : vendorStats.bestCount === vendorItems.length ? "good" : "warn",
                },
                {
                  label: "Price rises",
                  value: vendorStats.rises,
                  hint: "last 90 days",
                  tone: vendorStats.rises > 2 ? "bad" : vendorStats.rises > 0 ? "warn" : "good",
                },
              ]
            : undefined
        }
        sections={[
          { key: "supply", label: "Supplies", icon: "📦", count: vendorItems.length },
          ...(canWrite ? [{ key: "price", label: "Add a price", icon: "＋" }] : []),
          { key: "money", label: "Money", icon: "💷" },
          ...(canWrite ? [{ key: "details", label: "Details", icon: "✎" }] : []),
        ]}
        active={sheetTab}
        onSection={(k) => {
          // Opening Details loads the current values, so the section is
          // immediately editable rather than showing a blank form.
          if (k === "details" && selectedVendor) editHere(selectedVendor);
          else setSheetTab(k as typeof sheetTab);
        }}
        actions={
          canWrite && selectedVendor ? (
            <>
            <button
              onClick={() => editHere(selectedVendor)}
              className="mise-press rounded-lg border border-brand-400/40 bg-brand-400/10 px-3 py-1.5 text-sm font-medium text-brand-300"
            >
              Edit details
            </button>
            <button
              onClick={() => toggleActive(selectedVendor)}
              className="mise-press rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-fg-soft hover:bg-paper-2"
            >
              {selectedVendor.is_active ? "Deactivate" : "Reactivate"}
            </button>
            </>
          ) : null
        }
      >
        {selectedVendor && (
        <div ref={detailRef}>

          <div className="grid grid-cols-1 gap-6">
            {/* Who they are — editable right here.
                Clicking "edit" should never close the thing you clicked in. */}
            {sheetTab === "details" && ed && (
              <div className="min-w-0">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="block text-sm font-medium text-fg-soft">Name</span>
                    <input
                      value={ed.name}
                      onChange={(e) => setEd({ ...ed, name: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-fg-soft">Type</span>
                    <select
                      value={ed.category}
                      onChange={(e) => setEd({ ...ed, category: e.target.value })}
                      className={inputCls}
                    >
                      {allCats.map((c) => (
                        <option key={c} value={c}>{TYPE_EMOJI[c] ?? ""} {c.toLowerCase()}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-fg-soft">Contact</span>
                    <input
                      value={ed.contact}
                      onChange={(e) => setEd({ ...ed, contact: e.target.value })}
                      placeholder="who you speak to"
                      className={inputCls}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-sm font-medium text-fg-soft">Mobile</span>
                    <input
                      value={ed.mobile}
                      onChange={(e) => setEd({ ...ed, mobile: e.target.value })}
                      placeholder="07…"
                      className={inputCls}
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveDetails}
                    disabled={edBusy || !ed.name.trim()}
                    className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {edBusy ? "Saving…" : "Save changes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setEd(null); setSheetTab("supply"); }}
                    className="mise-press rounded-lg border border-line px-4 py-2 text-sm text-fg-soft hover:bg-paper-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Owed vs paid. Deliveries daily, money weekly — the gap between
                them is the number nothing could state before. */}
            <div className={`min-w-0 ${sheetTab === "money" ? "" : "hidden"}`}>
              {selectedVendor && sheetTab === "money" && (
                <VendorLedger
                  vendorId={selectedVendor.id}
                  vendorName={selectedVendor.name}
                  categories={expenseCats}
                  canWrite={canWrite}
                />
              )}
            </div>

            {/* What they supply */}
            <div className={`min-w-0 ${sheetTab === "supply" ? "" : "hidden"}`}>
              <p className="text-sm font-medium text-fg-soft">What they supply ({vendorItems.length})</p>
              <div className="mt-2 overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-paper">
                    <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                      <th className="px-4 py-2 font-medium">Item</th>
                      {/* "Price / unit" is the phrase that started all of this — it never
                          said WHICH unit, so £3 could have been a lemon or a bottle of
                          thirty. Every cell now names its own size, and the header says
                          what the column is rather than implying a unit it does not know. */}
                      <th className="px-4 py-2 text-right font-medium">What it costs</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {vendorItems.length === 0 ? (
                      <tr><td colSpan={3} className="px-4 py-6 text-center text-fg-faint">No prices yet — use “Add a price” above.</td></tr>
                    ) : vendorItems.map((vi) => (
                      <tr
                        key={vi.id}
                        // Click anything, do anything: the row opens the price
                        // itself rather than making you find the form for it.
                        onClick={() => {
                          setPriceRow(vi);
                          // The NAME they sell by, not its id — the field is
                          // typed now, so a supplier can name a pack nobody has
                          // created yet.
                          const lv = (items.find((i) => i.id === vi.item_id)?.pack_levels ?? []).find(
                            (l) => l.id === vi.pack_level_id,
                          );
                          setSheetLevel(lv?.name ?? "");
                        }}
                        className="cursor-pointer border-b border-line transition hover:bg-glass/[0.03]"
                      >
                        <td className="px-4 py-2 font-medium text-fg">{itemName(vi.item_id)}</td>
                        <td
                          className={`px-4 py-2 text-right ${
                            cheapest[vi.item_id] != null && (parseFloat(vi.price_per_unit) || 0) <= cheapest[vi.item_id]
                              ? "bg-emerald-500/10 font-medium text-emerald-300"
                              : "text-fg-soft"
                          }`}
                          title={
                            cheapest[vi.item_id] != null && (parseFloat(vi.price_per_unit) || 0) <= cheapest[vi.item_id]
                              ? "Cheapest quote for this item across all your vendors"
                              : undefined
                          }
                        >
                          {(() => {
                            const it = items.find((i) => i.id === vi.item_id);
                            if (!it) return format(vi.price_per_unit);
                            const sup = {
                              price_per_unit: vi.price_per_unit,
                              pack_level_id: vi.pack_level_id,
                            } as SupplierOption;
                            // The quote, and every size it works out to. A £30
                            // bottle of thirty is £1 a piece, and the old line
                            // multiplied UP from a price it assumed was already
                            // per-unit — so a pack price came out thirty times
                            // too big.
                            return (
                              <span className="block text-right">
                                <span className="block whitespace-nowrap">
                                  {format(vi.price_per_unit)}
                                  <span className="ml-1 text-[11px] font-normal text-fg-faint">
                                    /{levelName(it, vi.pack_level_id)}
                                  </span>
                                </span>
                                {vi.pack_level_id && (
                                  <span className="block whitespace-nowrap text-[11px] text-indigo-300">
                                    {format(pricePerBase(it, sup).toFixed(2))}/{it.unit}
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="flex items-center justify-end gap-2">
                            {vi.is_preferred && <Badge tone="amber">★ chosen</Badge>}
                            {canWrite && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeVendorItem(vi); }}
                                title="Remove this vendor's price for this item"
                                aria-label={`Remove price for ${itemName(vi.item_id)}`}
                                className="rounded-md border border-line px-1.5 py-0.5 text-xs text-fg-faint transition hover:border-rose-400/50 hover:bg-rose-400/10 hover:text-rose-300"
                              >
                                🗑
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Add / update a price + bulk import */}
            {canWrite && sheetTab === "price" && (
              <div className="min-w-0">
                <form onSubmit={addPrice}>
                  <p className="text-sm font-medium text-fg-soft">Add / update a price</p>
                  <div className="mt-2">
                    <ItemPickerSingle
                      items={items}
                      value={piItem}
                      onChange={(v) => {
                        setPiItem(v);
                        // straight to the only remaining step
                        if (v) window.setTimeout(() => priceRef.current?.focus(), 60);
                      }}
                      // A supplier selling something you have not stocked yet
                      // used to mean leaving for Inventory and finding your way
                      // back — by which time the price you came to enter is gone.
                      onCreate={(name) => setNewItem({ name, unit: "kg" })}
                    />
                    {newItem && (
                      <div className="mise-pop mt-2 rounded-xl border border-brand-400/40 bg-brand-400/[0.06] p-3">
                        <p className="text-xs font-medium text-fg">
                          New stock item — what is it measured in?
                        </p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">
                          The base unit it is STOCKED and COSTED in. Buying it by the box is
                          fine — set the pack size later in Inventory.
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <input
                            value={newItem.name}
                            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                            className="mise-well min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                            placeholder="Item name"
                          />
                          <Select
                            value={newItem.unit}
                            onChange={(u: string) => setNewItem({ ...newItem, unit: u })}
                            options={[
                              { value: "kg", label: "kg" },
                              { value: "g", label: "g" },
                              { value: "litre", label: "litre" },
                              { value: "ml", label: "ml" },
                              { value: "each", label: "each" },
                              { value: "pack", label: "pack" },
                              { value: "bottle", label: "bottle" },
                                            ]}
                          />
                        </div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={createItemInline}
                            disabled={creating || !newItem.name.trim()}
                            className="mise-press rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                          >
                            {creating ? "Creating…" : "Create and price it"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setNewItem(null)}
                            className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Names what you picked, so you are never typing a price
                      against an item you cannot see. Not sticky any more: this
                      section is now the only thing on screen, and the sticky
                      version floated over the item grid. */}
                  <div
                    className={`mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5 transition ${
                      piItem ? "border border-brand-400/40 bg-paper-2/60" : "border border-transparent"
                    }`}
                  >
                    {piItem && (
                      <span className="w-full text-xs text-fg-faint">
                        Pricing{" "}
                        <b className="text-fg">
                          {items.find((i) => i.id === piItem)?.name ?? "—"}
                        </b>{" "}
                        for {selectedVendor?.name}
                      </span>
                    )}
                    <input
                      ref={priceRef}
                      inputMode="decimal"
                      value={piPrice}
                      onChange={(e) => setPiPrice(numeric(e.target.value))}
                      placeholder="price"
                      className="mise-well w-28 rounded-lg px-3 py-2 text-sm outline-none"
                    />
                    {(() => {
                      const it = items.find((i) => i.id === piItem);
                      const chain = it?.pack_levels ?? [];
                      const per = parseFloat(piPrice || "0");
                      const name = piPackName.trim();
                      const size = parseFloat(piPackSize) || 0;
                      return (
                        <>
                          {/* What does that price BUY? Typed, not picked from a
                              list — a supplier who sells bottles should not
                              have to go and invent "bottle" somewhere else
                              first. Existing names are offered as suggestions
                              so the same word is reused rather than respelled. */}
                          <label className="flex items-center gap-1.5 text-xs text-fg-faint">
                            for one
                            <input
                              list="mise-pack-names"
                              value={piPackName}
                              onChange={(e) => setPiPackName(e.target.value)}
                              placeholder={it?.unit || "unit"}
                              aria-label="What this price buys — a unit, or a pack they sell"
                              className="mise-well w-28 rounded-lg px-3 py-2 text-sm outline-none"
                            />
                          </label>
                          <datalist id="mise-pack-names">
                            {chain.map((lv) => (
                              <option key={lv.id} value={lv.name} />
                            ))}
                            <option value="bottle" />
                            <option value="box" />
                            <option value="packet" />
                            <option value="bag" />
                            <option value="case" />
                            <option value="tray" />
                          </datalist>

                          {/* Only asked once they have named a pack — bought
                              loose there is nothing to hold anything. */}
                          {name && name.toLowerCase() !== (it?.unit ?? "").toLowerCase() && (
                            <label className="flex items-center gap-1.5 text-xs text-fg-faint">
                              holding
                              <input
                                inputMode="decimal"
                                value={piPackSize}
                                onChange={(e) => setPiPackSize(numeric(e.target.value))}
                                placeholder="how many"
                                aria-label={`How many ${it?.unit ?? "units"} in one ${name}`}
                                className="mise-well w-24 rounded-lg px-3 py-2 text-sm outline-none"
                              />
                              {it?.unit}
                            </label>
                          )}

                          <button type="submit" className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                            Save price
                          </button>

                          {/* The arithmetic, done where it is entered, so a
                              wrong number is obvious before it is saved. */}
                          {name && per > 0 && size > 0 && (
                            <span className="mise-tone-info w-full text-xs">
                              = {format((per / size).toFixed(4))} per {it?.unit}
                              {"  ·  "}1 {name} = {size} {it?.unit}
                            </span>
                          )}
                          {!name && per > 0 && (
                            <span className="w-full text-xs text-fg-faint">
                              Sold loose — {format(per.toFixed(2))} per {it?.unit}. Selling it by
                              the bottle or box? Type that above.
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <p className="mt-2 text-xs text-fg-faint">
                    Same item again = updates the price. Mark the ★ chosen supplier on <b>Price Comparison</b> — and you can
                    pick any supplier per order on <b>Purchasing</b>.
                  </p>
                </form>

                <div className="mise-well mt-5 rounded-xl p-3">
                  <p className="text-sm font-medium text-fg-soft">Or bulk import a price list</p>
                  <p className="mb-2 mt-1 text-xs text-fg-faint">
                    Upload the vendor&apos;s <b>Excel/CSV</b> — columns <b>Item</b>, <b>Price</b>, optional <b>Unit</b>.
                    It&apos;s checked strictly and tells you the exact fix if anything&apos;s off. New items are
                    created automatically; re-uploading the same file is safe (prices just update).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
                    >
                      ⬆ Import
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadFile("/vendors/price-list-template.xlsx", "mise-vendor-price-list.xlsx")}
                      className="mise-raised mise-press rounded-lg px-4 py-2 text-sm font-medium text-fg-soft"
                    >
                      ⬇ Template (Excel)
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadFile("/vendors/price-list-template.csv", "mise-vendor-price-list.csv")}
                      className="mise-raised mise-press rounded-lg px-4 py-2 text-sm font-medium text-fg-soft"
                    >
                      CSV
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* A sheet on top of a sheet.
              Rendered INSIDE the vendor sheet on purpose: depth comes down
              through context, so being a child is what makes this one sit
              above its parent, inset, with the vendor still visible at the
              rim. Rendered as a sibling it would be depth 1 and land level
              with the thing that opened it. */}
          <DetailSheet
            open={!!priceRow}
            onClose={() => setPriceRow(null)}
            icon="🏷"
            title={priceRow ? itemName(priceRow.item_id) : ""}
            subtitle={(() => {
              // "price per unit" is the phrase that caused the confusion in the
              // first place — it never said WHICH unit. Name the size.
              const it = priceRow ? items.find((i) => i.id === priceRow.item_id) : null;
              return it && priceRow
                ? `${selectedVendor.name} · priced per ${levelName(it, priceRow.pack_level_id)}`
                : selectedVendor.name;
            })()}
            badge={priceRow?.is_preferred ? <Badge tone="amber">★ chosen</Badge> : undefined}
          >
            {priceRow && (() => {
              const it = items.find((i) => i.id === priceRow.item_id);
              const mine = parseFloat(priceRow.price_per_unit) || 0;
              const best = cheapest[priceRow.item_id];
              const sup = {
                price_per_unit: priceRow.price_per_unit,
                pack_level_id: priceRow.pack_level_id,
              } as SupplierOption;
              // "see that lemon 2 — it's confusing right? what's £3 for, 1 piece
              // of lemon or 1 bottle?" It never said. The hint asserted "per
              // {unit}" whatever the supplier had actually quoted, and the row
              // below it multiplied UP from that assumption — so a bottle price
              // came out thirty times too big. Now every size is listed, priced
              // off the ONE quote, with the size they actually sell it in named.
              return (
                <>
                  {/* Only worth saying separately when the quote is for a PACK.
                      Bought loose, "they quote £0.76" and "1 kg £0.76" are the
                      same row printed twice. */}
                  {(!it || priceRow.pack_level_id) && (
                    <DetailRow
                      label="They quote"
                      value={format(priceRow.price_per_unit)}
                      hint={it ? `for 1 ${levelName(it, priceRow.pack_level_id)}` : undefined}
                    />
                  )}
                  {it &&
                    priceLines(it, sup).map((l) => (
                      <DetailRow
                        key={l.label}
                        label={`1 ${l.label}`}
                        value={format(l.price.toFixed(2))}
                        hint={l.note ? `a ${l.label} holds ${l.note}` : "the unit you cook with"}
                      />
                    ))}
                  {it && (
                    <DetailRow
                      label="You have"
                      // "we show stock like we have 1 piece of lemon — so even if
                      // we buy 1 bottle we show 30 pieces. Instead show 1 piece,
                      // as a bottle can have 30." Stock is counted in the unit you
                      // cook with, which is the only count a kitchen can act on;
                      // what was missing is the sentence that makes it make sense.
                      value={stockInPacks(it) || fmtQty(it.current_stock, it.unit)}
                      hint={
                        stockInPacks(it)
                          ? `${fmtQty(it.current_stock, it.unit)} · ${chainSummary(it)[0] ?? ""}`
                          : (chainSummary(it)[0] ?? undefined)
                      }
                    />
                  )}
                  {best != null && (
                    <DetailRow
                      label="Cheapest anywhere"
                      value={format(best.toFixed(2))}
                      hint={
                        mine <= best
                          ? "this supplier is the cheapest"
                          : `${format((mine - best).toFixed(2))} more than the best quote`
                      }
                    />
                  )}

                  {canWrite && (
                    <>
                      <p className="mt-5 text-xs font-medium uppercase tracking-wide text-fg-faint">
                        How they sell it
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-fg-soft">
                        Written as a sentence, because that is how it gets quoted on the phone —
                        and because &ldquo;1 bottle&rdquo; is a different number of{" "}
                        {it?.unit ?? "units"} at different suppliers.
                      </p>
                      <form
                        className="mt-2 space-y-2"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const fd = new FormData(e.currentTarget);
                          const val = fd.get("np");
                          if (!val) return;
                          const name = String(fd.get("lvl") ?? "").trim();
                          const held = String(fd.get("held") ?? "").trim();
                          if (name && !(parseFloat(held) > 0)) {
                            setError(`Say how many ${it?.unit ?? "units"} are in one ${name}.`);
                            return;
                          }
                          try {
                            await api.post(`/vendors/${selected}/items`, {
                              item_id: priceRow.item_id,
                              price_per_unit: String(val),
                              // Empty name = they sell it loose again.
                              pack_name: name,
                              pack_size: name ? held : null,
                            });
                            setPriceRow(null);
                            selectVendor(selected);
                            setNotice("Saved how they sell it.");
                          } catch (err) {
                            setError(err instanceof ApiError ? err.message : "Could not save the price.");
                          }
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-soft">
                          <span>They sell it by the</span>
                          <input
                            name="lvl"
                            list="mise-pack-names-sheet"
                            value={sheetLevel}
                            onChange={(e) => setSheetLevel(e.target.value)}
                            placeholder={it?.unit ?? "unit"}
                            className={`${inputCls} w-32`}
                            aria-label="What they sell it by — a unit, or a pack"
                          />
                          <datalist id="mise-pack-names-sheet">
                            {(it?.pack_levels ?? []).map((lv) => (
                              <option key={lv.id} value={lv.name} />
                            ))}
                            <option value="bottle" />
                            <option value="box" />
                            <option value="packet" />
                            <option value="bag" />
                            <option value="case" />
                          </datalist>
                        </div>

                        {/* Only worth asking when they sell a PACK — bought
                            loose there is nothing to hold anything. */}
                        {it && sheetLevel.trim() &&
                          sheetLevel.trim().toLowerCase() !== it.unit.toLowerCase() && (
                          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-soft">
                            <span>and 1 {sheetLevel.trim()} holds</span>
                            <input
                              name="held"
                              inputMode="decimal"
                              defaultValue={
                                priceRow.pack_size_override ??
                                (it.pack_levels ?? []).find((l) => l.id === priceRow.pack_level_id)
                                  ?.base_size ??
                                ""
                              }
                              placeholder="how many"
                              onChange={(e) => { e.target.value = numeric(e.target.value); }}
                              className={`${inputCls} w-24`}
                              aria-label={`How many ${it.unit} in one of their packs`}
                            />
                            <span>{it.unit}</span>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-soft">
                          <span>for</span>
                          <input
                            name="np"
                            inputMode="decimal"
                            defaultValue={priceRow.price_per_unit}
                            onChange={(e) => { e.target.value = numeric(e.target.value); }}
                            className={`${inputCls} w-32`}
                            aria-label="What they charge"
                          />
                          <button className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
                            Save
                          </button>
                        </div>

                        {it && sheetLevel.trim() && (
                          <p className="text-[11px] leading-relaxed text-fg-faint">
                            This is <b>their</b> {sheetLevel.trim()}, not everyone&apos;s — another
                            supplier can sell a {sheetLevel.trim()} of a different size and both
                            stay right. Clear the box to say they sell it loose again.
                          </p>
                        )}
                      </form>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {!priceRow.is_preferred && (
                          <button
                            type="button"
                            onClick={() => chooseSupplier(priceRow)}
                            className="mise-press rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-200"
                          >
                            ★ Make them the chosen supplier
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => { await removeVendorItem(priceRow); setPriceRow(null); }}
                          className="mise-press rounded-lg border border-line px-3 py-1.5 text-sm text-fg-faint hover:border-rose-400/50 hover:text-rose-300"
                        >
                          Remove this price
                        </button>
                      </div>
                    </>
                  )}
                </>
              );
            })()}
          </DetailSheet>
        </div>
        )}
      </DetailSheet>
    </Workbench>
  );
}
