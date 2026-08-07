# Price Comparison & Purchasing — the UI, properly

Its own list, because he asked for one: *"you tried something but I'm not
satisfied… only 10% satisfied, don't know why. Create a separate checklist for
this and work separately on this with full focus."*

## Reading the "don't know why"

That is the useful part of the feedback, not a gap in it. He can see it is
wrong but not name it — which almost always means the STRUCTURE changed and
the SURFACE did not. And that is exactly what happened: killing the split was
plumbing. The pages now show one thing at a time, but the thing they show is
the same list of grey rows in the same grey card it always was. More room, and
nothing put in it.

So this round is not layout. It is what the space is filled with.

## Price Comparison

- [~] **The list is the product, so make it look like one.** PARTLY: it is now
      ordered worst-first, so the biggest saving is the top row. The ROWS
      themselves are unchanged — the saving is still a small chip rather than a
      figure you read without stopping.
- [x] **Lead with the money.** A hero line: what switching everything would
      save this month, in one number, in the currency, at the top. Presently
      it is a sentence in a tinted box.
- [x] **Sort by what it is worth.** Biggest saving first by default, not
      alphabetical. Alphabetical is a filing cabinet; this is a decision list.
- [x] **The comparison stage has a whole page and uses about a third of it.**
      Suppliers deserve real cards — price, gap to cheapest, last change,
      trend — side by side, not a stack of thin rows.
- [x] **Show the trend where the decision is made.** The price history is
      behind a tab; a sparkline belongs on the supplier card itself.
- [ ] **One obvious primary action per stage.** Right now "Choose" is a small
      outline button competing with everything around it.

## Purchasing

- [ ] **The item rows are the same grey list.** Stock state, the vendor spread
      and the saving should be legible at a glance — this is the page where
      money is actually spent.
- [x] **The pinned bar is functional and plain.** It should show the running
      TOTAL, not just a count. "4 items" is not a decision; "£212 across 3
      suppliers" is.
- [x] **The review stage needs to look like a review.** States the total and
      spread up front, AND is grouped by supplier with per-group subtotals,
      biggest group first.
- [x] **"compare ›" on every row is a wasted click if it only opens the same
      sheet.** It names the saving where one exists, and stays quiet where the
      row is already on its best price.

## Both

- [ ] Use the design language the rest of the app has and these two pages
      never adopted: `mise-neo-raised`, `mise-feel`, `mise-press`, the stat
      bands, the rings. Vendors got this and he said "loving the UI" — that is
      the bar, and it is in the repo already.
- [x] Empty and loading states that are not a centred grey sentence.
- [ ] Mobile: these are both wide-table pages; check them at 390px.

## Where it got to (2026-08-07)

Round one killed the split — plumbing. Round two put things in the space: the
hero figure, worst-first ordering, real supplier cards with trends, a running
total and a review stage that states what it comes to.

Still open, and worth doing next:
- Empty and loading states that are not a centred grey sentence
- Mobile at 390px on both pages

## Rule for this work

Do not report it as done on the strength of it compiling. Compare it against
the Vendors page side by side first — that is the one he liked, and the only
honest measure of whether this round actually moved.
