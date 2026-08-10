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
      Money and quantity are different questions and get separate settings
- [ ] Apply everywhere the number is shown: lists, sheets, exports, PDFs

## Exports

- [ ] **PDFs grouped by category** — vegetables together, dairy together. A
      flat alphabetical list is a filing cabinet, not a shopping list
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
