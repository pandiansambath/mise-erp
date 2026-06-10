# Proposal — Purchasing / Inventory redesign + "choose the vendor"

Status: **DRAFT for sign-off** (no code written yet). Covers checklist #3.

## What you asked for
1. Replace the plain dropdowns (Purchasing, Inventory, Recipes, Price Comparison)
   with **category sections** (Pack, Vegetables, Fruits, Meat, Spices…): click an
   item → it's selected → selected items show with **stock status** (in stock /
   low / out).
2. **Super Admin chooses the vendor** per item — costing & purchasing should chain
   on the *chosen* vendor, **not** auto-cheapest.
3. **Show the vendor name** in indents and purchase orders.

## How it works today (so we know what changes)
- Each item can have prices from several vendors. One can be flagged **preferred**.
- Recipe costing + PO generation use **preferred-if-set, else cheapest**.
- "Generate POs" groups an indent's items by that vendor → one PO per supplier.
- Selection is via `<select>` dropdowns; the Inventory "Vendor" column already
  shows the preferred-or-cheapest supplier.

So a "choose the vendor" mechanism **already exists** (the preferred flag) — this
proposal makes it the **primary, explicit** choice and upgrades the UI.

## Proposed design

### A. "Chosen supplier" (the vendor logic)  ← core change
- Rename **preferred → "Chosen supplier"** in the UI (clearer intent).
- Each item shows its chosen supplier; if none is chosen it shows **"auto:
  cheapest (£X, VendorY)"** so nothing is ever blocked, but the admin can pin one.
- **Costing, Inventory, Purchasing all chain on the chosen supplier** (falling back
  to cheapest only when none is set).
- Set/clear the chosen supplier from the new Item picker *and* Price Comparison.

### B. Reusable categorised **Item Picker** (the UI)
A new component used in Purchasing, Recipes and Price Comparison:
- Items grouped under their **category** (the existing `item.category` field —
  Vegetables, Spices, Dairy, Packaging, Rice…), each group collapsible.
- Type-to-search across all items; click a chip to select.
- Each item chip shows a **stock pill**: 🟢 in stock · 🟡 low (≤ min) · 🔴 out (0).
- Selected items appear in a "Selected" tray below with qty inputs + their
  **chosen supplier**.

### C. Vendor on indents & POs
- POs are already per-vendor → just **surface the vendor name** on the PO list
  (today it shows PO number/total/status only).
- Indent lines will show the **chosen supplier** they'll be ordered from, so there
  are no surprises at "Generate POs".

## Scope / phasing (each is a deploy)
- **Phase 1 (logic, small):** show vendor name on POs + indent lines; make the
  chosen-supplier wording/notion explicit. Low risk.
- **Phase 2 (UI, medium):** the categorised Item Picker with stock pills, wired
  into Purchasing first (where you hit the pain), then Recipes & Price Comparison.
- **Phase 3 (optional):** per-indent vendor override (pick a different supplier
  for one order without changing the item's default).

## Decisions I need from you
1. **Fallback when no vendor is chosen:** keep **auto-cheapest** (recommended — never
   blocks ordering) or **force** the admin to pick a vendor before an item can be
   ordered?
2. **Vendor choice level:** one **chosen supplier per item** (simplest, recommended)
   — or must you be able to pick a **different vendor each time** you raise an indent
   (Phase 3)?
3. **Category source:** group by the existing inventory **`category`** field
   (Vegetables/Spices/Dairy/Packaging/…)? (Yes = no new data needed.)
4. **Order to build:** Phase 1 → 2 → 3 as above, or different?
