# Units, packs and the numbers people read — 2026-08-10

His words, kept because the wording carries the problem:

> while adding item to inventory we will specify the unit nah… kg g etc… like
> wise we will specify pack, bottle… here confusing is… **1 pack is 10kg like
> that we doing now… but inside 1 pack there will be 100 small packets…
> what's the each packet weigh… also sometimes we will get packets instead of
> that 1 box**… this is literally confusing users when doing purchase… they
> can't able to enter their wish to purchase… it's very very strict

And from real users of the restaurant:

> 1. PDF need categorisation — vegetables should be in one place
> 2. Pack/quantity confusing — eg: while buying lemon, I may buy 1 case,
>    sometimes I will need pieces
> 3. Quantity should be in grams — no need like `1.5000`, want `1.5 kilo`

---

## The actual problem, stated once

A restaurant **buys** an ingredient in one shape and **uses** it in another,
and today the model only has room for two shapes:

    Item.unit         the stock unit          "kg"
    Item.pack_unit    one buying pack name    "pack"
    Item.pack_size    base units per pack     "10"

That says *1 pack = 10 kg* and nothing else. It cannot say:

- a pack holds **100 packets**, and each packet is **100 g**
- sometimes you buy the **packet**, not the pack
- a case of lemons is **100 pieces**, and sometimes you want **one piece**

One pack shape per item is the whole bug. It is why purchasing feels "very
very strict": the buyer can only ever type the one unit somebody chose when
the item was created.

## The shape it needs

Three levels, not two, and the middle one repeatable:

    base unit     what stock and cost are kept in — g, ml, piece
    pack levels   any number, each: 1 of me = N of the level below me
    buy in        the buyer picks ANY level and types a quantity

Lemons:   piece  ←  case = 100 piece
Rice:     g      ←  packet = 1000 g  ←  pack = 10 packet   (so pack = 10 kg)
Oil:      ml     ←  bottle = 1000 ml ←  box = 12 bottle

Stating it as a **chain** ("1 of me = N of the one below") is what makes the
"100 packets inside a pack, each 100 g" case expressible at all, and it is
also how a chef would say it out loud.

- [ ] **Inventory** — define the base unit and the pack chain. This is the one
      he said to think hardest about: it must read clearly, with a live plain
      -English echo ("1 pack = 10 packets = 10 kg") so a mistake is visible
      while you are making it, not a month later in the stock value
- [ ] **Purchasing** — pick the unit you are actually buying in, from that
      item's chain, and type the quantity in it. The cost and the stock
      movement convert to base units underneath
- [ ] Existing items keep working: `unit` + `pack_unit` + `pack_size` maps
      onto a one-level chain, so nothing has to be re-entered

## The numbers people read

- [ ] **`1.5000` must not appear.** Quantities pick their natural unit and drop
      trailing zeros: `1.5 kg`, `250 g`, `1.2 L`, `3 pieces`
- [ ] Decimal places **configurable** — he asked "shall we keep configurable?".
      Money and quantity are different questions and get separate settings.
      `hotels.prefs.qty_decimals` / `.money_decimals` exist with defaults; they
      still need to be read at every render and exposed in Settings
- [ ] Apply everywhere the number is shown: lists, sheets, exports, PDFs

## Exports

- [x] **PDFs grouped by category** — vegetables together, dairy together. A
      flat alphabetical list is a filing cabinet, not a shopping list.
      **Configurable, per his follow-up: "it can be configurable, so user can
      get how they wanted".** Settings → *Group order PDFs by* →
      `category` (default) or `none` (the old flat list). Stored in the new
      `hotels.prefs` JSON, which is also where the decimal settings go — a
      preference should not cost a migration each time he asks for one.
      Quantities in the PO PDF stopped saying "5.000" at the same time.
- [ ] Settings UI for it (the API and the default are in; the screen is not)
- [ ] Same grouping for the stock-take and price-list PDFs
- [ ] **Rota PDF — "very very clumsy"**. His instruction: *remove anything to
      solve it*, keep the data that is needed, make it look good. The times are
      what break the layout, so a week of shifts wants a fixed grid with
      fixed column widths, not free text poured into a table
- [ ] Then the rest of the exports (attendance, sales, payroll, P&L, POs,
      stock-take, price lists)

---

## The 6.98h that looked wrong — investigated 2026-08-10

> the timing is not accurate see… 11 - 20 is 9hrs nah… why 6hr showing? … check
> cloud watch log and find the root cause too… why we didn't notice this before

**It is not a calculation bug.** Queried the live database rather than reasoning
about the code:

    date        clock_in   clock_out   break_minutes   working_hours   raw span
    2026-08-08  11:01      20:00       120             6.98            8.983

8h59m less a 120-minute unpaid break is 6.98h. The arithmetic is right, and the
other rows on his screen prove the sum works: 16:00–21:30 shows 5.50h and
17:00–21:30 shows 4.50h, both with a zero break.

**Why nobody noticed:** the screen showed the times and the hours and *never
showed the break*. Correct arithmetic with a hidden term in it looks exactly
like broken arithmetic. Fixed — the break is now printed beside the times, and
the hours cell explains itself on hover.

**Where the 120 came from — the part that is still open.** It was not punched on
the kiosk: `break_start` and `break_end` are both NULL, so it was written by the
edit/import path, not by anyone pressing "break" on the wall tablet. And it is
not one stray record:

    break_minutes   records   hotels   staff   first day     last day
    120             96        3        18      2026-07-01    2026-08-08
    0               92
    90              7

Ninety-six records at exactly 120, spread over three hotels and eighteen people
across five weeks. Eighteen people do not each type "120". Meanwhile the rota's
own shifts carry believable breaks (0, 10, 20, 2 minutes), so it did not come
from the rota either. Nothing in the repo seeds it.

- [ ] **Find what wrote 120 to 96 attendance rows** and decide whether that
      data should be corrected. A two-hour unpaid break is not a plausible
      default for anybody's shift
- [ ] Show the break everywhere hours appear, not only in the history table —
      the staff self-service view (`/my`) still prints bare hours
- [ ] Consider a sanity rule: a break over ~90 minutes on a single shift is
      worth flagging when it is entered, not discovered in a screenshot

**Note on CloudWatch:** he asked me to check the logs. App logs are not shipped
to CloudWatch yet — that is still the open task in `nirai-cloudwatch-logging`.
The database was the authoritative source here and it answered the question, but
this is the second time the missing log pipeline has cost an investigation.

---

## I broke scrolling, and how — 2026-08-10

> i cant able to scroll to reach down (as datas are down)... only buttons are
> working... pressed button took me here
> ...here also i cant scroll... what the hell u did??

The first Workbench took the viewport over: AppShell handed `main` its padding
and its scrollbar and the page rebuilt itself as a flex column with an inner
scroller. That needs every link to hold — main flex, bench `flex-1 min-h-0`,
scroller `flex-1 min-h-0`. One link did not hold in the real tree, so content
overflowed a box carrying `overflow: hidden`.

**An `overflow: hidden` box still scrolls when script moves it and never
scrolls for a wheel.** So the sub-nav buttons jumped him down the page while the
wheel did nothing. His data was there and unreachable.

**Why my check missed it.** I built a harness of the shell and measured "the
page scrolls by 0px", then reported that as proof. It proved the mechanism
*could* work in a tree I had built myself. It never asked the only question
that mattered — *does a wheel move this page* — and a page that CANNOT scroll
measures identically to a page that MUST NOT scroll if you only read
scrollHeight. The harness now dispatches a real wheel event.

Fixed by removing the height hijacking entirely: `main` keeps its scrollbar and
the rail/tally are `position: sticky`. Sticky either sticks or it scrolls with
the page; it cannot produce a page that refuses the wheel.

Second, older bug found on the way: `main` had `overflow-y-auto` at every
width, but below `lg` the wrapper is only `min-h-screen`, so main has no
definite height and the DOCUMENT scrolls. main was a scroll container that
never scrolled — invisible until something inside is `sticky`, because sticky
resolves against the nearest scroll container and that one never moves. Now
`lg:overflow-y-auto`, and the rail rests at `--mise-topbar` so it stops parking
under the top bar on mobile.

### And what he actually meant by "no scroll" — still open

> this means we need to show data in different ui style where no need to
> scroll (when scrolling the data we get, the same data we get here with no
> scroll)... but if i want to see i need to scroll

Not "remove the scrollbar". **Make the first screen answer the question**, and
let scrolling work normally for the rest. That is a density and hierarchy job,
not a layout-container job, and it is the real remaining work:

- [ ] Inventory: the first screen should answer "what do I need to order" —
      it currently opens on a donut chart and a filter bar
- [ ] Purchasing: the four tiles are good; the list under them is not dense
      enough to show anything useful above the fold
- [ ] Decide per page what the ONE question is, then fit its answer on screen
