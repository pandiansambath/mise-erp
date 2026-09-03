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
