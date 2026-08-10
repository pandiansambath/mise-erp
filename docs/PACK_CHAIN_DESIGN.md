# The pack chain — buy in a box, use a pinch

His brief, in his words:

> 1 box of pepper... it will have 10 small box... each box will have 30 packets
> of 50g small small packets of pepper ---> this is possible ryt bro???
>
> same like in purchasing section too we need to allow user to be flexible to
> order... like he need only 30 small packets only, need to autocalculate...
> also we cant say all the vendors will have this BOX type... some vendor will
> have small packets too, only they will sell
>
> **THIS SITE IS MAINLY FOR LAYMEN BRO** — even a layman needs to use the site
> with flexibility, easy to use, friendly, with very very details in all areas

---

## Why the current model cannot say it

    Item.unit       "g"        what stock, recipes and cost are counted in
    Item.pack_unit  "box"      ONE buying size
    Item.pack_size  15000      how many base units are in it

Exactly one pack size per item. It can say *1 box = 15 kg* and nothing else.
It cannot say a box holds 10 small boxes, that each of those holds 30 packets,
or that a packet is 50 g — and so it cannot let anyone order 30 packets.

It also assumes **every vendor sells the same shape**, because
`VendorItem.price_per_unit` is always a price per base unit. In real life one
supplier sells you the box and another only sells packets.

## The shape

A **chain**, where each level says *1 of me = N of the one below me*:

    base          g
    level 1       packet     = 50 g
    level 2       small box  = 30 packets        (= 1 500 g)
    level 3       box        = 10 small boxes    (= 15 000 g)

Every level resolves to base units by multiplying down the chain. That is the
whole trick, and it is also how a chef says it out loud — which matters,
because this is the part a layman has to get right.

    item_pack_levels
      item_id, position, name, contains   -- "contains" = how many of the level below

Level 1's "below" is the base unit. There is no limit on depth; three levels
covers pepper, one covers a sack of rice, none covers loose tomatoes.

**Who sells what** is a separate fact, so it hangs off the vendor's price:

    vendor_items.pack_level_id   NULL -> they price it per base unit (today)
                                 set  -> that price buys ONE of that level

So Farm2Land can sell a box at £120 while SK sells packets at £0.45, and both
are comparable once normalised: £120 / 15 000 g vs £0.45 / 50 g. **This also
fixes Price Comparison**, which today cannot honestly compare a box price to a
packet price at all.

## The UI — reading like a sentence, not a form

**Inventory — defining it.** No "pack size", no "case", no jargon:

    How do you count this?   [ grams ▾ ]
    the smallest amount a recipe would use

    How do you buy it?                                    + Add a size
    ┌──────────────────────────────────────────────────┐
    │  1  [ packet    ]  =  [  50 ]  grams          ✕  │
    │  1  [ small box ]  =  [  30 ]  packets        ✕  │
    │  1  [ box       ]  =  [  10 ]  small boxes    ✕  │
    └──────────────────────────────────────────────────┘

    ✓  1 box = 10 small boxes = 300 packets = 15 kg
       1 small box = 30 packets = 1.5 kg
       1 packet = 50 g

The block at the bottom is the important part: a **live plain-English echo**.
Each row's "= N what" is filled in automatically from the row above, so there
is nothing to look up and no way to pair the wrong units. A mistake is visible
while you are making it, not a month later in the stock value.

**Purchasing — ordering in whatever shape you like.**

    Black Pepper        [ 30 ]  [ packets ▾ ]        = 1.5 kg
                        SK sells packets · £0.45 each        £13.50

The dropdown offers only the sizes **that vendor actually sells**, plus the
base unit. Order 30 packets from a vendor who only sells packets and it just
works; switch to Farm2Land and the list becomes boxes, because that is all they
have. Stock always moves in base units underneath.

## Order of work

1. `item_pack_levels` table + `vendor_items.pack_level_id` (both additive)
2. Conversion helpers, one place, with tests: level -> base, price -> price per base
3. Read the existing `pack_unit`/`pack_size` as a one-level chain so nothing has
   to be re-entered, and nothing breaks on the day it ships
4. Inventory UI — the chain editor with the live echo
5. Purchasing UI — the unit picker per vendor
6. Price Comparison — compare on price-per-base, which it cannot do today
7. Only then consider retiring `pack_unit`/`pack_size`

## Language rules for every screen this touches

- Never "case", "UOM", "conversion factor", "pack size"
- Ask questions: *"How do you count this?"*, *"How do you buy it?"*
- Always echo the answer back in full words and real numbers
- Show the base amount beside every quantity, always: `30 packets = 1.5 kg`
