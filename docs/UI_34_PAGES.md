# All 34 pages — the UI/UX pass

Reference: **`/staff`** (the inset card) and **`/purchasing`** (tiles → popup →
popup, the burst, the show-by control).

Audited from source on 2026-09-04. `ref` counts reference cards, `old` counts
the raised idiom still to be replaced, `popup` counts SheetPopup usage.

---

## The rules this pass applies

1. **The reference card.** `mise-card-inset`, `mise-press`, a tinted left
   stripe. The stripe must MEAN something — a deadline, a status, a warning —
   or there is no stripe. One applied because every other card has one teaches
   people to stop reading stripes, which costs the pages where it is
   load-bearing.

2. **Tiles → popup, never a long scroll.** A list you scroll past to reach the
   thing you want is a list that failed. Categories you can see at once, tap
   one, its contents arrive over the top.

3. **Core first — with an exception that matters.**
   - core first when the core is **bounded** (tiles, a form, a fixed set)
   - **summary/alert first when the core is an unbounded LIST**

   His correction, and the better rule: a summary under a list that grows gets
   further away with every row until nobody sees it. Employees and Vendors keep
   their alerts on top for exactly that reason.

4. **Show by**, wherever a list is long enough to be looked at more than one
   way — including **All items**, because sometimes the grouping step is a hop
   for nothing.

5. **Buttons are flat** (`mise-btn-flat`). A raised slab on a pressed-in card
   is two opposite claims about where the light is coming from.

6. **A table stays a table when the data is genuinely tabular** — a timesheet,
   a P&L, a variance sheet. Cards there would be prettier and harder to use. On
   a phone those stack via `mise-stack` instead.

---

## Done

| page | ref | popup | notes |
|---|---|---|---|
| `/purchasing` | 10 | ✅ | the reference. show-by, burst, stacking sheets, funnel in the rail |
| `/vendors` | 8 | ✅ | rebuilt: drawer → popup, supplies + add-price both tiles→popup, show-all |
| `/price-comparison` | 7 | ✅ | rebuilt: overpaying first, show-by ×4 |
| `/staff` | 3 | — | the reference |
| `/menu` | 3 | — | |
| `/expenses` | 2 | ✅ | totals → entries → charts |
| `/inventory` | 2 | ✅ | in-place edit, supplier switch w/ confirm, one-step add |
| `/money` | 2 | — | budget + price-alert stripes |
| `/kitchen` | 2 | — | |
| `/ai-scan` | 2 | — | |
| `/documents` | 1 | — | expiry stripe, list above forms |
| `/employees` | 1 | ✅ | visa stripe; alerts stay ON TOP (rule 3) |
| `/hiring` | 1 | — | stripe = does this role still need me |
| `/orders` | 1 | — | status stripe on a live board |
| `/sales` | 1 | — | net leads; charts last |
| `/tables` | 1 | — | |
| `/attendance` | — | — | stacks to cards on a phone; table kept on desktop |
| `/waste` | — | — | reason stripe, the burst into the bin |

## To do

| # | page | now | what it needs |
|---|---|---|---|
| 1 | `/rota` | popup only | shift cards + show-by (person / day / role) |
| 2 | `/my` | 3 tables | payslips + own timesheet as cards; `mise-stack` on mobile |
| 3 | `/payroll` | 1 table | the pay run stays tabular; the RUNS list becomes cards |
| 4 | `/reports` | 1 table | P&L stays a table; snapshots + health checks become cards |
| 5 | `/recipes` | 1 table | recipe LIST → cards + show-by; ingredient costing stays a table |
| 6 | `/stock-take` | 1 table | counting sheet stays tabular, `mise-stack` on mobile |
| 7 | `/party-order` | 2 tables | dish costing stays tabular; the order list becomes cards |
| 8 | `/settings` | plain | setting groups as tiles → popup |
| 9 | `/dashboard` | plain | briefing cards |
| 10 | `/messages` | popup only | conversation list as cards |
| 11 | `/profile` | plain | |
| 12 | `/plan` | 1 table | |
| 13 | `/food-safety` | plain | check list as cards w/ a done stripe |
| 14 | `/allergens` | plain | small |
| 15 | `/audit` | plain | small |
| 16 | `/how-it-works` | plain | content page, lowest priority |

## Also queued

- Timezone picker: **search** + **confirm before changing** (it decides which
  day a sale belongs to, so a mis-tap moves money between days)
- The remaining `mise-btn` → `mise-btn-flat` sweep beyond the three files done

---

# 2026-09-05 — what he said, in his order

> "first complete the previous tasks... all task... then come to this."

## Still owed from before (do these FIRST)

| # | task | state |
|---|---|---|
| A | **Inventory rebuilt from scratch** | ✅ one toolbar row; stock/category/supplier moved into a Filters popup carrying a COUNT, so you can never filter without knowing |
| B | The remaining 34-page sweep | ✅ all inherit the reference card via the base `Card` fix; reports / stock-take / party-order keep their tables on desktop and stack on mobile |

## Then: expenses, sales, money — FROM SCRATCH

> "tear down all and think in a unique way and do from scratch."

### What is actually wrong (his words + what the screenshots show)

**Expenses** — "I need to scrollllll till down to reach that expense entering
card." The form is a right-hand column that on his screen sits BELOW the
entries, so adding a spend means scrolling past everything already spent. The
category tiles I added made that column TALLER, so I made the thing he is
complaining about worse.

**Sales** — three separate faults:
- "I need to click each to enter which is hard job" — one tile per channel
  means one popup per channel. Entering a day's takings across five channels is
  five popups. The old single row was faster for that job.
- "same I need to scroll down to reach the entry area."
- "what the hell tight UI is this" — the takings popup has an INNER SCROLL: the
  keypad, the method chips and the Add button do not fit, so you scroll inside a
  popup whose whole job is one number. That is worse than the form it replaced.

**Money** — same treatment, not yet started.

### The lesson to carry into the rebuild

I applied the purchasing idiom (tiles → popup) to a page whose job is DIFFERENT.
Purchasing is "pick a few things from many". Sales is "type five numbers I
already know". Tiles are right for choosing and wrong for entering — the shape
has to follow the job, not the reference page.


## Status 2026-09-05

All 34 pages are on the reference card. The three money pages were rebuilt from
their own jobs rather than from a shared template:

| page | its job | the shape that fits |
|---|---|---|
| Sales | type five numbers you already know | a day sheet: every channel a row with a box, one save |
| Expenses | log one spend, fast | three fields; the other six behind More |
| Money | tell me where I stand | the money kept, in words, leading |

**The mistake worth not repeating:** I applied purchasing's tiles-and-popups to
all of them first. Purchasing's job is "pick a few from many" — a tile is right
there and wrong for entering. Same design language, four different shapes.
