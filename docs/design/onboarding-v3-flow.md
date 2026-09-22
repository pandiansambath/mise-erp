# Onboarding v3 — flow, states, copy, errors

> "why everythign is splitted ...clumsy...worst worst UI UX...inboading is not
>  like what im expeceted... like litrelly it need to collect all the needed
>  datas section by seciotn...first start with vendor and what each vedor
>  suplies(show preview)...then inventory items and match inventory items with
>  the name in vendor (show preview like this matched to this ectetc...if user
>  needed means it can chnage onspot...also he can chat with our AI also onspot
>  to do the chnages and reshow the prview based on commands from the user)
>  .......after inventory ask for employees ...menu...recipe... everything via
>  typing or via any files which our ai will look and scrp the datas from it and
>  show preview to user"
>
> "please create a sepeerate seciotn named ONBOADNG...here unitl owner finish
>  the onboading and close or skip and close..this section need to be showon in
>  dahsboard as a new section/page"

**This document is the interaction design and information architecture only** —
flow, screen states, copy, error handling, and the API contract each screen
needs. Visual design (type scale, colour, motion, the look of a tile) is the
other designer's document; where the two meet I name the region and its
behaviour and stop.

Written against the live page and the code, not against a description of
either.

---

## 0. Evidence this is built on

| What | How |
|---|---|
| Live `/setup`, desktop 1280×800, signed in as `superadmin@gmail.com` | screenshot read: `scratchpad/zz-setup-desktop.png`. Document height 800 — no scroll. Content ends at y≈600; **200px of empty page below it.** Four tiles, each carrying one number. |
| Live `/setup`, phone 390×844 | `scratchpad/zz-setup-mobile.png`. Document height **1342px against an 844px viewport — 1.6 screens for four tiles and a drop box.** The floating bottom nav covers the "Menu" tile's title; the voice bubble sits on the "Suppliers" tile. |
| The page being replaced | `frontend/app/(app)/setup/page.tsx` |
| The preview screen to be extended, not forked | `frontend/components/ImportPlan.tsx` |
| The four list specs and their exact field names | `backend/app/core/lists.py` |
| Verdicts, differences, the duplicate key | `backend/app/core/list_io.py` |
| Header matching — the mechanism of his bug | `backend/app/core/template_io.py`, `_match_header` / `parse_upload` |
| Supplier resolution on a stock import | `backend/app/inventory/router.py`, `_find_vendor` (exact case-folded match, no fuzzy) |
| The AI fallback that returns a plan | `backend/app/assistant/router.py`, `/read-any` |
| The bulk AI list tool | `backend/app/assistant/tools.py`, `propose_list` |
| Today's step model | `backend/app/hotels/onboarding.py` (six steps, counted from rows) |

**Cleanup:** one throwaway Playwright spec was created at
`frontend/e2e/zz-temp-design-setup.spec.ts`, run twice against production
(sign-in + two page loads, read-only), and **deleted**. Nothing was created,
edited or deleted on the live tenant. No file was uploaded to any AI endpoint.

---

## 1. The bug this design exists to make impossible

His CSV: `Item Name,Category,Unit,Quantity,Unit Cost,Supplier`.

Traced through the code, here is exactly what happened and why:

1. `setup/page.tsx` loops the four lists in order and takes the first that
   returns rows (`for (const st of BLANK) … if (p.rows?.length)`).
2. **Inventory first.** `_match_header` matches `Category`→category,
   `Unit`→unit, `Quantity`→current_stock, `Supplier`→supplier. It does **not**
   match `Item Name` — `ITEMS.name` accepts `item`, `product`, `ingredient`,
   and the exporter's own header, but not `item name`. A required column is
   unmatched, so `parse_upload` returns **zero rows** and one error string.
   Zero rows, so the loop moves on.
3. **Vendors next.** `VENDORS.name` lists `supplier` as an alias, and it is
   the only required field. `Category` matches too. The file parses. Five
   rows, five "suppliers", category "Grains".
4. The plan had rows, so it rendered. He confirmed it. His stock list became
   his supplier list.
5. Re-uploading hit `_key()` — first required field, case-folded — and every
   row came back `duplicate`, i.e. "already added".

Three separate design faults, and only the third is about wording:

- **The product guessed, and guessing was unnecessary.** A section-by-section
  flow always knows which list it is looking at.
- **A parse failure was treated as a routing signal** rather than as something
  to tell him about. The one error string that would have explained everything
  — *Missing required column: "Name"* — was caught and discarded.
- **A near miss had no repair.** "Item Name" is obviously the name. There was
  no screen on which to say so.

### The three rules that follow, and everything below obeys them

> **R1. The section is known, so the file is parsed as that list and no other.**
> There is no fallback to another list, ever. Not even a clever one.
>
> **R2. When it doesn't fit, say what was expected and what was found, per
> column, and offer to map.** Never a dead end, never a silent success.
>
> **R3. Nothing is written until he has seen the rows that will be written.**
> This already holds for files and for the chat; it must hold for the AI edit
> path too.

---

## 2. Where it lives

| | |
|---|---|
| **Route** | `/onboarding`, inside `(app)` — it inherits the theme, the sidebar, `mise-card-inset`, `SheetPopup`. The previous standalone `/onboarding` was deleted for painting itself `#0b1220` on a 23-theme product; do not bring that back. |
| **`/setup`** | Kept as a permanent redirect to `/onboarding`. Three places link to it — `lib/auth.tsx` (sign-in and signup), the dashboard banner, `verify-email`. Redirect first, then update the three call sites. Do not delete the route in the same change. |
| **Sidebar** | A new entry in **OVERVIEW**, above Dashboard: `Onboarding` with a `2/5` pill. It is present while `!complete && !dismissed`. Once dismissed or complete it moves to the bottom of **OVERVIEW** as plain `Onboarding` with no pill, and never disappears — a restaurant that adds a second kitchen needs it back. |
| **Dashboard** | One card, at the top, full content width, `mise-card-inset`. It replaces BOTH of today's devices: the `Onboarding` tour card (`components/Onboarding.tsx`) and the separate conditional banner at `dashboard/page.tsx:294` keyed on `localStorage["mise.setup.done"]`. Two things saying the same thing is how one of them ends up stale. |
| **Sign-in** | Keep `needs_setup` → `/onboarding`. It is cheap and short-circuiting. Unchanged. |

### The dashboard card, exactly

Not complete, not dismissed:

> **Setting up NIRAI** — 2 of 5 done
> `● ● ○ ○ ○`
> Next: **your team**. Rota, attendance and payroll wait on this.
> [ Continue setting up ] [ Not now ]

- `Continue setting up` → `/onboarding` at the stored current step.
- `Not now` hides the card **for 7 days**, server-side, not localStorage.
  Permanent dismissal is a decision with a consequence, and it belongs on the
  onboarding page where the consequence can be explained.
- Complete or dismissed → the card does not render at all. No "well done"
  tombstone.

**localStorage is not the store for any of this.** Precedent in the codebase:
the 12-hour clock preference was moved out of localStorage to `hotels.prefs`
because "both are same superadmin but 1 is from incognito". Onboarding progress
has the same problem in a stronger form — he starts on the laptop and continues
on the phone.

---

## 3. The shell

### 3.1 Regions

Full content width at every size. No rail, no centred 576px column — the
measured fault on the old page was 854px of empty green either side of the
content, and the current page still ends 200px above the fold with nothing
under it.

```
┌─ PageHeader ────────────────────────────────────────────────────────────┐
│ Onboarding                                    [ Save & close ]  [ ⋯ ]   │
│ Bring NIRAI's suppliers, stock, team and menu in — one section at a     │
│ time. Nothing is saved until you have seen it.                          │
├─ STEP BAR (full width) ─────────────────────────────────────────────────┤
│ [1 Suppliers ✓] [2 Stock ▸] [3 Team] [4 Menu] [5 Recipes]               │
├─ STAGE (fills the rest of the height) ──────────────────────────────────┤
│  SOURCE STRIP    [ 📄 From a file ] [ ⌨ Type or paste ] [ ✨ Ask AI ]   │
│                                                                         │
│  …idle | reading | mapping | preview | saving | result                  │
│                                                                         │
├─ ACTION BAR (pinned to the bottom of the stage) ────────────────────────┤
│  ✨ Tell me what to change…                    [ Add 63 · leave 4 ]     │
└─────────────────────────────────────────────────────────────────────────┘
```

The stage owns the vertical space. **Content drives its height** — an idle step
with nothing in it is a short card and the page simply ends; it is not padded
out to look busy. A step with a 200-row preview scrolls *inside the stage*,
with the action bar pinned, so the primary button is never below the fold.

⚠️ `flex-1` against a `display:block` parent is inert — it has cost this repo
three attempts at one bug. The stage's height binding must be verified with a
measurement, not assumed.

### 3.2 Step state — the model

Five steps, his order, no renumbering:

| # | key | Title | Table | done when |
|---|---|---|---|---|
| 1 | `vendors` | Suppliers | `vendors` | count > 0 |
| 2 | `items` | Stock | `items` | count > 0 |
| 3 | `employees` | Team | `employees` | count > 0 |
| 4 | `menu` | Menu | `recipes` | count > 0 |
| 5 | `recipes` | Recipes | `recipe_ingredients` | ≥1 dish has ≥1 line |

Each step is in exactly one state:

| State | Meaning | How it reads | Clickable? |
|---|---|---|---|
| `done` | The table has rows. **Counted, never stored** — a flag can be wrong; rows cannot. | `Suppliers · 6` with a tick. Not celebrated; it is just true. | Yes |
| `current` | The one open. Exactly one at a time. | Marked as current; its number is the one in the header `Step 2 of 5`. | — |
| `todo` | Empty, not skipped, not current. | `Stock · none yet` plus its one-line cost: *"Recipes can't be costed until this has something in it."* | Yes |
| `draft` | Empty, but an unreviewed draft is saved. | `Stock · 63 waiting` — **the most important state on the bar**, because it is work already done that he could otherwise lose. | Yes |
| `skipped` | He pressed Skip. Stored. | `Team · skipped` in muted text, with an `undo`-ish affordance: clicking it just opens the step, which un-skips on the first row added. | Yes |
| `blocked` | Prerequisites missing. **Only step 5.** | `Recipes · needs dishes first`. | **Yes — always.** |

**Nothing in this flow is ever a disabled control.** A disabled tile on arrival
reads as broken. `blocked` is clickable and its stage explains itself:

> **Recipes need two things first**
> A recipe line is *this much of that ingredient* — so it needs a dish to
> belong to and an ingredient to point at.
> You have **17 dishes** and **no stock items**.
> [ Go to step 2 · Stock ] [ Skip recipes for now ]

### 3.3 Moving between steps

- **Any step, any time, in any order.** Steps are sections, not gates. The
  order is a recommendation the screen makes, not a constraint it enforces —
  that is the whole difference between "a room you can leave and come back to"
  and a wizard.
- Leaving a step with an unsaved draft **never loses it**: the draft is written
  server-side on every change (debounced 1.5s) and on step change. No "are you
  sure" dialog — that is an admission that the product forgets things.
- After a successful commit the stage shows its result and the step bar
  advances the *suggestion*, not the view. He stays where he is:
  > **6 suppliers added.** [ Next: Stock → ] [ Add more suppliers ]
  A step that yanks him forward the instant he finishes is how people lose
  track of what they just did.

### 3.4 The two exits — both of them, explicitly

He asked for "finish and close **or** skip and close". These are different
things and must not share a button.

**`Save & close`** — in the header, always, from the first second.
→ `/dashboard`. Progress and drafts kept. Sidebar pill and dashboard card stay.
Toast: `Saved. Pick it up from Onboarding whenever you like.`

**`I'm done with this`** — in the header overflow `⋯`, and also as a full-width
option at the bottom of the last step. Opens a `SheetPopup`:

> **Hide onboarding?**
> You have finished 3 of 5. Suppliers, Stock and Team are in; Menu and Recipes
> are still empty.
> This removes the card from your dashboard. The section stays in the menu, and
> nothing you have added is affected.
> [ Yes, hide it ] [ Not yet ]

**`Finish`** — when all five are `done` or `skipped`, the action bar's primary
becomes:

> **All five done.** [ Finish setting up → ]

which sets `dismissed`, and lands on `/dashboard` with:
`NIRAI is set up — 6 suppliers, 71 items, 9 people, 17 dishes, 12 costed recipes.`
A sentence with the numbers in it, because "Done" is what a setup that lost
half the file also says.

**Per-step skip** lives in the stage, not the header:
`Skip this step` → confirm inline, one line, no popup:
`Skipped. You can come back any time.` and the bar moves to the next step.

---

## 4. A step's stage — the six modes

Every step is the same machine. Learn it once, it works five times.

```
idle ──file──▸ reading ──ok────────▸ preview ──commit──▸ saving ──▸ result
  │                 └──mismatch──▸ mapping ──▸ preview       │
  ├──type──▸ grid ────────────────▸ preview                  └─partial─▸ result
  └──ai───▸ thinking ─────────────▸ preview
                                      ▲
                                   AI edits (never leaves preview)
```

### 4.1 `idle`

Two blocks, and never an empty screen.

**The source strip.** Three tiles, equal width, one row, always visible —
**not** a file dropzone with typing hidden in a link. He said "everything via
typing or via any files". Equal citizens means equal pixels.

| Tile | Label | Sub-label | On click |
|---|---|---|---|
| 📄 | **From a file** | Excel, CSV, PDF, or a photo of a list | Opens the file dialog. **No `accept` narrower than what the server reads** — restricting it is what stopped him choosing his own spreadsheet once already. |
| ⌨ | **Type or paste** | Paste straight from a spreadsheet | Stage → grid |
| ✨ | **Ask AI** | Describe your suppliers and I'll write the list | Focus the AI bar, with a step-specific placeholder |

Drag-and-drop still works anywhere on the stage, and the stage ring highlights
with `Drop it — I'll read it as suppliers.` Note the copy: it names the list.
On this page the AI does not identify the document; the section already did.

**Below it, what is here now.** Never an empty region:

- Nothing yet → the reason it matters plus the fastest route:
  > **No suppliers yet.**
  > An item nobody prices cannot be ordered or costed, and price comparison has
  > nothing to compare.
  > Most restaurants start by exporting from whatever they use now and dropping
  > it here. [ Download a blank template ] [ See an example ]
- Some rows → a live, full-width preview of what he already has (first 12,
  `+59 more`), so the step proves it worked without him navigating away.
  Header line: `6 suppliers · added by you, today`.

### 4.2 `reading`

- File name echoed: `Reading **suppliers-2024.xlsx**…`
- Under 400ms: no spinner at all (a flash of spinner reads as jank).
- Over 3s, the line changes: `Still reading — large files can take a few
  seconds.`
- Over 12s on the AI path: `The AI is working through it. This is the slow part
  — 63 rows usually takes about 20 seconds.` Never a bare spinner past 10
  seconds; an unexplained wait is where people reload and double-submit.
- `Cancel` is present throughout and actually aborts the request.

### 4.3 `mapping` — the fix for his bug

**When it opens automatically:** a required field of THIS list is unmatched.
That is the only automatic trigger.

**When it does not:** everything required matched. Going straight to the
preview is correct; the mapper is repair, not ceremony. But any unused column
is reported on the preview (§4.4) with a link back here, so nothing is ever
dropped silently.

**One row per column in HIS file** — not per field in our spec. He is reading
his own spreadsheet; it must be laid out the way he wrote it.

> ## Which column is which?
> Your file's headings don't match ours. Tell me once — I'll remember this
> layout next time.
>
> | Your column | The first rows say | Use it as |
> |---|---|---|
> | **Item Name** | Basmati Rice · Paneer · Chicken thigh | `Name (required)` ▾ · *guessed* |
> | **Category** | Dry Goods · Dairy · Meat | `Category` ▾ |
> | **Unit** | kg · kg · kg | `Unit (required)` ▾ |
> | **Quantity** | 25 · 10 · 8 | `Opening stock` ▾ |
> | **Unit Cost** | 1.80 · 5.40 · 4.10 | `Don't use this column` ▾ |
> | **Supplier** | Local Supplier · — · Fresh Foods | `Supplier` ▾ |
>
> [ Preview 63 rows ]  ·  [ Choose a different file ]

Specifics that are not negotiable:

- **His real first data values under every column**, up to three, truncated at
  24 characters, joined with `·`. This is what makes the screen self-evident:
  he is matching *Basmati Rice* to *Name*, not matching two abstract words.
- **Guesses arrive pre-filled** using the same alias table the importer uses
  (`ListSpec.fields[].aliases`), plus normalised containment — `item name`
  contains `name`. A guess that was not an exact/alias hit is chipped
  *guessed*, so he knows which two to check rather than all six.
- **`Unit Cost` maps to nothing, and we say why**, right there under the
  picker: *"Prices come from the supplier's price list, not the stock sheet —
  so a price here would be a second source of truth for the one number this
  product exists to get right."* This is the money law, stated where somebody
  hits it.
- **The primary button is never disabled.** If a required field is still
  unmapped, the button reads `Name is still missing` and pressing it moves
  focus to that row and flashes it with:
  `Pick the column that holds the supplier's name — I can't tell rows apart
  without it.`
- **Layout, not a modal.** The mapper is the stage, full width. Six columns is
  six rows of 64px; it fits without scrolling at 1280 and at 390 (stacked
  cards, §8).
- **Remembering.** On `Preview`, store `{hotel, list, signature → mapping}`
  where signature is a hash of the lower-cased header row. Next time the same
  shape arrives, skip the mapper and put one line on the preview:
  `Read using the layout you set on 14 Sep. Change columns` .

**When the mapper opens, it is because of an error, so the error is above it**
— never a mapper with no explanation of why it appeared:

> **This doesn't look like a stock list yet.**
> I need a column with the item's **name**, and I couldn't find one. Your file
> has: Item Name, Category, Unit, Quantity, Unit Cost, Supplier.

And the one line that closes his bug for good — shown only when the file's
columns *do* satisfy another list's required fields:

> Or is this a **suppliers** list? Its columns would fit. [ Take me to step 1 ]

The system may have an opinion. It may not act on it. One click, his.

### 4.4 `preview`

Extend `ImportPlan`, do not fork it. It already does the hard parts: rows
grouped new / already-here-and-different / already-here-and-same / unreadable;
`Keep ours` vs `Use the file` per duplicate, defaulting to **Keep ours**; each
difference carrying label + ours + theirs; the button that spells out
`Add 41 · update 3 · leave 19`.

What v3 adds:

1. **A source line at the top.** `From suppliers-2024.xlsx · 63 rows · read
   with your saved layout` / `· read by AI` / `· typed here`. When something
   goes wrong two screens later, this is the line that says where it came from.
2. **Unused columns, named.** `2 columns weren't used: Unit Cost, Notes.
   Change columns` — links back to `mapping`. Never silent.
3. **The match column** (step 2 and step 5 — §5, §6).
4. **Editable cells.** Tap any cell → a popup for that field, prefilled,
   with `Save` and `Save and apply to all 12 rows that say "Local Market"`.
   Edited cells carry a small `edited` mark and the footer counts
   `4 changed by you`. **This is the "change onspot" he asked for, and it must
   not require the AI** — the AI is the fast path, not the only path.
5. **The AI bar**, pinned (§7).
6. **Row count sanity.** `63 rows read · 63 shown`. If the two ever differ,
   say so loudly: `I read 63 rows and can only show 41 — don't add these; tell
   me and I'll look.` A preview that disagrees with its own input has already
   failed.

Empty-ish outcomes get sentences, not blank panels:

| Outcome | Copy |
|---|---|
| Nothing new, nothing different | **All 63 are already here, unchanged.** Nothing to add. [ Show them ] [ Choose a different file ] |
| All new | **63 new — you have none yet, so all of them are new.** (already in `summarise()`; keep) |
| Some unreadable | **4 rows I couldn't read** — listed by row number and reason, never counted: `Row 12 — no name — add it and this row goes in with the rest`. Plus [ Fix them here ] which opens those four rows in the grid editor. |
| Zero rows in the file | **That file had headings but no rows under them.** [ Choose a different file ] |

### 4.5 `saving` / `result`

The button becomes `Adding 63…`, disabled while in flight (a control disabled
*after* a deliberate action is honest; disabled on arrival is not).

Result is a sentence with numbers, from the commit response's own counts:

> **6 suppliers added, 2 updated, 19 left as they were.**

**Partial success is a first-class state, not an error.** The commit returns
`failed` with reasons and, for inventory, `notes`:

> **59 added. 4 could not be saved.**
> · Basmati Rice — no supplier called "Sunrise Foods"
> · (3 more)
> [ Fix these 4 ] [ Carry on to Stock → ]

`Fix these 4` re-opens the preview containing only those rows. The 59 stay
added. A failure that makes him re-upload the whole file is a worse failure
than the one that caused it.

---

## 5. Step by step

### Step 1 — Suppliers

- **List:** `vendors`. Endpoints exist: `/vendors/import/preview|commit`.
- **Why line:** *"Start here — everything else points back at a supplier. An
  item nobody prices can't be ordered or costed."*
- **Required:** Name only. Everything else optional, deliberately: *"a supplier
  with nothing but a name is a real thing a restaurant has."*

**"and what each vendor supplies" — his explicit ask.** There is no `supplies`
field on `Vendor`, and there must not be one: what a vendor supplies is
`vendor_items`, which is (vendor × item × form) and cannot exist before step 2.
So:

- The mapper offers a **virtual target**: `Supplies — used to match stock in
  step 2` (a free-text, comma-separated column). It is not written to the
  vendor row and it does not enter the export spec.
- The preview shows it as a second line of chips under each supplier:
  > **Fresh Farms** · Produce · +44 7700 900123
  > supplies: `tomato` `onion` `coriander` `paneer` `+8`
- It is stored in the onboarding draft as
  `vendor_supplies: {"Fresh Farms": ["tomato", …]}` and survives the commit.
- **Step 2 then opens pre-filled with it**, which is the section-feeds-the-next
  behaviour he described:
  > **Your suppliers listed 41 things between them.** Bring them in as stock
  > items? [ Show me the 41 ] [ No, I'll use my own list ]
  Those 41 arrive in the preview as rows with `name` and `supplier` filled and
  `unit` blank — so the first thing he does in step 2 is set units, which is
  exactly the work only he can do.
- If no `Supplies` column was present, none of this renders. No empty panel.

### Step 2 — Stock, and the match

- **List:** `inventory`. Required: Name **and** Unit.
- **Why line:** *"This is what recipes cost against. Match each item to the
  supplier who sells it and the money side of the product switches on."*
- **Price is not importable here, and the mapper says so** (§4.3).

**The match preview — the centre of this whole design.** One extra column on
every row:

| Item | → Supplier |
|---|---|
| Basmati Rice | **Local Supplier** ✓ matched |
| Chicken thigh | **Fresh Foods** ✓ matched |
| Paneer | *Local Market* → **Local Supplier**? `Yes` `Pick another` |
| Coriander | **Sunrise Foods** — not one of your suppliers. `Pick one` `Add as new supplier` |
| Salt | — no supplier. `Pick one` |

Four states, each with its own move:

| State | Rule | What the row offers |
|---|---|---|
| `matched` | Exact, case-folded, star-stripped — the same rule `_find_vendor` uses at commit time, so the preview cannot promise what the write will not do. | Nothing. Tapping the cell still opens the picker. |
| `suggested` | Fuzzy hit ≥0.82 against one existing vendor name (and no second hit within 0.05). | `Yes` accepts it. `Pick another` opens the picker. **Unconfirmed suggestions are never auto-applied** — they commit as the original text, which would land in `notes`. So the summary counts them: `3 suppliers need a look`. |
| `unknown` | No hit. | `Pick one` (picker) · `Add as a new supplier` · `Leave blank` |
| `blank` | No supplier column, or empty cell. | `Pick one`. Not an error, not a warning. Plenty of items have no supplier yet. |

**Changing one, exactly:** tapping the supplier cell opens a `SheetPopup`,
depth 2 over the preview:

> **Supplier for "Paneer"**
> [search field, autofocused on desktop, not on mobile]
> ● Fresh Farms · Produce
> ○ Local Supplier · Dry Goods
> ○ Metro Cash & Carry
> ─────
> ☐ Apply to all **12** rows that say "Local Market"
> [ Add "Local Market" as a new supplier ]  [ Leave blank ]
> [ Save ]

Closing the popup returns to the preview with the cell updated and marked
`edited`. If `Apply to all` was ticked, a banner sits above the table:
`12 rows changed: Local Market → Local Supplier. Undo`.

**New suppliers are never created silently.** The backend deliberately refuses
to invent a vendor during a stock import — *"creating a supplier as a side
effect of a stock import is how a vendor list fills with typos nobody chose"*
— and that stays true. Instead, anything he marked `Add as a new supplier`
collects above the commit button:

> Also adding **2 new suppliers**: Sunrise Foods, Coriander Co. [ Show ]

and the commit becomes two ordered calls: `/vendors/import/commit` for the new
suppliers **first**, then `/inventory/import/commit`. If the vendor call fails,
the item call does not run, and the message is
`Couldn't add the 2 new suppliers, so I haven't added the stock either —
nothing changed.` Half a chain is worse than none.

**When step 1 was skipped** and there are no vendors at all, the match column
does not render as a column of failures — an empty column reads as a broken
component. It renders as one line above the table:
`You have no suppliers yet, so nothing can be matched. Add them in step 1 and
I'll match this list to them. [ Go to step 1 ] [ Carry on without suppliers ]`

### Step 3 — Team

- **List:** `employees`. Required: Name.
- **Why line:** *"Rota, attendance and payroll all wait on this — but nothing
  above or below it does."*

**I disagree with this position and am complying anyway.** Steps 1, 2, 4 and 5
are one continuous thread — a supplier prices an item, an item costs a dish, a
dish has lines. Team is an island, and putting it third breaks the story right
where the chain gets interesting. His order is settled, so the mitigation is
copy, not sequence: Team is the step whose header explicitly says *"you can
leave this for later"*, and it is the one where `Skip this step` sits next to
the primary button rather than in the overflow.

- **Pay is not here, and the screen says so** rather than letting him look for
  it: `Pay isn't set here — this step is names and roles. Add salaries on the
  Team page, where they are permission-controlled.` (`EMPLOYEES` excludes pay
  on purpose; `EMPLOYEES_WITH_PAY` is a separate, separately-permissioned
  thing and must not be reachable from onboarding.)
- **Permission:** a manager without `employees:write` sees the step
  immediately as `This one is the owner's — ask them to add the team.` and the
  source strip does not render. Checked on arrival, never after he has typed
  40 rows.

### Step 4 — Menu

- **List:** `recipes` — ⚠️ **the `RECIPES` ListSpec is the MENU**: Dish,
  Category, Serves, Price, On the menu. One row per dish, **no ingredient
  lines**. A developer reading "Menu" and "Recipes" as two tables will look for
  an endpoint that does not exist. They are one table; step 4 writes the rows,
  step 5 writes their lines.
- **Why line:** *"What you sell and what you charge. Costs come in the next
  step."*
- `calculated_cost` is exported and **not** importable. If a file has a cost
  column, the mapper offers `Don't use this column` with:
  *"We work this out from the recipe and today's supplier prices — a number
  from a spreadsheet would go stale the day a price changes."*
- Warning, not invalid: `12 dishes have no price. They'll go in; add prices on
  the Menu page whenever you like.`

### Step 5 — Recipes

**This is the step that needs new backend, and it is the step that proves the
product.** There is no list importer for ingredient lines today — only the
assistant's `propose_recipe_ingredients`, one dish at a time.

- **Shape:** four columns. `Dish` · `Ingredient` · `Quantity` · `Unit`. One row
  per line, repeated dish names grouping into one recipe. This is the format
  every restaurant's own spreadsheet already uses.
- **Needs:** a `RECIPE_LINES` ListSpec plus `/recipes/lines/import/preview` and
  `/import/commit`, on the same `classify` machinery. Do not invent a second
  preview contract.
- **Two matches per row**, both using the step-2 match UI:
  `Dish → an existing dish` (must exist; unmatched = invalid row, with `Add
  "Lamb Curry" as a new dish` offered) and `Ingredient → a stock item`.
- **Preview groups by dish**, because that is the unit he thinks in:

  > **Paneer Butter Masala** — 6 ingredients · **£2.41 a portion** · sells at
  > £12.50 · **81% margin**
  > 180g Paneer → Paneer ✓ · 40ml Cream → Double cream ✓ · 2 pcs Tomato →
  > Tomato ✓ …

- **The cost appears in the preview, before committing.** This is the one
  moment in onboarding where the product shows what it is for, and it should
  not wait for a save. When some ingredient has no price:
  `2 ingredients have no price yet, so this is a partial cost. It will fill in
  when you price them.` — a number without its caveat is worse than no number.
- **If step 5 ships after the rest,** its stage says exactly that, rather than
  being hidden: `Recipes are next — you'll be able to bring ingredient lists in
  here shortly. Meanwhile you can build them dish by dish on the Recipes page.
  [ Open Recipes ]` A named "coming soon" is honest; a missing fifth step in a
  bar that says "of 5" is not.

---

## 6. The AI, on the spot

### 6.1 Where it lives

**Pinned to the bottom of the stage**, full width, visible whenever there is a
preview on screen — and also in `idle`, where it is the third source tile's
destination. Not a floating bubble (the existing voice bubble already floats,
and on the current page it sits on top of a tile). Not a side panel — that is
the wasted rail he complains about most. It is attached to the thing it edits,
and that adjacency is the affordance.

Placeholder text is step-specific and shows a real command for the data on
screen:
`Tell me what to change — e.g. "change all Local Market to Local Supplier"`.

### 6.2 Thinking

- The typed text **stays visible** in the input, which goes read-only. Never
  clear it: if the instruction fails he must be able to edit and resend without
  retyping.
- Label under it: `Working through 63 rows…`, with a `Stop` that aborts.
- **The table is not greyed out and does not move.** He is reading it while he
  waits; that is the point of it being on screen.
- Over 15s: `Still going — long lists take a moment.`

### 6.3 It worked

The preview re-renders and a banner sits above the table:

> ✨ **I changed 12 rows.** Supplier "Local Market" → "Local Supplier".
> [ Show the 12 ] [ Undo ]

- `Show the 12` filters the table to those rows; the filter chip reads
  `Showing 12 changed · Show all`.
- `Undo` restores the previous rows array. Keep a stack of at least **10**;
  each undo names what it is undoing: `Undo "Local Market → Local Supplier"`.
- Changed cells carry the same `edited` mark manual edits get. One vocabulary,
  not two.

### 6.4 It misunderstood — five cases, five behaviours

**Nothing on this path writes to the database. Ever.** The AI rewrites rows in
the draft; the only write is the `Add N` button he presses. That guarantee is
what makes it safe to let it be wrong.

| Case | Detection | Copy | Rows |
|---|---|---|---|
| **Matched nothing** | instruction parsed, 0 rows affected | `I looked for "Local Market" in the Supplier column and there isn't one. The closest I can see are: [ Local Mart ] [ Localmarket Ltd ]` — chips are real values from the column, clickable to re-run with that value. | untouched |
| **Didn't understand** | model returns no operation | `I didn't follow that. Try something like: "set every unit to kg" · "remove the rows with no name" · "change all Local Market to Local Supplier"` — three examples generated from **this list's** actual columns. | untouched |
| **Too big to apply blind** | >25% of rows, or a required field on >10 rows | Do **not** apply. `That would change 48 of 63 rows. Here are the first 5: …` [ Apply to 48 rows ] [ Cancel ] | untouched until he taps |
| **Asked a question back** | model returns a question | Plain reply on one line above the bar: `Which "Rice" — Basmati or Long grain?` Input stays live for the answer. | untouched |
| **AI unavailable** (429/503) | error from `/assistant/*` | `The AI is busy — **nothing was changed.** Try again in a moment, or edit the rows yourself.` [ Try again ] | untouched |

Two more that matter:

- **It invented rows.** If the returned row count differs from what was sent
  and the instruction was not a delete: refuse the whole response.
  `I got that wrong — it came back with 80 rows from your 63, so I've left your
  list alone.` This mirrors the `MAX_LIST_ROWS` cap, which exists because *"a
  forty-line paste coming back as three hundred rows is a hallucination"*.
- **It edited a field he had already edited by hand.** Apply it, but say so:
  `This also overwrote 2 cells you had changed yourself. Undo` — his own edit
  is the more expensive thing to lose.

### 6.5 Contract

`POST /assistant/revise-rows`

```jsonc
// request
{ "list": "inventory", "rows": [ … ], "instruction": "change all Local Market to Local Supplier" }
// response
{ "rows":    [ … ],                      // the full revised set, same length unless deleting
  "changes": [ { "n": 4, "field": "supplier", "from": "Local Market", "to": "Local Supplier" } ],
  "summary": "Supplier \"Local Market\" → \"Local Supplier\" on 12 rows.",
  "question": null,                      // set → ask, change nothing
  "refused":  null }                     // set → explain, change nothing
```

The client re-runs `classify` (via `/{list}/import/preview-rows`) on the
returned rows, so verdicts, duplicates and differences stay the server's job
and there is no second definition of "already here".

---

## 7. Persistence — he closes the browser at step 3

### 7.1 What is stored, and what is counted

| | Source | Why |
|---|---|---|
| Step done / not done | **Counted from rows**, every load | A flag can be wrong; rows cannot. Somebody who deletes everything is genuinely back at the start, and the guidance should come back with them. |
| Skipped steps | Stored | Counting cannot know a decision. |
| Dismissed / snoozed-until | Stored | Same. |
| Current step | Stored | So "come back tomorrow" lands where he left off. |
| Draft rows, mapping, per-row decisions, vendor_supplies | Stored | The expensive thing. Losing it is losing an hour of his work. |
| Saved column layouts | Stored per `(hotel, list, header signature)` | "Tell me once." |

**Server-side, not localStorage** — he moves between laptop, phone and
incognito, and this has already burned the project once with the clock setting.
A small `onboarding_drafts` table (hotel_id, list, rows JSON, mapping JSON,
version, updated_at, updated_by) is the right home. `hotels.prefs` is not:
it is a validated key-space on the hotel row, and a few hundred parsed rows do
not belong in it.

Write cadence: debounced 1.5s after a change, and on step change, close, and
`visibilitychange → hidden`. Never on every keystroke.

### 7.2 What he sees tomorrow

Dashboard: the card, `2 of 5`, `Next: your team`.
Sidebar: `Onboarding 2/5`.
Opening it lands on **step 3** with the draft intact:

> **You left 41 people here yesterday.** Not added yet — started by you,
> 21 Sep, 6:20pm.
> [ Carry on ] [ Start this step again ]

`Start this step again` confirms inline (`Discard 41 rows?`), because that one
is genuinely destructive.

Drafts older than **30 days** are cleared, and the screen says so while they
are alive: `Saved here for 30 days.`

If two people touch the same draft, the second commit is refused on `version`:
`Somebody else changed this list while you were away. [ Reload it ]` — a stale
overwrite is exactly the silent data loss this whole flow exists to prevent.

---

## 8. Mobile, 390px — mandatory, not an afterthought

The current page is **1342px of document on an 844px viewport**, the floating
bottom nav covers a tile's title, and the voice bubble sits on another. All
three are fixed here.

| Region | At 390 |
|---|---|
| **Step bar** | Not five tiles (78px each is unreadable) and **not a sideways scroller**. One row: `Step 2 of 5 · Stock ⌄` plus five pips. Tapping opens a `SheetPopup` listing all five with their states and counts — tap one to switch. Click, not scroll. |
| **Source strip** | Three tiles stay in one row — icon above a one-word label (`File` · `Type` · `AI`), ~112px each, ≥72px tall. Comfortably over the 44px tap-target floor. |
| **Preview** | **Cards, never a table.** Line 1: the name, bold. Line 2: the two or three fields that matter for this list (stock: unit · category; match: the supplier chip). Line 3, for duplicates only: a full-width segmented `Keep ours | Use the file`. **No horizontal scrolling anywhere, at any width.** |
| **Differences** | The 3-column `label / ours / theirs` grid collapses to two lines: `Phone — ours +44 7700 900123` / `file says +44 116 555 0101`, the inactive one struck through. |
| **Mapper** | One card per file column, stacked: heading, sample values, then a full-width button showing the current target that opens a picker popup. Not a native `<select>` — the picker has to show sample values and the "don't use this" option with its reason. |
| **AI bar + primary button** | Both live in one pinned bottom bar, **above the floating nav**, with `padding-bottom` for the nav plus the safe-area inset. Use `100dvh`, never `100vh` — `100vh` on a phone includes the strip under the collapsing address bar and puts the bottom of the content out of reach. |
| **Voice bubble** | Hidden on `/onboarding`. There is already a full-width AI input on this screen; a floating second one that overlaps a tile is noise. |
| **Popups** | `SheetPopup` already centres on both axes and locks the page behind it. Depth 2 (the supplier picker over the preview) must keep its `←`. |

Target: **every step fits one screen at 390 in its idle state**, and a preview
scrolls only its own list.

---

## 9. Every state, in one table

| Screen | State | What renders | Copy |
|---|---|---|---|
| Page | loading | Step bar skeleton + stage skeleton, ~600ms max | — |
| Page | counts failed | Steps render with `—` instead of counts; everything still works | `Couldn't load your counts just now — everything below still works.` |
| Page | offline | Bar at the top; drafts keep saving locally and sync on reconnect | `You're offline. I'll keep what you type and save it when you're back.` |
| Step | no permission | Source strip hidden, one card | `This one is the owner's — ask them to add the team.` |
| Step | blocked (5) | Card + the button that unblocks | §3.2 |
| Step | skipped | Normal step; a line at the top | `You skipped this. Adding anything un-skips it.` |
| Stage | idle, empty | Reason + template + example | §4.1 |
| Stage | idle, has rows | First 12 + `+59 more` | `6 suppliers · added by you, today` |
| Stage | reading <400ms | nothing | — |
| Stage | reading >3s | line changes | `Still reading — large files can take a few seconds.` |
| Stage | file unreadable | Back to idle, error card | `That isn't an Excel or CSV file I can read. Try the AI route — it handles PDFs, Word docs and photos.` [ Read it with AI ] |
| Stage | too large | error card | `That file is over 15 MB. Split it, or export just this list.` |
| Stage | required column missing | mapper + reason | §4.3 |
| Stage | file has 0 rows | error card | `That file had headings but no rows under them.` |
| Stage | preview, all duplicates | summary line + list | `All 63 are already here, unchanged. Nothing to add.` |
| Stage | preview, some invalid | named rows + fix | `4 rows I couldn't read` · per row: `Row 12 — no name — add it and this row goes in with the rest` |
| Stage | preview, unmatched suppliers | count above the button | `3 suppliers need a look before I can link them.` |
| Stage | saving | button busy | `Adding 63…` |
| Stage | saved, full | result sentence | `6 suppliers added, 2 updated, 19 left as they were.` |
| Stage | saved, partial | result + failures + fix | §4.5 |
| Stage | commit rejected 400 | preview stays, error above the button | `The server wouldn't take 2 of those rows: <reason>. Nothing was added.` |
| Stage | commit 402 (unpaid) | preview stays | `Your plan needs renewing before anything else can be added. [ See plans ]` |
| Stage | commit 403 | preview stays | `You don't have permission to add suppliers. Ask the owner.` |
| Stage | network failure mid-commit | preview stays, **draft kept** | `I couldn't reach the server, so nothing was added. Your rows are still here. [ Try again ]` |
| AI bar | thinking | §6.2 | `Working through 63 rows…` |
| AI bar | no match / no parse / too big / question / unavailable | §6.4 | — |
| Draft | found on return | banner | `You left 41 people here yesterday. Not added yet.` |
| Draft | version conflict | banner | `Somebody else changed this list while you were away. [ Reload it ]` |
| Page | all five done | action bar primary | `All five done. [ Finish setting up → ]` |

---

## 10. API contract — what exists, what changes, what is new

**Exists, unchanged:** `/{inventory|vendors|employees|recipes}/import/preview`
(multipart) and `/import/commit` (`{rows: [{n, action, values}], source}`);
`/assistant/read-any`; `/{list}/export.csv|.xlsx`;
`/{list}/import-template.xlsx`.

**Changes:**

1. `GET /hotels/onboarding` → **five steps in his order**, replacing today's
   six (`sales` and `expenses` leave the stepper; they belong to the dashboard's
   own prompts). Adds `skipped: string[]`, `dismissed: bool`,
   `snoozed_until: date|null`, `current_step: string`,
   `drafts: {list: {rows: int, updated_at, updated_by}}`. Step 5's `done` is
   "≥1 dish has ≥1 line", not a row count on `recipes`.
2. `POST /{list}/import/preview` accepts optional `mapping`
   (`{"0":"name","3":"current_stock","4":""}`) and `header_row`. When present,
   `_match_header` is bypassed entirely.
3. Inventory preview rows gain `supplier_match`:
   `{given, status: "matched"|"suggested"|"unknown"|"blank", vendor_id,
   matched_name, suggestions: [{name, score}]}`. The route returns a plain
   `dict`, so no `response_model` strips it — but declare it on the Out schema
   the day one is added. That trap has nine occurrences.

**New:**

4. `POST /{list}/import/inspect` (multipart) →
   `{header_row, row_count, signature, saved_mapping|null,
     columns: [{index, header, samples: [3 strings], guess, confidence}],
     fields:  [{key, label, required}],
     other_list_fit: {list, label}|null}`
   `other_list_fit` is **advisory only** and is the single line that offers
   `Take me to step 1`. It is never acted on automatically. R1.
5. `POST /{list}/import/preview-rows` `{rows: [...]}` → the same plan shape.
   Needed by the typing route and by every AI re-preview. `classify()` is
   already split out for exactly this reason; it just has no HTTP door.
6. `POST /assistant/revise-rows` — §6.5.
7. `GET|PUT|DELETE /hotels/onboarding/draft/{list}` and
   `POST /hotels/onboarding/{skip|unskip|dismiss|snooze}`.
8. `RECIPE_LINES` list spec + `/recipes/lines/import/preview|commit` (step 5).

---

## 11. What I am deliberately not doing

1. **No "drop it anywhere and I'll guess the list" on this page.** It is the
   feature that turned his stock sheet into five suppliers. It survives on the
   Copilot and `/ai-scan` for people who genuinely have an unknown document;
   inside a section, the section decides.
2. **No progress percentage as the main device.** Most restaurants never finish
   setup, and a percentage turns a reasonable stopping point into permanent
   failure. Pips and `2 of 5`, plus an exit that is offered rather than hidden.
3. **No blocking modal, no forced route, no "you must finish".** Sign-in still
   lands a new owner here; they can leave from the first second.
4. **No second preview renderer.** `ImportPlan` is extended. A file, a paste,
   an AI read and an AI edit all land on the same screen, because two renderers
   is the same screen built twice at half the quality and he would have to
   learn both.
5. **No silent vendor creation** from a stock import, and no auto-accepted
   fuzzy match. Both are shown, counted and confirmed.
6. **No pay in step 3.** `EMPLOYEES_WITH_PAY` stays out of onboarding entirely.
7. **No costs or prices on the stock import**, however tempting the column in
   his file is. A price belongs to (vendor × item × form).
8. **No celebration screen.** A sentence with the numbers in it, then the
   dashboard.
9. **No animation spec here.** That is the other designer's document. What I
   will hold him to: the table must not move or grey out while the AI thinks,
   because he is reading it.

---

## 12. Where I disagree with him, and what I did about it

**Employees at position 3.** It breaks the one continuous chain the other four
steps form. Complied with; mitigated with copy that says out loud it can wait,
and by making Skip most prominent on that step. Not relitigated.

**"Menu" and "Recipes" as two sections.** They are one table. For him this is
right — a menu and a recipe book are genuinely two different jobs, and he
thinks about them separately. For a developer it is a trap, so §5 states it
twice. Kept.

**The word "Onboarding".** It is jargon; "Set up" is plainer English and is
what the current page uses. He named the section, so the section is called
Onboarding — in the sidebar, in the page title, and on the dashboard card.
Consistency with the name he will look for beats my preference for plainer
words.

**"until owner finish the onboading and close or skip and close".** Read
literally this is one exit with two outcomes. I have built three (`Save &
close`, `I'm done with this`, `Finish setting up`) because "I'll come back to
this" and "stop showing me this" are different intentions, and collapsing them
means one group of owners loses their draft and the other gets nagged forever.

---

## 13. Acceptance — how to know it is right

Not selector counts. **Screenshots, read.** Green assertions have passed on a
blank preview and four grey boxes where dishes should be.

1. Upload `Item Name,Category,Unit,Quantity,Unit Cost,Supplier` **on step 2**.
   → The mapper opens. `Item Name` is pre-filled as `Name`, chipped *guessed*.
   `Unit Cost` reads `Don't use this column` with its reason. Nothing reaches
   the vendors table. Screenshot both.
2. Upload the same file **on step 1**. → `This doesn't look like a suppliers
   list`, the six column names listed, and the advisory
   `Or is this a stock list? [ Take me to step 2 ]`. **No rows are created.**
3. Export vendors from the product, re-import on step 1 → `All 6 are already
   here, unchanged.` Not "already added", not a silent skip.
4. Step 2 with a supplier that does not exist → `unknown` state, three choices,
   and the `Also adding 2 new suppliers` line above the button.
5. Type `change all Local Market to Local Supplier` → banner naming the 12
   rows, `Undo` restores them, **nothing written** until `Add`.
6. Type nonsense → three real example commands drawn from the current columns,
   rows untouched.
7. Close the browser mid-step-3, reopen → dashboard card says `2 of 5`, the
   step opens with `You left 41 people here`.
8. 390px, every step, every mode: no horizontal scroll, nothing hidden behind
   the floating nav, the primary button reachable without scrolling.
9. `npm run lint` — not just `tsc` and `build`. Hook-order and
   used-before-declared pass both of the others. Four times now.
10. Deployed and seen working before anything in `docs/FEEDBACK_2026-09-05.md`
    §48.1b is ticked.
