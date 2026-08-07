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

## Phase 5 — the click audit

- [ ] Go through **every** section and find the wasted clicks: rows that only
      highlight, values that only display, headers that do nothing
- [ ] Report what was found before changing it

---

## Still open from before

- [ ] **AI tuning (#15)**: advice instead of refusals; handle PDFs properly
      (starters shipped 2026-08-07)
- [ ] **Inventory redesign** — he called it "clumsy"
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
