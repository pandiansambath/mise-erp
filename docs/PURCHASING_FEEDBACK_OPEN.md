# Purchasing — the open list

His batch of 2026-08-13, written down verbatim-ish so none of it gets lost.
Tick as they ship; do not delete.

## Bugs first — these are not cosmetic

- [x] **3. A purchase order VANISHED when a date was set.** "If I give date as
      yesterday then suddenly that PO disappeared. Tried for next one — again
      disappeared, can't able to find anywhere." Setting `expected_delivery` in
      the past moves the order into the **Late** bucket, and the list was
      filtered to *Still to arrive* — so it left the visible list and looked
      deleted. Whatever the cause, an order must never be unfindable.
- [x] **6. "Stuck · no supplier" cannot be reproduced.** "I can't able to find,
      tried so many ways to see that — but only 1 is showing which is an old
      one already approved. What's the reason bro?" Explain what actually puts
      an indent in that state, and make the one that IS in it explain itself.
- [x] **8. A PENDING indent's sheet shows nothing useful**, while an ORDERED
      one shows everything. "Any reason behind, or is it a bug?"

## The 3D card, his way

- [x] **1a.** Shadow on the **top edge AND the left edge**, body nudged right —
      so the card reads as turned to face right. (Currently the cheek is on the
      right, i.e. facing left.)
- [x] **1b.** **Drop the per-category colours.** "The colour you gave for each
      card is not nice. Actually I loved the previous version we had — only
      grey kinda colour for all category cards, which resembles shadow." Keep
      the *word* (dry store / chilled / …) but make the stripe neutral.

## Layout and motion

- [x] **4. Shrink-on-scroll, properly.** The BUTTONS must shrink too and rise a
      step, so scrolled-down leaves **one row** holding "Purchasing" and all
      three buttons. Grows back smoothly on the way up.
- [x] **5. The burst must be ONE event.** "I can literally see 1st popup burst,
      then right side 2nd popup burst, then left some other is disappearing.
      Burst all at once bro — smooth and beautiful, with colour papers throwing
      kind of UI. Should be realistic." (My deepest-first sequence was wrong:
      he wants simultaneous, with confetti.)

## Surfaces still untouched

- [ ] **2.** The tab row (New order / Indents / Orders) is still plain.
- [x] **6b.** The **indent** search + filter + pager strip.
- [x] **7.1** The **orders** search + filter + pager strip.
- [x] **7.2** The sort dropdown ("Newest first") — "very poor and plain UI".
- [x] **8.1** The item-history sheet ("Everything this item has been ordered
      on") — "not detailed enough to understand, please have details so a
      layman can understand", and the UI still reads plain.

## Crowding

- [x] **7.** On a purchase run, **"See everything" + "Consolidated PDF" + the
      price** sit on top of each other and feel awkward. Needs a plan, and
      "See everything" is too long — **use "All"**.

---

Standing rules this must obey: [docs/PURCHASING_DESIGN_SYSTEM.md](PURCHASING_DESIGN_SYSTEM.md).


---

## Verified against the LIVE site, not against these notes

`BASE_URL=https://nirai1.dineai.cloud npx playwright test e2e/verify.spec.ts`

Nine of nine, on his own tenant (2026-08-13):

```
DONE  1b neutral stripes            1 distinct colour
DONE  1a shadow above + left        box-shadow reaches above the card
DONE  4  header shrinks on scroll   155px -> 52px, condensed=true
DONE  7.2 sort dropdown restyled
DONE  6  'Stuck' explains itself    hover text present
DONE  8  pending indent has detail  no bare dashes
DONE  7  'See everything' gone
DONE  receive-all present           10 runs
DONE  3  empty list explains filters
```

**One lesson worth keeping:** item 4 reported OPEN three times and was working
the whole time. The order pad now fits the screen — 783px of content in a 737px
box, which is the header reclaim doing its job — so there was nothing to scroll
past and the rail correctly stayed open. Measuring a shrink-on-scroll needs a
page with something to scroll: the check runs against the indent list at 4200px.

### Still open
- **2.** The tab row (New order / Indents / Orders) still wants a treatment of
  its own.
- Animated category art — parked, awaiting his idea.
- Textract removal — last, as agreed.
