# `/control-room/money` — the redesign

> "serisly this entire page is not really that muhc detailed and not nic ein
> terms of UI UX too..epalse rebuild"

Design spec. Written against the live page and the live numbers, not against a
description of them. Everything below has a real figure in it so it can be built
directly.

**Evidence this is based on** (16 Sep 2026, live, `control@mise.app`):

| What | How |
|---|---|
| Desktop render, 1600×1100 | `e2e/_sre-money.spec.ts`, `scratchpad/money-top.png` · page is **1,246px**, 1.13 screens |
| Phone render, 390×844 | full-page shot, `scratchpad/pd-phone-full.png` · page is **2,509px, 2.97 screens** |
| Every bill line with its usage type | `scratchpad/ce_ut.json` — Cost Explorer, SERVICE × USAGE_TYPE, 1–15 Sep |
| The rendered text | the spec's `PAGE TEXT` dump |
| The payload shape | `backend/app/platform_admin/router.py` `/costs/summary`, `/costs/hotels` |

The measured figures drift between page loads (requests read 2,119 → 2,196 →
2,286 → 2,331 across four loads an hour apart — the counters are live). Every
measured number quoted below is one honest reading, not a constant to assert in
a test. The billed figures do not drift within a day.

---

## 1. What is actually on screen, and what a stranger sees first

Reading the screenshot, top to bottom:

1. A card 251px tall (y 164→415 in the 1600px shot). Its left cell is **767px
   wide** and holds a 60px `$17.13` that occupies **175px** of it, a chip, and
   one green sentence; the cell's content stops at y 342, **73px above the
   card's floor**. So the headline sits in a cell that is empty to its right and
   empty beneath it. The right third is a `mise-well` of four lines at 11–13px.
   This is the "wasted space in right and left side" complaint, in the one card
   that carries the headline.
2. A 60px-tall row containing three period buttons, a refresh button, and a
   38-word sentence **apologising that the buttons do not change the number**.
3. "By service": ten rows. Three of them are labelled `Amazon Relational ...`
   with three different amounts (6.426 / 1.323 / 0.101) and nothing on screen
   distinguishes them, because the label is `w-28` (112px) truncated and
   `usage_type` is never passed. Two more read `Claude Sonnet 4.6 ...` twice.
4. The amounts are **`6.426`, `1.79`, `0.12` — no `$`, and 1 to 3 decimals.**
   `Bars` defaults `formatValue` to `toLocaleString` and the page never
   overrides it. A number without its unit, ten times, on the money page.
5. The bar colours are `CHART_COLORS` in order — blue, orange, blue, orange,
   red, teal, purple, grey. The colour encodes the row's *index*. It looks like
   a category legend and means nothing.
6. An amber paragraph: *"13 unclassified services — EC2 - Other, EC2 - Other,
   EC2 - Other…"* thirteen times. **Those thirteen lines are worth $0.0000
   between them** (see §4). The page's only alarm colour is spent on nothing,
   which is how a real alarm gets ignored.
7. "Cost per request" — three definitions sitting at the same visual weight as
   the bill itself, and the card bottoms out ~100px short of its neighbour, so
   it has a dead strip too.
8. "Per restaurant": **two rows.** There are three restaurants. The second row
   is `(anonymous / public traffic)` and nothing on the page says what that is.
9. On a phone, `.mise-stack` reflows that table into cards — but it prints its
   `<td>` labels from `data-label`, and **this page sets none**, so each
   restaurant becomes a card containing `704`, `267`, `$0.64`, `$7.44` with no
   labels at all. Four bare numbers per restaurant. Verified in the phone shot.
10. Also on a phone: the bar chart's label is `w-28` and its value `w-20`, so in
    390px the bar itself gets ~60px. Every bar renders as an identical grey
    stub. The chart conveys zero information on mobile.

Ranked by what a stranger notices in five seconds: **(a)** the hero card is
half-empty, **(b)** the same service name printed three times with different
numbers, **(c)** numbers with no `$`, **(d)** an amber warning repeating one word
thirteen times, **(e)** two rows where three restaurants exist.

---

## 2. The hero decision

Two true numbers compete:

- **Invoice: $0.00.** Credits cancel usage exactly, every month.
- **Consumption: $17.13 month-to-date, ~$32.12/month run rate.**

Leading with $0.00 is reassuring and useless: it will read $0.00 every month
until roughly 12 December, and then, with no warning from this page, it becomes
$32. Leading with $32 alone implies a charge that has not happened.

### The decision

**The hero is CONSUMPTION for the selected period. The invoice is the line
directly beneath it, in the same card, never a competing figure.**

```
USAGE · 1–16 SEPTEMBER 2026              [AWS · 5h ago]
$17.13
─────────────────────────────────────────────────────
Invoiced $0.00 — credits paid all of it  [AWS · 5h ago]
```

Four reasons, in order of weight:

1. **Consumption is the only one of the two with a lever behind it.** Every
   action available to him — drop the idle Public IPv4 ($1.71/mo), keep 3 ECR
   images instead of 896 ($1.53/mo), right-size RDS ($6.14/mo) — moves $17.13
   and cannot move $0.00. A dashboard whose headline nothing can change is
   decoration.
2. **It is the number that becomes the invoice, unchanged.** On the day the
   credits run out, this page does not need to teach him a new headline; one
   chip flips from *"credits paid all of it"* to *"charged to your card"*. No
   surprise, no re-learning.
3. **It moves.** $0.00 will not change for ~3 months. A figure that never moves
   trains him to stop opening the page, and the month it finally moves is the
   month he is not looking.
4. **It answers his actual sentence** — *"litrelly when i eneter i need ot know
   'oh ths is the amount'"*. $17.13 is the amount. $0.00 is the invoice. Both
   are on screen, one is bigger, and which is which is written on them.

### The safeguard that makes it honest

`$0.00` must never be reachable by squinting. Rules:

- The invoice line sits **inside the hero card**, above the fold, in `text-base
  font-semibold` with its own `<Source kind="billed">` chip. Not a footnote, not
  a tooltip, not below the fold.
- When credits cover 100%, the line is toned `mise-tone-good`. When they cover
  part, it reads `Invoiced $12.40 — credits paid $19.72 of $32.12`. When the
  balance is zero it is `mise-tone-bad` and reads `Charged to your card`.
- The hero **never** renders `$0.00` itself. If `billed.available === false`,
  the hero is `—` at full size with the reason under it and a fetch button. That
  rule already exists in `money()` and must survive the rebuild.

### The thing that outranks the hero

`cost_map.is_loud()` exists (NatGateway, LoadBalancerUsage,
ElasticIP:IdleAddress, DataTransfer-Out-Bytes) and **nothing on the page calls
it**. A NAT gateway is ~$35/month the moment it exists; a month-end total
notices it a month late.

Add one strip **above the hero**, rendered only when a loud usage type appears,
`mise-tone-bad`, full width, 44px:

> **A NAT gateway appeared on 14 Sep.** `EUW2-NatGateway-Hours` · $0.42 so far ·
> about **$35/month** if it stays. → *see the line*

That is the only element permitted to sit above the headline number.

---

## 3. The period control, and history — one thing, not two

He pressed "90 days" and the number did not move; he expected ~$60 (the truth is
$68.26). And July and August exist nowhere on the page.

**Both are the same problem, so they get the same answer: the period control
becomes a row of MONTHS, each chip carrying its own total, and it is the hero's
label.** A control that *is* the label of the number cannot be dead.

```
┌ MONTH STRIP (full width of the hero card, 44px) ─────────────────────────┐
│  Jul        Aug         Sep · so far      All 3 months     ↻ Refresh     │
│  $9.22      $41.91      $17.13            $68.26           $0.02, 5h ago │
└──────────────────────────────────────────────────────────────────────────┘
```

- **A bill is a month** is preserved: every option but the last *is* a calendar
  month, named by its month name.
- The last chip is **"All 3 months · $68.26"**, not "90 days". The account's data
  starts in July; "90 days" would claim a rolling window we cannot fill. It
  gives him the ~$60 he was looking for, and it is exact.
- Selecting it sets the hero to `$68.26`, its label to `1 JUL – 16 SEP 2026 · 3
  MONTHS`, and the invoice line to `Invoiced $0.00 across all three`.
- History needed no card. **The selector is the history.** Three totals visible
  without a click, and each one is one click from being the whole page.
- A fourth month simply appends; past six, the strip keeps the last five and
  "All" and the rest move into the *Every month* popup.
- `Segmented` cannot do this — it takes `{value,label}` and has no second line.
  Build a local `PeriodTabs` in the page file (~30 lines). Do not bend
  `Segmented`; four other pages use it.

**The whole page follows the strip.** Today `measured` uses `?days=` while
`billed` uses the calendar month, so the two halves of the page describe
different spans and nothing says so. After this, one `{from,to}` drives
everything: hero, lines, restaurants, requests.

**The trap that creates:** counters started long after July. Selecting **Jul**
must show `—` in every measured figure with the reason *"counters started 5 Sep
— nothing was measured before that"*, never `0`. Needs `measured.first_day` in
the payload. `0 requests in July` would be an invention, and it is the exact
failure this page's own docstring was written to prevent.

---

## 4. Section-by-section layout

Content width: **1,004px at 1280**, **1,644px at 1920** (shell is `px-6`, rail
`lg:w-52`, gap 20). Height budget at 1280×800: 703px usable after header and
padding. The target is **one screen at 1280×800, everything else behind a click**.

```
┌── LOUD STRIP (conditional, 44px) ───────────────────────────────────────┐
├── ❶ THE BAND — one Card, p-0 ───────────────────────────────────────────┤
│  month strip · 44px                                                      │
├──────────────────────┬─────────────────────┬────────────────────────────┤
│ USAGE 1–16 SEP  [AWS]│ CREDIT       [live] │ MEASURED, same period      │
│ $17.13               │ $91.40              │ 2,196 requests      [live] │
│ ──────────────────── │ ▓▓▓▓▓▓░░░░░ 55% left│   266 AI calls      [live] │
│ Invoiced $0.00  [AWS]│ runs out ~12 Dec 26 │ 3,369 DB reads / 17 writes │
│ credits paid all     │ then $32.12/mo      │                            │
│                      │ expires 30 Jun 27   │ 1,574 of those were public │
│ ▸ every month        │  [entered by hand]  │ ▸ who used it              │
│                      │ ▸ credits & expiry  │                            │
├──────────────────────┴─────────────────────┴────────────────────────────┤
│  grid lg:grid-cols-[1.2fr_1fr_1fr], border-l border-line from lg:       │
└─────────────────────────────────────────────────────────────────────────┘
┌── ❷ WHERE IT GOES (7 cols) ─────────┬── ❸ WHO USED IT (5 cols) ─────────┐
│  8 rows + footer                    │  4 rows + total + reconciliation  │
└─────────────────────────────────────┴───────────────────────────────────┘
┌── ❹ FOLD: "How these numbers are made · 3 definitions, 1 formula" ──────┐
└─────────────────────────────────────────────────────────────────────────┘
```

Height: 44 + 150 + 16 + 440 + 16 + 48 + 40 = **754px**. Fits 800. At 1100 the
two mid cards take `flex-1` so the card grows, not the page's bare ground.

### ❶ The band — one Card, three populated columns

`grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]`, dividers
`lg:border-l lg:border-line`. **Asymmetry comes from TYPE SIZE, not from empty
space** — the hero is 60px, everything else tops out at 20px. That is the
correction to the current card, which achieves its asymmetry by leaving 592px
of its headline cell blank to the right and 73px blank beneath.

**Column A — the amount.** Label (`font-mono text-[11px] uppercase
tracking-[0.18em] text-fg-faint`), `$17.13` at `text-5xl sm:text-6xl`, a hairline
`border-t border-line`, then the invoice line. Footer link `▸ every month` opens
**P1**. The whole column is `mise-press` and clickable.

**Column B — the credit, and the date it stops mattering.** This is the most
consequential block on the page and it is currently 11px grey prose. It gets:
- `$91.40` at `text-2xl`, `<Source kind="live">`.
- A depletion meter — `mise-well` track, brand fill, 6px. `$91.40` of an original
  balance; if the original is unknown, the meter is the **months** bar instead
  (2.8 of 3.0 shown), never a bar with an invented denominator.
- **`Runs out around 12 December 2026`** at `text-base font-semibold`. This is
  the sentence the whole page exists for and it currently does not appear at
  all — only "2.8 months", which nobody can put in a calendar.
  $91.40 ÷ $32.12/mo = 2.85 months ≈ 87 days from 16 Sep.
- `then $32.12/month · the plan is already PAID, so nothing switches off — the
  charges just start.` 11px, `text-fg-faint`.
- `Credits expire 30 Jun 2027` + `<Source kind="entered_by_hand">` — that date is
  an **example**; nothing is stored today, so the first render of this line will
  be the "not set" state. If unset:
  **`Expiry — not set yet · Set it`** as a live control. Never blank, never a
  date we invented.
- A 3-bar sparkline of Jul/Aug/Sep ($9.22 / $41.91 / $17.13) beside the rate, so
  "$32.12/month" is visibly a projection off a bumpy series rather than a fact.
- `▸ credits & expiry` opens **P2**.

**Column C — what we measured, for the same period.** `requests`, `AI calls`,
`DB reads / writes`, each with `<Source kind="live">` and its flush age. Plus one
sentence that pre-empts §45.1 before he ever reaches the table:
*"1,574 of those (72%) belong to no restaurant — public pages, sign-in, diner QR
menus, health checks."* `▸ who used it` scrolls-to/opens ❸.

### ❷ Where it goes — the bill as **eight lines**, not a rainbow

The finding that drives this section: **the bill is seven lines.** From
Cost Explorer, 1–15 Sep, 73 lines totalling $16.3433 —

| $ | service | usage type |
|---:|---|---|
| 6.1380 | Amazon Relational Database Service | `EUW2-InstanceUsage:db.t4g.micro` |
| 4.0178 | Amazon EC2 – Compute | `EUW2-BoxUsage:t3.micro` |
| 1.7100 | Amazon VPC | `EUW2-PublicIPv4:InUseAddress` |
| 1.5254 | Amazon ECR | `EUW2-TimedStorage-ByteHrs` |
| 1.2635 | Amazon RDS | `EUW2-RDS:GP3-Storage` |
| 0.8739 | EC2 – Other | `EUW2-EBS:VolumeUsage.gp3` |
| 0.6045 | Claude Sonnet 4.6 (Bedrock) | 4 token lines summed |
| **0.2102** | **the other 63 lines** | of which **60 lines are worth $0.0101 in total** |

Seven rows are **99.94%** of the bill. The current chart shows ten rows of a
73-row list, three of them named identically, and calls that "By service".

**Replace `Bars` on this page.** Build a local `LineRow`. Each row, 44px:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Database  ·  db.t4g.micro                                    $6.14  38%│
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░  [shared] ›   │
│ RDS · EUW2-InstanceUsage:db.t4g.micro                                  │
└────────────────────────────────────────────────────────────────────────┘
```

- **Plain English first, the AWS key second.** A new file
  `frontend/app/control-room/money/lines.ts` maps `usage_type → { label, what,
  lever }`. ~20 entries cover every line that will ever carry money. Unknown key
  → fall back to the raw `service · usage_type` **and tag it `NEW`** (see below).
- The magnitude fill is a **background** on the row, not a separate track — the
  current full-width grey track makes every line look like progress toward a
  goal that does not exist.
- **One colour per pool**, so colour means something: `shared` brand,
  `platform` slate, `direct` amber-ish via `mise-tone-*`. Never `CHART_COLORS`
  indexed by position.
- **`$` on every amount, always, two decimals.** `formatValue={usd}`.
  (`Bars` elsewhere in the app has the same default; if it is kept anywhere on a
  money figure, pass `usd` there too.)
- Row 8 is always **`The other 63 lines · $0.21 · see all 73 ›`** → **P4**.
- Row click → **P3**.

**The unclassified rule — this is §45.4's real answer.**

The thirteen mystery rows are `EUW2-APE1-AWS-In-Bytes`, `…-APN1-…`, `-APS1-`,
`-APS2-`, `-APS3-`, `-CAN1-`, `-EU-`, `-EUC1-`, `-LIM1-`, `-USE1-`, `-USE2-`,
`-USW1-`, `-USW2-AWS-In-Bytes`. Inbound data transfer from thirteen regions.
`classify()` handles `-AWS-Out-Bytes` and `DataTransfer`, and nothing matches
`-AWS-In-Bytes`. **All thirteen are $0.0000.** The page is shouting in amber
about zero dollars, thirteen times.

So:

1. **Conspicuousness is position and size, never a colour on a footnote.** An
   unnamed line takes its natural place in the ranked list, by amount. A $12
   unnamed line lands **above RDS, at the top, at full size, tagged `NEW`** —
   impossible to miss. A $0.00 unnamed line lands at the bottom, inside "the
   other 66".
2. The footer sentence is ranked by **money, not count**, and tells the truth:
   > *13 lines we cannot name · **$0.00** between them — all inbound data
   > transfer. Nothing unexplained is costing money.* `text-fg-faint`, **not
   > amber.**
3. **Escalation rule:** when unnamed lines exceed **$1.00 or 5% of the period**,
   that sentence turns `mise-tone-warn`, moves **above** the list, and names the
   largest one: *"`EUW2-NatGateway-Hours` — $4.20, new since 14 Sep, we have no
   rule for it."*
4. Clicking it opens **P4** filtered to unnamed.

A permanent amber warning is not a warning. This makes the alarm rare, and
therefore real.

### ❸ Who used it — all three restaurants, always

Built by **left-joining `useFleet()` onto the cost rows**, not by iterating
`usage_daily`. `FleetProvider` is already mounted in the Control Room layout and
already carries `admin_email`, `plan`, `user_count`, `handle`, `created_at`,
`last_active` — **§45.2 and §45.3 need no backend work at all.**

```
WHO USED IT                                    1–16 Sep     [live + estimate]
──────────────────────────────────────────────────────────────────────────────
  NIRAI                              pro      622     266    $0.64    $7.59  ›
  owner@nirai.com · 25 users
──────────────────────────────────────────────────────────────────────────────
  NIRAI Madras Kitchen               pro        0       0        —        —  ›
  <admin_email> · no requests in this period · joined 2 Sep
──────────────────────────────────────────────────────────────────────────────
  NIRAI.Reading                      pro        0       0        —        —  ›
  <admin_email> · no requests in this period · joined 2 Sep
──────────────────────────────────────────────────────────────────────────────
  NOT A RESTAURANT
  Public & signed-out traffic               1,574       0        —    $5.38  ›
  landing pages, sign-in, diner QR menus, health checks
──────────────────────────────────────────────────────────────────────────────
  Nobody's — platform                           —       —        —    $3.48
  fixed IP, Docker images, Cost Explorer, S3
──────────────────────────────────────────────────────────────────────────────
  TOTAL                                     2,196     266    $0.66   $16.45
  + $0.02 unattributed  =  $17.13, the figure at the top of this page
```

Decisions inside that table:

- **It reconciles to the hero.** `direct $0.66 + shared $12.97 + platform $3.48
  = $17.13`. "Who cost how much **and why with proofs**" is not satisfied by two
  columns that add up to nothing; proof is the table closing on the headline.
  The existing warning *"never added together"* is about not adding a **measured
  column to a modelled one within one row's meaning** — keep that as the column
  note. The **total row** is still required, and the platform row is what makes
  it legal: that $3.48 is nobody's, and saying so out loud is the point.
- **Zero-traffic restaurants show `0` for counts and `—` for money**, with the
  reason on the row: *"no requests in this period"*. `0` is measured and true.
  `$0.00` in a money column invites a magnitude comparison against $7.59 when
  the real statement is "did not participate" — the dash plus a reason says that
  and cannot be misread. The popup spells it out: *zero requests measured, so the
  model allocates zero*.
- **The anonymous row is renamed and sectioned.** `(anonymous / public traffic)`
  becomes **"Public & signed-out traffic"** under a `NOT A RESTAURANT` caption
  and above a hairline, with a one-line subtitle that is the explanation §45.1
  asked for. It is never a fourth tenant in the reading order.
  *(This is presentation only — the sentinel row still arrives from the API as
  `usage_mod.ANON`. Do not change the backend label; map it in the component.)*
- Row click → **P5** (a restaurant) or **P6** (the public row).
- The `estimate` column keeps the **dashed underline** — it survives greyscale
  and all 23 themes, which colour alone does not.
- **`data-label` on every `<td>`.** This is the phone bug: `.mise-stack` prints
  its labels from `attr(data-label)` and this page sets none, so on a phone each
  restaurant is four unlabelled numbers. Either set them, or use the card layout
  in §6 — but never ship the table without them again.

### ❹ The fold — everything that is reference, not news

One `<Fold>`, closed, `value="3 definitions · 1 formula · 2 caveats"`:

- the three unit economics figures with their definitions (fully loaded
  $7.80/1k, marginal $0.32/1k, per AI call $0.01) — reference, so it stops
  competing with the bill for space;
- the allocation formula `share = w_app·(app_ms/Σapp_ms) + w_db·(db_ms/Σdb_ms)`
  with this period's inputs;
- the Bedrock reconciliation: *AWS billed $0.68, our ledger recorded $2.31,
  ×0.30 apart, so per-restaurant AI is scaled to AWS*;
- `includes pool pre-ping and health checks; executemany counts once`;
- **collector status, which the page has never shown**: last AWS fetch and its
  age, last counter flush, and **"Cost Explorer: 7 calls this month of 150 ·
  $0.07 spent"**. This dashboard is a line on its own bill and should say so.

That fold replaces roughly 600px of today's page with a 44px row whose summary
line already answers "is there anything in there".

---

## 5. Popups — what opens on click

All `SheetPopup` (centred, stacking, `columns` sized to content, portals to
`<body>` — safe here: theme vars are set on `documentElement`, and
`mise-card-inset`/`mise-well` are not scoped under `.mise-app`).

| # | Opened from | `columns` | Contains |
|---|---|---|---|
| **P1** Every month | hero `▸ every month` | 2 | One row per month: total, invoice, credits used, and the biggest mover vs the month before (*"August was $32.69 more than July — ECR storage +$1.2, a full month of RDS +$3.1"*). Jul $9.22 · Aug $41.91 · Sep $17.13 (partial, marked). A month row → sets the page period and closes. |
| **P2** Credits & expiry | credit column | 1 | Live balance $91.40 with its read time · **a manual balance field (the §45.6 fallback)** · **the expiry date field, always hand-entered** · who last edited and when · the runway arithmetic written out: `$91.40 ÷ $32.12/mo = 2.8 months → ~12 Dec 2026`. **Live always wins**; a hand-entered balance shows as `fallback (unused — AWS answered 12 min ago)`. It is never silently preferred, and the two never merge into one unlabelled number. |
| **P3** One line | a row in ❷ | 2 | What it is in one sentence, its daily shape over the period (`Bars`, `formatValue={usd}`), month-over-month for that line, and **the lever**: *"Nothing is attached to this IP while the box is stopped. Releasing it saves $3.60/month."* |
| **P4** All 73 lines | "see all 73" / the unnamed footer | 3 | Every line, grouped by pool with pool subtotals, sorted by amount, `service · usage_type · $` — filter chips `all / shared / platform / direct / unnamed`. A row → P3 at depth 2. |
| **P5** One restaurant | a restaurant row | 2 | Identity: name, `admin_email`, handle, plan, users, joined, last active. Usage: requests, DB reads/writes, errors, **top 10 endpoints with call counts** — this is "what requests they made". AI: calls, tokens, failures, avg latency, cost. Money: AI (measured) and share-of-box (modelled) with **this hotel's numbers substituted into the formula**. |
| **P6** Public & signed-out traffic | the public row | 2 | The §45.1 explanation, then **the proof**: the actual endpoint list from `usage_daily` (it stores `method` + templated `endpoint` per hotel per day) — `GET /api/health`, `GET /t/{code}`, `POST /api/auth/login`, `GET /s/{handle}` with counts. A paragraph explains; a list of the real endpoints convinces. |

No `DetailSheet` here: these are reference panels, not row-editors with a pinned
headline metric, and `SheetPopup` is the house popup he has approved twice.

---

## 6. Mobile — 390px

Today: **2,509px, 2.97 screens**, a bar chart whose bars are ~60px stubs, and a
restaurant table that renders four unlabelled numbers per card.

Target: the **answer** in the first 400px, and roughly 1.6 screens total.

```
390px
├ month strip — horizontally scrollable, snap, 4 chips  (a control may scroll;
│                                                        content may not)      44
├ USAGE · 1–16 SEP              [AWS · 5h]                                     16
├ $17.13                                        text-5xl                       48
├ Invoiced $0.00 — credits paid all of it                                      20
├ ── hairline ──
├ $91.40 credit · runs out ~12 Dec · then $32.12/mo            mise-well       64
├ 2,196 req · 266 AI · 3,369 reads          3-up grid, mise-well               56
└ ▸ credits & expiry                                                           32
                                                              ≈ 280px, all above the fold
WHERE IT GOES        top 5 rows only + "the other 68 lines · $0.21 ›"
  row = 2 lines: name + $ on line 1, pool chip + fill bar on line 2.
  NO w-28 label column. The bar is full row width behind the text.
WHO USED IT          cards, not a table — never `overflow-x-auto`
  ┌──────────────────────────────────┐
  │ NIRAI                    pro   › │
  │ owner@nirai.com                  │
  │ 622 req · 266 AI · $0.64 · $7.59 │  ← every number carries its word
  └──────────────────────────────────┘
HOW THESE NUMBERS ARE MADE ›   (fold, closed)
```

- Popups are already 94vw and centred on a phone; all six work unchanged.
- Every tap target ≥44px (`Fold` already enforces `min-h-[44px]`).
- `npm run responsive` must pass 360/390/768/1024/1440/1920 with no sideways
  scroll. The current page passes it and is still wrong — that sweep finds
  overflow, not meaning.

---

## 7. Provenance — the rules that must not slip

| Figure | Chip |
|---|---|
| Hero $17.13, invoice $0.00, every bill line | `billed` + age. Past 26h it turns amber by itself. |
| Credit balance $91.40 | `live` |
| Credit **expiry** | `entered_by_hand` — **always**, even when the balance beside it is live. Two provenances on one card, each labelled. |
| Runway "~12 Dec 2026" | `estimate` — it is a division, not a reading |
| requests / DB / AI calls | `live` + flush age |
| Share of the box | `estimate` + dashed underline |
| AI cost per restaurant | see the bug below |

**A latent bug to fix while rebuilding.** `costs.MEASURED = "measured"`, and it
is what `/costs/hotels` puts in `ai_usd.kind`. `SourceKind` is `"live" | "billed"
| "estimate" | "entered_by_hand"` — `Source.tsx` falls through its ternary chain
and would render `"measured"` as **"entered by hand"**, with slate tone. It is
invisible today only because the page never renders that chip. The moment the
rebuild adds one, a measured figure claims to be hand-typed. Map it in the
component (`measured → live`), or align the backend constant — but do not let
`<Source kind={r.ai_usd.kind}>` reach the DOM unmapped.

---

## 8. What the API has to add

Nothing in ❶–❹ needs new AWS calls. Everything is either already in the payload,
already in `useFleet()`, or in our own Postgres.

1. `/costs/summary` and `/costs/hotels` take **`?from=&to=`** instead of
   `?days=`, and both halves (billed + measured) use it. Keep `days` accepted so
   nothing else breaks.
2. `/costs/summary` returns `months: [{month:"2026-07", gross, credits, net,
   available}]` — one `GROUP BY date_trunc('month')` over `cloud_cost_daily`,
   which already holds July and August (`BACKFILL_MONTHS = 2`). **This is the
   whole of §45.7 — the data is already stored.**
3. `/costs/summary` returns `measured.first_day` so July can say "not measured"
   instead of "0".
4. `/costs/summary` returns the `spend_guard()` state (`cooldown_until`,
   `calls_this_month`, `ceiling`, `api_cost_usd`) so the refresh button can say
   *"next free read in 3h 12m"* **while staying pressable**. A control that is
   disabled on arrival reads as broken; the polite 200 refusal already exists.
5. `unclassified[]` must carry `usage_type` — it already does in `costs.billed()`;
   it is the **page** that drops it. No backend change, just stop discarding it.
6. New, free, our own DB: `GET /platform/costs/line?service=&usage_type=&from=&to=`
   → daily points for P3.
7. New, free, our own DB: `GET /platform/costs/hotel/{hotel_id}/endpoints?from=&to=`
   → top templated endpoints with counts, for P5 and P6. Works for `ANON` too,
   which is what makes P6 evidence instead of prose.
8. New: `PATCH /platform/costs/credits {balance_usd?, expiry_on?, note?}` →
   writes `PlatformConfig.aws_credits`. The router already merges that dict into
   the response. §45.6.

§45.8 (fetch-on-demand, roll closed months down to monthly) is an architecture
change behind all of this and does not block any of it — every figure above is
served from the cache that already exists.

---

## 9. Ordered list of changes

Front-end only until step 7; the page gets visibly better at every step.

1. **`lines.ts`** — `usage_type → { label, what, lever }` for the ~20 lines that
   ever carry money, plus the pool colours. Everything else keys off it.
2. **Kill `Bars` on this page**; build `LineRow` (name + key + `$` + pool chip +
   background magnitude fill). Seven real rows + "the other 66". Fixes the
   missing `$`, the three identical `Amazon Relational ...` labels, the rainbow,
   and the phone stubs, in one component.
3. **The unclassified rule** — rank by money; `NEW` tag in position; grey
   footer sentence with the true total ($0.00); amber only past $1.00 or 5%.
4. **`PeriodTabs`** — month chips with totals, `All 3 months $68.26`, wired to
   `{from,to}` for the whole page. Hero moves. (Needs API step 1+2; until then
   drive it off `by_service` for the current month and ship the strip.)
5. **Rebuild the band** — three populated columns, hero + invoice line, the
   credit column with the **date** and the depletion meter, the measured column
   with the public-traffic sentence. Deletes the 45% dead space.
6. **The restaurant table from `useFleet()`** — all three, always; email under
   the name; renamed and sectioned public row; `—` + reason for zero traffic;
   total row that reconciles to the hero; `data-label` on every `<td>`; card
   layout under `sm`.
7. **The fold** — unit economics, formula, reconciliation, caveats, collector
   status and the dashboard's own Cost Explorer spend.
8. **P1 / P2** (every month; credits & expiry, with the manual fields).
   P2 needs API step 8.
9. **P5 / P6** (restaurant; public traffic with its endpoint list).
   Needs API step 7.
10. **P3 / P4** (one line; all 73 lines). Needs API step 6.
11. **The loud-usage strip** — `is_loud()` finally called, above the hero.
12. **`measured.first_day` guard** — July shows "not measured", never `0`.
13. **Refresh button** shows its cooldown and stays pressable. Needs API step 4.
14. `npm run lint` — not just `tsc` and `build`. This page will gain hooks and
    early-declared helpers, which is exactly what passes the other two.
15. Deploy, then screenshot at **390, 1280 and 1920** and read the pictures. The
    assertion that matters is not "the selector resolved" — it is that the month
    strip changed the hero, that three restaurants are on screen, and that the
    phone page is under two screens.

### Done means

- 1280×800: one screen, no page scroll.
- 390×844: ≤1.6 screens, the amount and the runway date both above the fold.
- Every restaurant that exists is on screen. The public row explains itself
  without being clicked.
- No `$0.00` anywhere the truth is "we do not know", and no bare number without
  its `$`.
- Pressing a month chip changes the big number.
