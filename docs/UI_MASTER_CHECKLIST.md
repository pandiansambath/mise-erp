# The UI master checklist — every page to the /purchasing + /staff standard

*"please keep purchase page and role&access page UI UX as reference and implement
the same kinda UI UX in all the pages... in purchase page we have popup burst
animation and all, its super cool nah"*

One list, ticked as it ships, nothing dropped. Audited from the source on
2026-08-31 — counts are real, not remembered.

---

## The kit those two pages are built from

| piece | what it is | lives in |
|---|---|---|
| `mise-card-inset` | shadow pressed INTO the page | /staff |
| `mise-card3d` | the raised tile | /purchasing |
| `mise-press` | squash on tap | both |
| left stripe, tinted | says what KIND of thing this is | both |
| `Sheet` | the centred popup, stackable to depth 2 | **trapped inside OrderFlow.tsx** |
| `burstToBasket` | the popup collapses into a bubble and flies | `order/burst.ts` |
| `ClickSpark` / `SpotlightCard` / `GlareHover` | tap sparks, cursor light, sheen | `reactbits/` |

**The burst is the bit he singled out.** It works because it describes a cause
and an effect: the thing you were looking at BECOMES the thing now in your
basket. One object, one continuous movement. It is not decoration and it should
only ever fire when something genuinely moves from A to B — firing it on a page
where nothing moves would be noise wearing the same costume.

### Step 0 — the kit has to be shared before it can spread

`Sheet` is a private function inside `OrderFlow.tsx`. Every other page that
wants the purchasing popup would have to copy it, and six copies of a popup is
how six popups start behaving differently. Extract first, then spread.

- [x] Extract `Sheet` → `components/SheetPopup.tsx` *(shipped — with `useBackToClose` so Android back closes it, and focus restored to the opener)*
- [x] A shared `TileCard` for the reference card + stripe *(shipped)*
- [x] `burstTo(from, targetId)` generalised beyond the basket *(shipped — `burstToTarget`)*

---

## The pages

Counts are `inset` / `c3d` = reference cards, `neo` = the old drop-shadow card,
`tbl` = raw tables.

### Reference — already the standard

| page | state |
|---|---|
| `/purchasing` | ✅ the reference (10 c3d, burst, stacking sheets) |
| `/staff` | ✅ the reference (3 inset) |

### Swept before this checklist existed

| page | state |
|---|---|
| `/expenses` | ✅ 41 cards live · totals → entries → pie |
| `/vendors` | ✅ 53 cards live · tiles + price list |
| `/price-comparison` | ✅ quote cards, chosen/cheapest stripe |
| `/employees` | ✅ visa stripe · pay donut moved below the team |
| `/documents` | ✅ expiry stripe · list moved above the forms |
| `/sales` | ✅ net leads · lines above the charts |

### To do — ordered by how much a restaurant actually opens them

| # | page | now | what it needs |
|---|---|---|---|
| 1 | `/inventory` | neo=2, tbl=2 | 2214 lines, his most-used stock page. Rows already open a DetailSheet. Item tiles + the purchasing popup for the item |
| 2 | `/rota` | neo=11 | the worst offender by count. Shifts are cards with a stripe per person |
| 3 | `/orders` | neo=8 | live orders — cards with a status stripe |
| 4 | `/money` | neo=6 | cash box + movements |
| 5 | `/attendance` | neo=6, tbl=2 | ⚠️ 7 columns of times. Cards on MOBILE, table on desktop — a timesheet is genuinely tabular |
| 6 | `/hiring` | neo=8 | applicants are people — the /staff card |
| 7 | `/settings` | neo=4 | setting groups as tiles |
| 8 | `/menu` | c3d=3, neo=2 | half-converted already |
| 9 | `/my` | neo=3, tbl=3 | payslips + own timesheet |
| 10 | `/party-order` | neo=6, tbl=2 | dish costing |
| 11 | `/waste` | neo=1 | small page, quick win |
| 12 | `/stock-take` | neo=2, tbl=1 | counting sheet |
| 13 | `/kitchen` | c3d=2 | nearly there |
| 14 | `/tables` | c3d=1 | nearly there |
| 15 | `/recipes` | tbl=1 | the recipe LIST becomes cards; the ingredient costing stays a table |
| 16 | `/dashboard` | neo=1 | briefing cards |
| 17 | `/food-safety`, `/allergens`, `/messages`, `/profile`, `/audit`, `/how-it-works`, `/plan`, `/ai-scan` | mostly plain | smaller pages, same treatment |

### Staying tabular, deliberately

`/reports` (P&L), `/payroll` (a pay run), `/stock-take`'s variance columns,
`/recipes`' ingredient costing, `/party-order`'s dish costing, and
`/inventory`'s import preview.

Reading DOWN an aligned column is the entire point of those, and the import
preview mirrors the spreadsheet being imported. Cards would make them prettier
and harder to use. **Where the data is genuinely tabular the honest answer is a
better table** — same card frame around it, same stripe, but rows that stay
rows.

---

## Rules for every page in this sweep

1. **The stripe must MEAN something.** On Employees it is the visa, on Documents
   the expiry. If a page has no fact worth a colour, no stripe — a decorative
   stripe teaches people to ignore the ones that matter.
2. **Numbers first, work second, charts last.** Already applied to sales,
   expenses and employees.
3. **Never scroll to reach what the page is FOR.** Documents broke this; fixed.
4. **The burst only fires when something moves.** A to B, or not at all.
5. **Verify on the deployed site, with a screenshot I actually open.** Three
   real bugs this week came from looking at a screenshot and none from a test.


---

# Batch 2026-09-02 — his screenshots

| # | What he said | Kind | State |
|---|---|---|---|
| 1 | A running **HH:MM:SS clock** in the corner, in the HOTEL's timezone, on literally every page | feature | ☐ |
| 2 | "No login yet" popup has **no redirect link** to Staff, and its UI is not nice | bug + UI | ☐ |
| 3 | Purchasing supplier tiles — **card shadow not nice**, use /staff | UI | ☐ |
| 4 | **Show by supplier → tapping one still shows every supplier's items** | 🔴 BUG | ☐ |
| 5 | It lists items regardless of whether that supplier prices them | 🔴 BUG | ☐ |
| 6 | **Card UI differs between the three screens** — be consistent | UI | ☐ |
| 7 | Price high–low cards "over too much enhanced" | UI | ☐ |
| 8 | ⭐ **REBUILD THE INVENTORY PAGE** | big | ☐ |

## 4 and 5 are the same bug and it is a real one

Tapping **Exotic** opens a popup headed "Exotic · 48 items" and then lists
Aluminium Containers priced **£4.77 from SK**, Bell Pepper **from Farm2Land**,
Carry Bags **from Rudra**.

The LIST is right — those are the 48 items Exotic prices. The PRICES are not:
each card asks `supplierFor(item)`, which answers with the item's globally
chosen supplier, not the vendor whose tile you just pressed. So "show by
supplier" shows you a supplier's catalogue at somebody else's prices, and
"Add all" would build an Exotic order out of other people's numbers.

The machinery to fix it already exists — `catVendor` pins a popup to one
supplier for one sitting. Arriving via a supplier tile should set it.

## 8 — why inventory is the big one

> "we gave this project to 1 hotel, they are using it, their staff feel so tired
>  when they come to the inventory section... add vendor, add item, then go to
>  vendor and choose that vendor for that item, then come back to inventory and
>  check — it's like a cycle, going here and there"

That is a three-page round trip to do one thing: **stock an item you can buy.**
The fix is not paint. It is that adding an item should be able to finish the
job — item, its supplier, and that supplier's price, in one place — with the
Vendors page still there for people who think supplier-first.


---

# Batch 2026-09-03

| # | What he said | State |
|---|---|---|
| 1 | Changing a supplier on one click must CONFIRM — a misclick changes what costing uses | ☐ |
| 2 | Purchasing: 4 screens whose card UI he does not like (indent list, PO runs, PO sheet, indent sheet) | ☐ |
| 3 | Vendors: needs the purchasing popup-in-popup; today it is all scrolling | ☐ |
| 4 | Price comparison: change the UI completely | ☐ |
| 5 | ⭐ **CORE FIRST ON EVERY PAGE** | ☐ |

## 5 is the one that matters most

> "the core job of the page is done and I need to scroll. eg purchase page core
>  job is to show items I mean categories, but the full page is occupied by
>  indications and alerts and the core is very bottom that I need to scroll to
>  see. likewise inventory, vendor, all pages. please show core at top — but
>  this doesn't mean you should not show the indication/navigation bars."

Purchasing opens with: a page title, a tab bar, a four-stage funnel, a
low-stock banner — and only THEN the categories, which are the thing the page
is for. Four bands of furniture before the first thing you can tap.

The instruction is precise and worth keeping: not "remove the alerts". Move the
core above them. An alert is worth seeing on the way past; it is not worth
making someone scroll before they can start.
