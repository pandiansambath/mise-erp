# Purchasing — the open list

His batch of 2026-08-13, written down verbatim-ish so none of it gets lost.
Tick as they ship; do not delete.

## Bugs first — these are not cosmetic

- [ ] **3. A purchase order VANISHED when a date was set.** "If I give date as
      yesterday then suddenly that PO disappeared. Tried for next one — again
      disappeared, can't able to find anywhere." Setting `expected_delivery` in
      the past moves the order into the **Late** bucket, and the list was
      filtered to *Still to arrive* — so it left the visible list and looked
      deleted. Whatever the cause, an order must never be unfindable.
- [ ] **6. "Stuck · no supplier" cannot be reproduced.** "I can't able to find,
      tried so many ways to see that — but only 1 is showing which is an old
      one already approved. What's the reason bro?" Explain what actually puts
      an indent in that state, and make the one that IS in it explain itself.
- [ ] **8. A PENDING indent's sheet shows nothing useful**, while an ORDERED
      one shows everything. "Any reason behind, or is it a bug?"

## The 3D card, his way

- [ ] **1a.** Shadow on the **top edge AND the left edge**, body nudged right —
      so the card reads as turned to face right. (Currently the cheek is on the
      right, i.e. facing left.)
- [ ] **1b.** **Drop the per-category colours.** "The colour you gave for each
      card is not nice. Actually I loved the previous version we had — only
      grey kinda colour for all category cards, which resembles shadow." Keep
      the *word* (dry store / chilled / …) but make the stripe neutral.

## Layout and motion

- [ ] **4. Shrink-on-scroll, properly.** The BUTTONS must shrink too and rise a
      step, so scrolled-down leaves **one row** holding "Purchasing" and all
      three buttons. Grows back smoothly on the way up.
- [ ] **5. The burst must be ONE event.** "I can literally see 1st popup burst,
      then right side 2nd popup burst, then left some other is disappearing.
      Burst all at once bro — smooth and beautiful, with colour papers throwing
      kind of UI. Should be realistic." (My deepest-first sequence was wrong:
      he wants simultaneous, with confetti.)

## Surfaces still untouched

- [ ] **2.** The tab row (New order / Indents / Orders) is still plain.
- [ ] **6b.** The **indent** search + filter + pager strip.
- [ ] **7.1** The **orders** search + filter + pager strip.
- [ ] **7.2** The sort dropdown ("Newest first") — "very poor and plain UI".
- [ ] **8.1** The item-history sheet ("Everything this item has been ordered
      on") — "not detailed enough to understand, please have details so a
      layman can understand", and the UI still reads plain.

## Crowding

- [ ] **7.** On a purchase run, **"See everything" + "Consolidated PDF" + the
      price** sit on top of each other and feel awkward. Needs a plan, and
      "See everything" is too long — **use "All"**.

---

Standing rules this must obey: [docs/PURCHASING_DESIGN_SYSTEM.md](PURCHASING_DESIGN_SYSTEM.md).
