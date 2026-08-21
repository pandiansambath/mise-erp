# The seven — Roles & Access, 21 Aug 2026

> "are u sure u made all these 7 changes???? and deployed? i cant able to see
>  anything"

Fair challenge, and the answer was **no** for three of them on the screen he was
looking at. There are **three** sheets in this area, not one:

| Sheet | Opened by | File |
|---|---|---|
| **JobSheet** | clicking a standard job card (Manager, Till…) on *By job* | `components/JobSheet.tsx` |
| **RoleBuilder** | clicking *Create a role*, or one of your own roles | `components/RoleBuilder.tsx` |
| **AccessSheet** | clicking a person on *By person* | `components/AccessSheet.tsx` |

I rebuilt RoleBuilder and AccessSheet and **missed JobSheet entirely** — which
is the one he opened. So "I can't see anything" was accurate: on Manager,
nothing had changed. That is the lesson worth writing down: *three files do this
job, and a fix applied to two of them is not a fix.*

---

## The list

| # | What he said | Where it applies | Status |
|---|---|---|---|
| 1 | "why can I see 2 same thing duplicates" | all 3 sheets | ✅ one row, all 3 |
| 2 | "all in 1 area so I don't need to scroll" — no tabs | all 3 sheets | ✅ no tabs, all 3 |
| 3 | "over-shadow kinda feel… it's too much" | `globals.css`, app-wide | ✅ depth 8→6px |
| 4 | "shadow is too much under the card" | `globals.css`, app-wide | ✅ contact 30%→18% |
| 5 | sidebar sub-sections auto-open on reload | `AppShell.tsx` | ✅ localStorage dropped |
| 6 | "why 17? I thought we have more" | all 3 sheets | ✅ "of 33 pages", all 3 |
| 7 | By job / By person sit too close to the edge | `globals.css` | ✅ 0.75→1.15rem |

Plus, from the same message:

| # | What he said | Status |
|---|---|---|
| 1b | "that 2 same button is confusing — better keep in top area, as this is a consolidated button" | ✅ one row, at the top |

---

## Detail

### 1 · Two identical bulk rows
An "Everything in this group" row and an "Every page in DineAI" row, stacked,
with the same three buttons. They looked like duplicates because they were one
control drawn twice. **One row, at the top**, for the whole app; each group
heading carries its own small *give all / none* where the group is.

### 2 · One screen, no tabs
Five tabs meant five visits to answer one question, and no way to see what you
had already given without going back. All 17 switches in two columns.

### 3 + 4 · The shadows
`--tile-depth` 8px → 6px, the cast tightened (18px/30% → 14px/20%), and the
contact shadow stopped pooling (10px/30% → 6px/18%). Hover 9 → 7, wide 5 → 4.

### 5 · The sidebar remembering
Open sections were written to `localStorage`, so one tap on Attendance weeks ago
meant Attendance, Rota and Recipes hung open on every load. Starts clean now.

### 6 · "Why 17?"
17 was OUR word for OUR grouping, and he had no way to check it. Counted in
**pages** now — "0 of 33 pages in DineAI" — which he can verify against the
sidebar. 34 screens, 33 reachable through a permission (Dashboard is always on).

### 7 · Room under the toolbar
`padding-bottom` 0.75rem → 1.15rem on `.mise-bench-tools`. The condensed rule
still takes it to zero, so the shrink animation reclaims every pixel of it.


---

## Proof, per file

Checked mechanically rather than by memory, because "I changed it" is what I
said last time about a file I had not opened:

```
RoleBuilder   tabs:ok bulk:1 pages:ok
AccessSheet   tabs:ok bulk:1 pages:ok
JobSheet      tabs:ok bulk:1 pages:ok
```

## What went wrong the first time

I fixed RoleBuilder and AccessSheet, verified both with screenshots, and
reported all seven as done. JobSheet was never opened. It is the sheet you get
by clicking **Manager** on the *By job* board — the most obvious thing on the
page and the first one anybody would try.

Two screenshots of two working sheets is not evidence about a third. The
mechanical audit above exists so the next claim of "all done" is checkable in
one command instead of resting on which screens I happened to look at.

---

# Second batch — 21 Aug, afternoon

Raised after the first seven shipped. Same rule as above: **three sheets share
this UI**, so every row here has to land in all of them or it has not landed.

| # | What he said | Status |
|---|---|---|
| 8 | "I said a POPUP (like the purchase page popup)... this is not popup, it's coming in right side bar" | ✅ `AccessModal`, centred |
| 9 | "I should not feel the scroll... instead of scroll we need CLICK AND SEE" | ✅ master/detail, neither pane scrolls |
| 10 | "I can only see 17 toggles but the top says 13 of 33 — where are the others?" | ✅ units named; every card counts pages |
| 11 | "the cards are not aligned evenly — owner card and tailored card, it's not even" | ✅ `auto-rows-fr` + `h-full`, all 3 grids |

## 8 + 9 · A real popup, and no scrolling

`DetailSheet` is a right-hand drawer. He asked for the centred modal the
purchasing page uses, and separately for the scrolling to stop.

Those two pull against each other: 17 switches do not fit on one phone-sized
surface however they are arranged, so "all of it at once" and "no scrolling"
cannot both be literally true. What CAN be true is that **you never leave** —
one popup holds everything, and moving between its parts is a click.

So: **master and detail inside one modal.** Five groups down the left with a
live "3 of 4 on" count; the group you tap fills the right. The biggest group
holds four switches, so neither pane ever scrolls.

Built as ONE shared component (`components/AccessModal.tsx`) rather than three
copies, because the last round shipped into two of the three sheets and missed
the one he opened.

## 10 · "Where are the other 16?"

A fair reading of two different units in the same box: **33 is pages, 17 is
switches**, and one switch opens several pages — Suppliers & buying opens
Vendors, Price Comparison and Purchasing. Nothing is missing, but the card
never said so. It says which unit it means now, and how many switches are
below.

## 11 · Cards of unequal height

A person with tailored access carries a "Stop access" row that a plain card
does not, so that card is taller and the grid row grows around it. The cards
need to fill their row whatever is inside them.

Also on those cards: "2 of 17 areas", which is the old unit again. The card and
the sheet it opens must agree.


---

# 12 · One switch PER PAGE — not done yet, and here is why

> "let me count... below we have so many but only 17 you are showing. Please
>  show all — let super admin decide what he can show to that role."

He listed all 33 sidebar pages. He is asking for 33 switches, not 17.

**This one I am not going to half-do and call finished.** The 17 are not a
display choice — they are the permissions the app actually has. Several pages
are opened by a single permission:

| One permission | Opens |
|---|---|
| `inventory:read` | Inventory, Stock-take, Waste |
| `orders:write` | Kitchen screen, Tables & QR, Menu |
| `recipes:read` | Recipes, Party Order, Allergens |
| `employees:read` | Employees, Rota, Hiring, Messages |
| `vendors:read` | Vendors, Price Comparison |
| `users:read` | Roles & Access, Audit log |
| `reports:read` | Reports (P&L), Money |

So a "Waste" switch that did not also move Inventory is not something the UI
can fake — there is no permission behind it. Drawing 33 switches over 17
permissions would give him three toggles that move together and no explanation,
which is worse than 17 honest ones.

**What it actually takes:** a permission per page (about 15 new ones), each page
gated on its own, and the sidebar following suit. That is a real piece of work
across the backend, the nav and every affected page — not a CSS change — and it
is next.

Until then every switch names the pages it opens, on the row, so nothing is
hidden: "Inventory · Stock-take · Waste".
