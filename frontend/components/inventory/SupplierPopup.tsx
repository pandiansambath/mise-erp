"use client";

// Suppliers, chosen and added, WITHOUT leaving Inventory.
//
//   "this inventory page is main thing user will use. here they need all the
//    functionality to be 1 place. if they click the choose word it needs to open
//    a popup here itself and let them choose the supplier. (note: when i click
//    add supplier it's taking me to vendor page to add, but it needs to be in
//    place also, so that user in inventory itself he can do whatever he wants)"
//
// Both chips in the supplier column were <Link>s. "★ choose · 4" went to
// /price-comparison and "+ supplier" went to /vendors?new=1 — so the two things
// you most often want to do from this page were both a page change, and both
// landed you somewhere you then had to find your way back from.
//
// The price still belongs to (vendor × item) and is still written through the
// Vendors endpoints. Only the round trip is gone; there is no second source of
// truth.
//
// Mobile is not a reduced version of this. "whatever we're seeing in inventory
// page (all the feature popups, click to show etc etc), all these the exact same
// thing need to be in mobile view too." SheetPopup is centred and sized to its
// content at every width, every row here is at least 48px, and the add form
// stacks rather than being hidden behind a breakpoint.

import { useMemo, useState } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import { api, ApiError, type Item, type SupplierOption } from "@/lib/api";
import { levelName, pricePerBase, supplierPackSize } from "@/lib/packs";
import { numeric } from "@/lib/sanitize";

export function SupplierPopup({
  item,
  suppliers,
  vendorList,
  canWrite,
  format,
  onClose,
  onChoose,
  onAdded,
  depth = 1,
}: {
  item: Item;
  suppliers: SupplierOption[];
  /** Every active vendor, so one can be picked without inventing a duplicate. */
  vendorList: { id: string; name: string }[];
  canWrite: boolean;
  format: (v: string) => string;
  onClose: () => void;
  /** Already carries the confirmation — the caller owns that rule. */
  onChoose: (vendorId: string) => Promise<void> | void;
  /** A price was created; the page should reload. */
  onAdded: () => Promise<void> | void;
  depth?: 1 | 2;
}) {
  const [adding, setAdding] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [newName, setNewName] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Vendors who do not already price this item. Offering one who does would
  // look like a way to change their price and quietly do nothing of the sort.
  const available = useMemo(() => {
    const have = new Set(suppliers.map((s) => s.vendor_id));
    return vendorList.filter((v) => !have.has(v.id));
  }, [suppliers, vendorList]);

  const chosen = suppliers.find((s) => s.is_preferred);

  async function save() {
    const amount = parseFloat(price);
    if (!(amount > 0)) {
      setErr("Enter a price above zero.");
      return;
    }
    if (!vendorId && !newName.trim()) {
      setErr("Pick a supplier, or type a new one's name.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      let id = vendorId;
      if (!id && newName.trim()) {
        const v = await api.post<{ id: string }>("/vendors", { name: newName.trim() });
        id = v.id;
      }
      await api.post(`/vendors/${id}/items`, { item_id: item.id, price_per_unit: price });
      // The first supplier of an item is unambiguously THE supplier. Any later
      // one is a choice, and a choice belongs to the person, not to me.
      if (suppliers.length === 0) {
        await api.post(`/vendors/items/${item.id}/preferred`, { vendor_id: id });
      }
      await onAdded();
      setMsg(
        suppliers.length === 0
          ? "Supplier added, and costing now uses this price."
          : "Supplier added. Tap it to make it the chosen one.",
      );
      setAdding(false);
      setVendorId("");
      setNewName("");
      setPrice("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not add that supplier price");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetPopup
      onClose={onClose}
      depth={depth}
      title={item.name}
      subtitle={
        suppliers.length === 0
          ? "Nobody sells this yet — add the first price"
          : `${suppliers.length} supplier${suppliers.length === 1 ? "" : "s"} · costing uses the ★ one`
      }
    >
      <div className="space-y-4">
        {suppliers.length > 0 && (
          <div className="space-y-1.5">
            {[...suppliers]
              .sort((a, b) => pricePerBase(item, a) - pricePerBase(item, b))
              .map((v) => {
                const on = v.is_preferred;
                const each = pricePerBase(item, v);
                return (
                  <button
                    key={v.vendor_id}
                    type="button"
                    data-testid="inv-popup-supplier"
                    disabled={!canWrite || on}
                    onClick={() => onChoose(v.vendor_id)}
                    title={
                      canWrite
                        ? on
                          ? `${v.vendor_name} is already the chosen supplier`
                          : `Buy ${item.name} from ${v.vendor_name} instead`
                        : "You do not have permission to change this"
                    }
                    className={`mise-press flex min-h-[52px] w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
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
                        {supplierPackSize(item, v)
                          ? `${format(String(v.price_per_unit))} per ${levelName(item, v.pack_level_id)}`
                          : "no price yet"}
                      </span>
                    </span>
                    {each > 0 && (
                      <span className="shrink-0 text-right text-xs tabular-nums text-fg-soft">
                        {format(each.toFixed(2))}
                        <span className="block text-[10px] text-fg-faint">per {item.unit}</span>
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        )}

        {msg && <p className="text-[11px] text-brand-300">{msg}</p>}

        {canWrite &&
          (adding ? (
            <div className="mise-card-inset space-y-3 p-3.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                Add a supplier price
              </p>

              {available.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-[11px] text-fg-faint">
                    One you already deal with
                  </span>
                  <select
                    value={vendorId}
                    onChange={(e) => {
                      setVendorId(e.target.value);
                      if (e.target.value) setNewName("");
                    }}
                    className="mise-well min-h-[44px] w-full rounded-lg px-3 py-2 text-sm outline-none"
                  >
                    <option value="">Choose a supplier…</option>
                    {available.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="mb-1 block text-[11px] text-fg-faint">
                  {available.length > 0 ? "…or a brand new one" : "Supplier name"}
                </span>
                <input
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    if (e.target.value) setVendorId("");
                  }}
                  placeholder="new supplier's name"
                  className="mise-well min-h-[44px] w-full rounded-lg px-3 py-2 text-sm outline-none"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] text-fg-faint">
                  Price per {item.unit}
                </span>
                <input
                  value={price}
                  onChange={(e) => setPrice(numeric(e.target.value))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="mise-well min-h-[44px] w-full rounded-lg px-3 py-2 text-right text-sm tabular-nums outline-none"
                />
              </label>

              {err && <p className="text-[11px] text-rose-400">{err}</p>}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={save}
                  disabled={busy}
                  data-tone="brand"
                  className="mise-btn-flat mise-press min-h-[44px] flex-1 px-4 py-2 text-sm font-bold text-brand-300 disabled:opacity-40"
                >
                  {busy ? "Saving…" : "Save price"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setErr(null);
                  }}
                  className="mise-btn-flat mise-press min-h-[44px] px-4 py-2 text-sm font-medium text-fg-soft"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setMsg(null);
              }}
              data-testid="inv-popup-add-supplier"
              className="mise-btn-flat mise-press flex min-h-[48px] w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-fg-soft"
            >
              <span aria-hidden>＋</span> Add a supplier price
            </button>
          ))}

        {!canWrite && suppliers.length === 0 && (
          <p className="text-[11px] text-fg-faint">
            Nobody prices this item yet, and you do not have permission to add one.
          </p>
        )}

        {chosen && (
          <p className="text-[11px] text-fg-faint">
            Recipes, margins and purchase orders are costed at{" "}
            <b className="text-fg-soft">{chosen.vendor_name}</b>&apos;s price.
          </p>
        )}
      </div>
    </SheetPopup>
  );
}
