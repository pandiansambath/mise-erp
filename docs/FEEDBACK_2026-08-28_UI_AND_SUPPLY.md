# 2026-08-28 — the UI sweep and the supply-side features

| # | What he asked for | State |
|---|---|---|
| 1 | Every page to follow the **Roles & Access / Purchasing** UI. Sales + Expenses: core numbers FIRST, pie charts LAST | ✅ ordering verified live; **7 pages swept** to the reference card |
| 2 | Change an item's vendor **from the Inventory screen** | ✅ **verified live** — 4 suppliers listed cheapest-first in the sheet, ★ on the chosen one |
| 3 | Purchasing: **show by** category / vendor / price high-low | ✅ **verified live** — 5 supplier tiles, 66 items ranked Saffron £1,728/kg down |
| 4 | Keep edit-in-place everywhere it makes sense | ◑ inventory supplier switch is in place; nothing removed anywhere |
| 5 | Purchasing: showing by vendor → move that vendor's **whole list into the basket** | ✅ **verified live** — basket went 1 → 49 on one tap |
| 6 | Vendors: **download** a vendor's items with prices | ✅ **verified live** — real xlsx off his tenant, 48 items with prices |
| 7 | PO / indent PDF: **no prices**; and show the PACK he ordered ("1 pack"), not "1 litre" | ✅ **verified live** — read PO-2026-066's PDF: "2 boxes", no prices |

## 7 is a correctness bug, not a preference

If he orders one pack that holds ten kilos, the PDF has been printing "1 kg".
The supplier reads the PDF. A quantity that is wrong by a factor of ten, on the
document that goes to the person filling the order, is the same class of fault
as the shift that landed on the wrong day.


## Two deploys failed and I did not look

`36a8520` (the supply-side tools) and `b9cad09` (the PO fix + vendor download)
both went red, and I reported them as shipped. The site stayed on `c234369` the
whole time, so none of it was ever on his tenant.

The cause was not flaky. Coverage fell to **69% against a 70% floor** — about
500 statements of new tool code with no tests behind it. The gate did its job;
I was the one who did not read it.

Fixed by writing the tests that were missing rather than by moving the floor:

- `tests/test_assistant_supply_tools.py` — all twelve new tools against an
  EMPTY hotel as well as a populated one, because an empty restaurant is what a
  new tenant is on day one, and a tool that raises is indistinguishable from a
  tool that was never built.
- `tests/test_po_pack_wording.py` — 1 pack / 2 packs / and the 15 kg case that
  must NOT convert.
- `tests/test_vendor_price_list.py` — including a vendor id from another tenant,
  since that id travels in the URL.

**Rule for me:** watch every deploy to green before saying a thing shipped.

## Two bugs the tests missed and the live site showed

1. **"2 boxs".** PO-2026-066 really printed that. My pluraliser appended an "s".
   Fixed with the two English rules that cover every pack name a kitchen uses.
2. **The screen could not see the packs.** `POItemOut` never declared
   `ordered_as`, and a field a response_model does not name is dropped in
   silence — the PDF said "2 boxes" while the page behind it said "20 kg".
   Fourth time this trap has cost a bug. The new test asserts through the
   ENDPOINT, because the service was right both times.

## And the test itself lied twice

The layout check passed while verifying nothing: it looked for a chart, found
none (the donut is not rendered on a quiet day), skipped its own assertion and
reported green. Then it measured `body.scrollHeight`, which is always the
viewport here because the app scrolls an inner container.

Now it compares DOM order — which is what "comes first on the page" means —
and fails loudly if either marker is missing. Same class of mistake as
"page scrolls 0px" reading the same for *must not* and *cannot*.

## Still open

- The wider style sweep for item 1 (vendors, price-comparison, expenses tables
  are still plain where purchasing is tactile).
- Live verification of everything above on his tenant, with screenshots.


## The UI sweep — /staff and /purchasing as the reference

*"please take /staff and /purchasing as reference for UI/UX — I mean the cards,
shadow, popup."*

The vocabulary those two pages are built from:

| class | what it does | where |
|---|---|---|
| `mise-card-inset` | shadow pressed INTO the page | /staff |
| `mise-card3d` | the raised tile | /purchasing |
| `mise-press` | squash on tap | both |
| a tinted stripe down the left | says what kind of thing this is | both |

### Swept

| page | the stripe carries |
|---|---|
| Expenses — categories + entries | fixed vs variable |
| Sales — the day's lines | (net leads instead) |
| Vendors — supplier tiles + their price list | active / ★ chosen |
| Price comparison — the quote cards | chosen / cheapest / neither |
| Employees | **visa** — red expired, amber ≤30d |
| Documents | **expiry** — same rule, same colours |

On Employees and Documents the stripe is not decoration: it carries the one
fact with a deadline attached, which was a badge in the third or fifth column,
in the same grey as the file size, on pages whose whole job is stopping a visa
or a licence lapsing.

Two content decisions came with the paint:

- **Sales** leads with NET, because net is what reaches the bank. Gross and
  commission sit under it in words instead of as unlabelled money columns you
  count across on a phone.
- **Price comparison** was the real mismatch — `mise-neo-raised` throws light
  ON the card from outside while both reference pages press theirs IN. Side by
  side they read as two different applications.

### Deliberately NOT swept

Attendance, payroll, reports, stock-take, recipes, party-order, `my`, and
inventory's import preview. Those are timesheets, a P&L, a variance sheet and
costing breakdowns — reading DOWN an aligned column is the entire point, and
inventory's import preview mirrors the spreadsheet being imported. Cards would
make them prettier and harder to use.

### Sorting nearly went with the tables

`SortTh` only works inside a `<thead>`, so turning a ledger into cards would
have quietly cost the reader the ability to order it. `SortBar` drives the SAME
`Sort` object as chips, shaped like the purchasing "show by" control so there is
one idiom for "change what this list is doing" rather than two that look almost
alike.

### The audit counted empty pages

First version reported zero cards everywhere and I nearly believed it. Expenses
opens on TODAY and is blank on a quiet day, the vendor price cards live inside
a detail sheet, and the comparison cards need an item chosen — it was measuring
three empty screens. It drives each page to the state that draws them now.

Fourth time this session a test measured the wrong thing, and the fourth time
reading the NUMBERS rather than the pass/fail is what caught it.
