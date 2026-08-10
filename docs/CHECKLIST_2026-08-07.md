# The list — 2026-08-07

Everything outstanding, in the phases we agreed. One phase at a time, deployed
and checked with him before the next one starts.

**The two standing laws for this work:**

> **Click anything, do anything.** If a screen shows something you are allowed
> to change, changing it happens there.

> **Every click must have a meaning.** Don't waste the user's click — if they
> can click somewhere, something useful belongs there.

---

## Phase 1 — sidebar sub-sections (he called this the most important)

- [ ] Sub-sections **open and close on click** (one click each way), not only
      shown for the page you happen to be on
- [ ] Clicking a sub-section **actually switches the page's section** —
      "currently it's not working". Known cause: SubNav fires once per MOUNT,
      and moving inside the same page never remounts it
- [ ] The active sub-section is highlighted
- [ ] **Every** section gets sub-sections, not just Purchasing
- [ ] Remember which are open, so the sidebar looks the same on the next visit

## Phase 2 — the AI panel

- [ ] **Cramped when shrunk**: title, badge and the input collide (his two
      screenshots). Contents must obey the width
- [ ] **Clicking outside closes it.** Add an options button with a toggle:
      *"Close when I click outside?"* — some people want it, some don't, so it
      is a setting, not a decision
- [ ] **Bubble: double-click shrinks it** to the logo alone, spiralling in.
      Right now it always shows "DineAI" and takes space

## Phase 2b — the kiosk, second pass

- [ ] **Incognito: the PIN is accepted but nothing happens.** Reported after
      the PIN fix shipped, so this is a different fault from the last one —
      most likely where the tab token is kept. Investigate before changing
      anything.
- [ ] **Theme**: follow the HOTEL's theme by default, and put a theme picker on
      the screen. (This reverses the pinned-dark fix on purpose — his call.
      The screen must then be legible in a LIGHT theme too, which is the trap
      that caused the washed-out screen in the first place.)
- [ ] **Clock**: the digital readout goes UNDER the hands — hands sweep over
      the top of it
- [ ] **Clock follows the hotel's timezone**, and says which one it is showing
- [ ] **Empty space on the left** now the clock is bigger: bring the left-hand
      content back up and pin it there
- [ ] **"Enter the PIN to leave" still has a 4-character box** — same
      complaint as the gate, different component
- [ ] **Rota button** on the kiosk — see today's rota there
- [ ] **Leave button** — who is off today
- [ ] Both **configurable by the owner when generating the PIN** (toggles: show
      rota? show leave?)
- [ ] Rota and leave views need big type that fits the screen even when the
      text is long — a wall screen read from across the room

## The Workbench — done 2026-08-10

He said it plainly: *"i dont like my purchase section, price comparison section,
inventory section, staff section ui, even vendor section… i want an impressive
UI… i should not scroll… currently ui is very clumsy and collapsed"*.

Polishing had failed twice because the fault was the SHAPE of the pages, not
their styling:

- Inventory opened with a 180-line **add-item form** between the header and
  your stock. Vendors did the same with **add a vendor**.
- The lists that survived that were then capped — `max-h-[62vh]`,
  `max-h-[60vh]` — and scrolled INSIDE a page that was already scrolling.
  Two scrollbars, and the list got the leftovers of the leftovers.

`components/Workbench.tsx` inverts it. The page fills the viewport and never
scrolls itself: pinned rail, the list taking every remaining pixel, a pinned
tally along the bottom. `AppShell` hands its padding and its scrollbar over
whenever a page renders `[data-bench]`, so nothing else is touched.

- [x] **Inventory** — form opens in place; five header buttons become one
      primary and a ⋯ menu; tally shows items, stock value, low and out
- [x] **Purchasing** — sub-nav pinned, both `max-h-[60vh]` caps gone; tally
      shows committed spend, open orders, indents waiting, anything overdue
- [x] **Price Comparison** — kept the two-stage layout, added the height fix;
      tally shows the per-unit saving available and across how many items
- [x] **Vendors** — add-supplier form moved into a sheet; the "how it works"
      box now shows only when there are no suppliers yet
- [x] **Staff** — the three-job selector pinned to the rail

Measured, not assumed, in a real browser at 1440×900 and 390×844: the page
scrolls by **0px**, `main` hands over its padding, the list is the only
scroller (689px tall on desktop), the tally stays on screen, and the rail
condenses 20px → 9.6px as the list moves.

---

## Phase 3 — Price Comparison, rebuilt full-width

- [ ] Two cards side by side is the problem: neither has room. **Kill the
      split.**
- [ ] Each section takes the **whole page**: pick an item → the next section
      takes over the full width, with room for real design
- [ ] Clicking an item **moves you to its comparison section**, where the
      choosing happens
- [ ] Back to the list without losing where you were

## Phase 4 — Purchasing, same treatment

- [ ] Same full-width sections as Phase 3 — his words: "refer that, study
      vendor UI"
- [ ] Every click earns its place

## Phase 4b — Roles & Access, rebuilt

Added 2026-08-07. He is happy with how it WORKS — the IAM-style write-then-
attach flow landed — and unhappy with everything about how it looks: "very
very poor UI, that entire staff page… better destroy whole and recreate."

- [ ] Rebuild `/staff` from scratch. Keep the behaviour, throw away the layout.
- [ ] Neumorphic / current design language — the `mise-neo-raised`, `mise-feel`,
      `mise-press` kit the rest of the app already uses, which this page never
      adopted
- [ ] The three jobs it does — who can sign in, what a role grants, who holds
      it — should read as three distinct things, not one long form
- [ ] Do NOT change the permission model or the attach flow; he likes both

## Kiosk — the counters become doors (added 2026-08-08)

- [ ] "0 in now", "0 on break", "0 finished" are labels; they should OPEN.
      Tap one and see WHO — the same wall-readable treatment as the rota and
      leave panels. His slogan applies: every click must have a meaning.

## Phase 6 — every export, checked (added 2026-08-07, LAST)

He opened the rota PDF and found it "very clumsy to see, because of timings" —
the shift times are what break the layout, so a week of them needs planning as
a grid rather than poured into a table and hoped for.

- [ ] **Rota PDF first** — it is the one he actually looked at. Times are the
      problem: they need fixed column widths and a legible per-day block, not
      free-flowing text
- [ ] Then audit **every** PDF and Excel export in the app — attendance, sales,
      payroll/payslips, reports/P&L, purchase orders, stock-take, price lists
- [ ] Open each one and look at it. An export that compiles is not an export
      that reads
- [ ] Fix whatever is clumsy; report what was found either way

## Phase 5 — the click audit

- [ ] Go through **every** section and find the wasted clicks: rows that only
      highlight, values that only display, headers that do nothing
- [ ] Report what was found before changing it

---

## Still open from before

- [ ] **AI tuning (#15)**: advice instead of refusals; handle PDFs properly
      (starters shipped 2026-08-07)
- [x] **Inventory redesign** — done, see The Workbench above
- [ ] **Vendor credit / part-payment** (#4)
- [ ] **Purchasing indent/PO slide-in drawers** (#8.1)
- [ ] **Mobile pass**: inventory, recipes, money, reports, payroll, orders
- [ ] Detail sheets for attendance, documents, audit, food-safety
- [ ] Daily AI nudge; shared brand component; CloudWatch terraform follow-up
- [ ] **#6 inventory ↔ vendor name matching — DISCUSS FIRST.** He asked to talk
      before anything is built. Not started, deliberately.
- [ ] **Microsoft Clarity** — session recordings + heatmaps. Its dead-click
      report is the Phase 5 audit done with evidence. Decide masking and scope
      with him first (it records a real restaurant's data).
- [ ] His own task: rename the Stripe account (cosmetic)

## Done and live (this session)

- Kiosk: account theme was leaking into the wall tablet; PIN gate showed 4
  slots for a 6-digit PIN; clock bigger, with seconds — `7c9c6a9`
- Vendors / Purchasing / Price Comparison on stacking, sectioned sheets —
  `08cd690` (**vendors: "loving the UI"**)
- Chat panel could be dragged off screen and never got back; sidebar
  sub-sections v1 — `b49feb7`
- AI starters, per page — `32d598a`
- Dev page: the left column hands over to the shell instead of going empty;
  page ends at the links; education headline struck in gold — `0615088`
