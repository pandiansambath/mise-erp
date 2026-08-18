# One item, several ways to buy it

> "why we have made a split means... vendor1 giving 1 box of dragon fruit for
> 10 pound, which has 10 kg, so price will be 1 pound per kg. If we buy 5 kg of
> dragon fruit means it cost 10 pound so 1 kg dragon fruit is 2 pound...
> some shop may have a compulsion to buy just 2 kg only, they don't wish to buy
> one box, means we need to show based on that. That's why if we split and store
> that 1 item, it will be useful nah."

He is right, and this is the last false assumption left in the pricing model.

---

## The assumption we are making today, and why it is wrong

A vendor row stores **one** price and **one** pack size. Every other size is
worked out by dividing:

```
Farm2Land: £50 for a box of 50 kg   →  we assert £1.00/kg
```

That division is a claim we have no evidence for. **It is also the opposite of
how the trade prices things.** A box is cheap *because* it is a box — the whole
point of the case price is to push you to buy the case. Buying 2 kg loose from
the same supplier is very often dearer per kg, sometimes much dearer.

So the app currently:
- **understates** the cost of buying loose (it bills the case rate), and
- **cannot express** a supplier who sells only in cases, or only loose.

His own example: a shop that must buy 2 kg, not a box. Today we would cost that
at the box rate and be wrong on every plate that uses it.

---

## The model: a price is per (vendor × item × form)

`vendor_items` becomes **one row per form**, not one row per item.

| vendor | item | form | price | holds |
|---|---|---|---|---|
| Farm2Land | Dragon fruit | box | £50.00 | 50 kg |
| Farm2Land | Dragon fruit | kg (loose) | £1.40 | — |
| Exotic | Dragon fruit | box | £20.00 | 10 kg |

Still **one item**. Dragon fruit is dragon fruit — one stock pool, one average
cost, one recipe ingredient. What multiplies is the **way you can buy it**, and
that is a property of the vendor, exactly like the pack size was.

His words for it: *"1 item is a group; this group will have box which is 1 item
different price, or loose kg which is 1 item has different price"*. The group is
the item; the members are the forms.

### Schema
- Drop the unique constraint on `(vendor_id, item_id)`.
- Add unique on `(vendor_id, item_id, pack_level_id)` — `NULL` = sold loose, so
  every vendor gets at most one loose price and at most one price per pack.
- `upsert_vendor_item` keys on the triple instead of the pair.
- Nothing else about the row changes; `pack_size_override` still says how big
  *their* box is.

### The "same rate" button
> "suppose user feels that box and per kg will be same means, then we need to
> have 1 button which will auto calculate the box price with per kg price"

A **"same rate as the box"** action next to the loose price that fills in
`box price ÷ box size`. It **writes a real row** rather than leaving it derived,
because the moment it is derived we are back to asserting something nobody said.
Filled once, editable after — and visibly marked as *worked out from the box*
until someone confirms it.

---

## What each screen shows

### Vendors — where the forms are authored
The item's row expands into its forms:

```
Dragon fruit
  1 box (50 kg)      £50.00       £1.00/kg
  1 kg loose         £1.40                    ← dearer, as it should be
  + add another way they sell it
```
"Add a price" gains the same shape: name the form, say how much is inside, give
the price. Already half-built — the sentence form landed on 2026-08-14.

### Price Comparison — compare like with like
Two things are being asked and they have different answers:
- **"Who is cheapest per kg?"** — rank on the per-base price of each form; the
  winner names its form: *"Farm2Land £1.00/kg, buying a 50 kg box"*.
- **"Who is cheapest for the 2 kg I actually want?"** — a quantity box. Enter 2
  kg and it prices *that* against every form, including "you would have to take
  a whole box". This is the question his 2 kg shop is really asking.

### Purchasing — pick the form when you add to the basket
The size picker already exists; it currently offers sizes derived from the
chain. It offers the **forms this supplier actually sells** instead, each with
its own price. Ties in with the per-purchase vendor picker he asked for
separately, which is the same control from the other direction.

### Inventory — read it back, never assert
Stock stays pooled in the base unit — that part is right and does not change.
The item sheet lists **every way it can be bought, from whom, at what real
per-unit cost**, sorted cheapest first. That is the "show clearly" he asked for,
and it is also the honest version of the `1 box = 50 kg` line we removed.

---

## Order of work
1. ~~Stop the per-kg lie on Price Comparison~~ — done.
2. ~~Schema + upsert keyed on the triple~~ — done, migration `40c6a64f0525`.
   Two PARTIAL unique indexes, because NULL means loose and Postgres treats
   NULLs as distinct. **Proved on his live data**: Farm2Land dragon fruit now
   carries a £50 box (50 kg) and a £1.40 loose kilo side by side.
3. ~~Vendors: author multiple forms; the "same rate" action~~ — done. Rows name
   their form ("by the box (50 kg)" / "loose, per kg"); "+ They also sell it
   loose" seeds a real row at the case rate. The cheapest highlight ranks on
   per-base cost.
4. ~~Purchasing: pick the supplier per basket line~~ — done. **The backend was
   already complete**: `IndentItem.vendor_id` existed, `IndentItemIn` accepted
   it, `_resolve_supplier` honoured it (picked > chosen > cheapest) and PO
   generation passed it. Even the page held a `vendorPick` map and SENT it —
   `setVendorPick` was simply never called. It had no control, which is exactly
   why he had to go to Price Comparison and change the default for everything.
   The basket card's supplier line is now a picker listing every supplier at
   their real per-unit cost. `is_preferred` is never written, so the ★ chosen
   supplier is untouched. Picking one tints the line amber.
   **Still to do here:** pick the FORM (box vs loose) per line, and show the
   non-default choice plainly in inventory afterwards — his "pile up confusion"
   warning.
5. ~~Price Comparison: the "cheapest for the 2 kg I actually want" answer~~ —
   done. A quantity box on the Suppliers tab prices THAT amount against every
   supplier, rounding a case seller UP to whole cases (they cannot sell half a
   case) and flagging how much would be left over. The per-kg winner and the
   winner for this amount are often different people, and only this says which.
6. ~~Inventory: list every way to buy it, cheapest first~~ — done. The item
   sheet carries **"Every way you can buy it"**: each supplier x form, the real
   per-base cost leading and the quoted price beside it, cheapest first, with a
   line saying why a big case price can still win.

**A money bug step 2 introduced, found and fixed here:** `_resolve_supplier`
used `.limit(1)` for the picked and preferred branches. With one row per vendor
that was fine; with several forms it took whichever row the database handed back
first, so an order could be costed at the loose rate when the case was meant.
It now takes the vendor's cheapest form per base unit.

**Nothing here changes what stock IS.** A kilo is a kilo whoever delivered it
and however it was boxed. What changes is that the app stops inventing prices
for ways of buying that nobody quoted.
