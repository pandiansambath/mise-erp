# `/setup` — the moment a restaurant's data arrives

> "the oborading page is complelty missing->fine ignore ealier onoading page...
>  now we need a super speicial feature rich best UI UX animated desgins ect ect
>  (as this is the only page wihhc will give first imporesssiion to hotel owners)
>  .. we need to form a new team to ehcance this featrue bro like litrelly the
>  new hotel coming to register wiht us they should feel smoth expiereince...
>  litrelly whatever they need they can do ...also they can use ai..ai will play
>  big role here as it wil dected whatever the doc or images or ahwtever it is it
>  need to analyse and do the needefulll"

Design spec. One design, defended. Written against the live page at
`https://nirai1.dineai.cloud/onboarding` and against the code, not against a
description of either.

---

## 0. Evidence this is built on

| What | How |
|---|---|
| Live `/onboarding`, desktop 1440×900 | `scratchpad/diag2-onb.png` — signed in as `superadmin@gmail.com`, screenshot read |
| Live `/onboarding`, phone 390×844, step 2 | `scratchpad/mobile-onb-1.png` |
| Live `/dashboard`, 1440×900 | `scratchpad/desktop-dashboard.png` — the tour card is open over it |
| The house reference look | `scratchpad/ref-Purchasing.png` — the page he named as the standard |
| Computed geometry of the onboarding shell | `page.evaluate` on the live DOM: shell `rgb(11,18,32)` at 1430×900, `h1` at x=447 w=536 |
| Why the AI "demanded a PNG" | `backend/app/assistant/router.py:371-378` and `frontend/app/(app)/ai-scan/page.tsx:1055` |
| Why a CSV fails the Copilot path | `backend/app/assistant/ingest.py:233-256` |
| The plan contract | `backend/app/core/list_io.py`, `lists.py`, `roundtrip.py` |

**Cleanup:** nothing was created, edited or deleted on the live tenant. Three
page loads and one sign-in, read-only. No file was uploaded to any AI endpoint.

---

## 1. The correction: it is not missing, it is unreachable, off-theme and half-empty

`frontend/app/onboarding/page.tsx` is 601 lines and returns 200. I signed in and
looked at it. Four things are true at once, and only the first is what he
reported.

**It is unreachable at the moment it matters.** `frontend/lib/auth.tsx` ends
every sign-in with

```ts
const home = res.user.is_platform_owner ? "/control-room" : "/dashboard";
```

The only paths in are a 900ms timer in `frontend/app/verify-email/page.tsx:34`
and a conditional banner on the dashboard
(`frontend/app/(app)/dashboard/page.tsx:294`) that only renders when recipes,
month sales and month expenses are all zero. A new owner who signs in a second
time never sees it again.

**It uses 40% of the screen.** Measured on the live DOM at 1440px: the shell
renders 1430px wide; the content column
(`relative mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-8`) is **576px** at
x=427, and the text inside its padding is **536px** at x=447. So **854px of
empty dark green, 427 on each side.** Below the Continue button there are
**340px of nothing** before the fold (content ends at y≈560 in a 900px
viewport). This is the complaint he has made more than any other, on the one
page he says makes the first impression.

**It ignores the theme system entirely.** The page is hard-coded
`bg-[#0b1220] text-white` with `from-emerald-500 to-teal-500` gradients and
about thirty instances of `border-white/15` / `bg-white/5` / `text-white/70`.
His tenant's theme is a light claret. So the dashboard is warm and pale, and
clicking through to onboarding drops you into a near-black green page that looks
like a different product. Twenty-three themes exist; this page honours none of
them, in either mode. Not one `mise-card-inset`, not one `mise-well`, not one
`text-fg`.

**It is a nine-step wizard fronted by a stock photograph.** "Step 1 of 9" under
a progress bar, and above it a photoreal moustachioed chef in a circle
(`ChefMascot`). A generic AI chef portrait is the "repeated stock photograph
reads as cheap" trap, and it is the first thing a stranger sees.

And there are **four competing onboarding surfaces** shipping today:

| Surface | Where | What it claims |
|---|---|---|
| `app/onboarding/page.tsx` | own route, outside the shell | "Step 1 of 9" |
| `components/Onboarding.tsx` | dashboard panel, 197 lines | "0 of 6 done", a % bar |
| the dashboard banner | `dashboard/page.tsx:294` | "Let's finish setting up" |
| `components/Tour.tsx` | floats over the dashboard | "Welcome to DineAI 👋 1/9" |

The screenshot of the live dashboard has the tour card sitting over the bottom
third of the page. A brand-new owner meets two different "1 of 9"s and two
different progress claims in the same minute. That is the actual first
impression, and no single one of these is the problem.

### What is worth keeping from the 601 lines

He said ignore it. Most of it should go, but not because it is bad — because it
is the wrong shape. What survives is the part that took the thinking:

- **`ImportStep`'s read → preview → commit shape.** Two calls, nothing written
  until a person has seen rows. That contract is the spine of everything below.
  Keep it exactly.
- **The copy.** "Upload a list of what you keep in stock — a spreadsheet, a PDF,
  even a photo of a handwritten list." That is good writing and it is reused
  verbatim.
- **The empty-review branch** (`ReviewStep`, `totalRows === 0` → "Nothing
  imported yet — and that's OK"). Somebody thought about the empty state. The
  sentiment becomes the resting state of the station tiles.
- **`CostsStep.categoryId()`** — find-or-create for an expense category. Small,
  correct, reusable.
- The three comments at the head of `components/Onboarding.tsx`: *one next step
  not six*, *import beats typing*, *it disappears by itself because progress is
  counted not stored*. All three are law below.

What goes: the nine-step machine, the name prompt and its `NAME_KEY`
localStorage, `ChefMascot`, every hard-coded colour, the progress bar, the
22-particle confetti `Done` step, `ReviewStep`'s flick-through pagination, and
the standalone route outside the app shell. About 120 of 601 lines survive as
logic and none of the chrome.

`components/Onboarding.tsx` and the dashboard banner are both deleted. The tour
stops auto-starting for a hotel that has no data — a guided walk through eight
empty pages is worse than no walk.

---

## 2. The one thing this page actually is

He spent Friday moving a restaurant to a new account. Exported inventory, found
no export for vendors, employees or recipes, made a new hotel, got an empty
dashboard with no onboarding, tried to import the file we had just written him
and it was rejected, tried the AI and it demanded a PNG for a spreadsheet.

He was not a new customer. He was an existing customer **migrating**, which is
the hardest version of the same job and the one that exposes everything. A page
that serves the migration serves the greenfield owner for free — the greenfield
owner simply has fewer files.

So this is not a welcome screen. **It is the receiving door.** Everything below
follows from that one sentence.

---

## 3. THE ARRIVAL

### 3.1 It lives inside the app shell

Route: **`frontend/app/(app)/setup/page.tsx`**. Delete `app/onboarding/`.

Five reasons, in order of how much they matter:

1. It inherits the theme. `AppShell` sets `data-mode` and `themeVars(theme)` on
   its own wrapper (`components/AppShell.tsx:877-878`). Inside the group, every
   `text-fg`, `bg-paper`, `border-line` and `brand-500` is correct on all 23
   themes in both modes, for free. That single move fixes the page's largest
   defect and it costs nothing.
2. It inherits `mise-card-inset`, `mise-well`, `SheetPopup`, `TileCard`,
   `PageHeader`, `Segmented`, `EmptyState`, `ConfirmProvider` and the Copilot —
   all of which the standalone route re-implemented in white-alpha.
3. It stops being a dead end you "Skip setup →" out of and becomes a **room you
   can leave and come back to.** Most restaurants will never finish setup; a
   modal that has to be escaped makes that a failure, a room does not.
4. The sidebar is itself the orientation. A full-screen wizard hides the product
   behind itself at exactly the moment someone is deciding whether they want it.
   The reference page he named — `/purchasing`, `scratchpad/ref-Purchasing.png`
   — shows the sidebar, a full-width tile grid and a totals strip. That is what
   premium looks like in this codebase.
5. Being a nav entry makes "unreachable" structurally impossible.

### 3.2 The routing decision that replaces the 900ms timer

`frontend/lib/auth.tsx`, in `adoptSession`:

```ts
const home = res.user.is_platform_owner
  ? "/control-room"
  : res.hotel?.needs_setup ? "/setup" : "/dashboard";
```

`needs_setup` is computed server-side from the same row counts
`app/hotels/onboarding.py` already does, and it is true only while **all four**
of items / vendors / recipes / employees are zero. One boolean. It must be
**declared on the hotel Out schema** — `response_model` drops undeclared fields
and has done so nine times.

Why all four rather than any: a restaurant that has entered one thing has
found its way, and being redirected away from the dashboard on every sign-in is
nagging. Counted, never stored, so a genuinely emptied hotel gets the guidance
back — that is `Onboarding.tsx`'s third principle and it is right.

`verify-email/page.tsx:34` stops hard-coding `/onboarding` and simply sends
people to `/dashboard`; the sign-in redirect handles the rest.

### 3.3 The first second

No name prompt. No mascot. No "Step 1 of 9".

```
Set up NIRAI                                       [ Skip — I'll do it as I go ]
Bring what you already have. Drop it anywhere on this page — I'll work out
what it is.
```

The hotel name comes from `useAuth().hotel.name`, which they typed at signup
sixty seconds ago. The headline is *their* restaurant, already in the product.

The name prompt is deleted outright: it costs a full screen and buys a greeting.
`Welcome` in the current page exists only to set `mise.user.name` in
localStorage, which does not travel to their phone anyway.

---

## 4. THE SCREEN

Desktop, 1440. Full bleed inside the shell's content area — no `max-w-xl`, no
centred column, no empty rails.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Set up NIRAI                                     [Skip — I'll do it as I go]  │  PageHeader
│ Bring what you already have. Drop it anywhere on this page.                   │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ╭─────────────────────────────  THE DROP RAIL  ──────────────────────────╮   │  full width
│  │  Drop a file here                                                      │   │  ~132px
│  │  [ Choose a file ]  [ Take a photo ]  or press ⌘V to paste a screenshot│   │  mise-well
│  │  Spreadsheets, PDFs, photos of paper, WhatsApp screenshots. Several    │   │
│  │  at once is fine.                                                      │   │
│  ╰────────────────────────────────────────────────────────────────────────╯   │
│                                                                               │
│  ┌───────────────┬───────────────┬───────────────┬───────────────┐            │  4 × TileCard
│  │ 📦 Stock      │ 🤝 Suppliers  │ 🍲 Menu       │ 🧑‍🍳 Team      │            │  equal width
│  │               │               │               │               │            │  ~180px tall
│  │ 0 items       │ 0 suppliers   │ 0 dishes      │ 0 people      │            │
│  │               │               │               │               │            │
│  │ Recipes can't │ Nothing to    │ No margins    │ Rota and      │            │
│  │ be costed     │ compare       │ until there   │ payroll wait  │            │
│  │ until this    │ prices        │ are dishes    │ on this       │            │
│  │ has something │ against yet   │               │               │            │
│  └───────────────┴───────────────┴───────────────┴───────────────┘            │
│                                                                               │
│  Add your suppliers next and Price Comparison starts working.                 │  one line
│                                                                               │
│  ─────────────────────────────────────────────────────────────────────────    │
│  Moving from another DineAI account?  Export there → drop the file here.      │  thin strip
│  Already have a spreadsheet of your own?  We read it as it is.                │
└───────────────────────────────────────────────────────────────────────────────┘
```

Height at 1440×900: header 88 + rail 132 + tiles 180 + line 32 + strip 56 +
gaps ≈ **560px**. It fits above the fold on a laptop with room to spare and it
uses the full width. No scroll to reach what the page is for.

**Why the rail is one wide bar and not four drop zones.** Four zones is four
decisions before you have done anything, and it is a lie — the AI does not need
to be told which pile the file belongs to, and pretending it does is the exact
friction this page exists to remove. One bar, one gesture.

**Why the four tiles are counts and not buttons.** They are the state of the
restaurant. They happen to be clickable, which is where doors (c) and (d) live,
but their job on arrival is to answer "what does this thing want from me" in one
glance and four nouns.

---

## 5. THE FOUR DOORS

He wants "litrelly whatever they need they can do". That means all four ways
must exist. It does not mean all four get equal space on the arrival screen —
that is how a screen becomes a form.

| Door | Where it lives | Why there |
|---|---|---|
| (a) upload a file we can parse | **the rail — primary** | the only thing on the page with weight |
| (b) hand the AI anything | **the same rail** | see below; this is the central decision |
| (c) type it in | inside a station popup, one click | a real need, a minority path |
| (d) skip | one quiet link, top right | never a modal, never a confirm |

### 5.1 (a) and (b) ARE the same door. This is the design.

Today they are three different doors with three different rules, and he hit two
of them on Friday.

**Door 1 — `/inventory` "Download template"** → `POST /inventory/import-template`.
Strict, spreadsheet only, no AI, exact errors. Rejects anything whose header row
does not match.

**Door 2 — AI Scan** → `POST /assistant/vision/read`. `router.py:371-378`:

```python
media = (file.content_type or "image/jpeg").split(";")[0]
if media not in ("image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"):
    raise HTTPException(422, "Please upload a photo (JPEG, PNG, WEBP or GIF).")
```

There it is, verbatim — **"the AI demanded a PNG for a spreadsheet."** And the
file picker on that page is `accept="image/*"`
(`frontend/app/(app)/ai-scan/page.tsx:1055`), so you cannot even *choose* an
`.xlsx` to be rejected.

**Door 3 — Copilot ingest** → `POST /assistant/ingest`. Handles `.xlsx` (flattens
via openpyxl to CSV text) and images and PDFs. But `ingest.py:233-256` branches
on `_is_excel(mime)` or `image/*`, and **everything else falls through to the
document branch labelled `media_type: "application/pdf"`**. A `.csv` — the most
likely file a small restaurant owns, and the exact format of our own
`GET /vendors/export.csv` — is base64'd and sent to Bedrock claiming to be a
PDF. It fails, and the frontend renders "Sorry — I couldn't read that file."

Three doors, three rulebooks, and the round trip we just built
(`roundtrip.py`: *"whatever we export we can import and use the same"*) can be
broken by picking the wrong one.

**The law: the user never chooses a reader.**

One endpoint, `POST /api/setup/read`, takes any bytes and decides internally:

```
bytes + filename + mime
        │
        ├─ 1. is it a spreadsheet or CSV?  (extension OR sniff, never mime alone —
        │     browsers send text/csv, application/vnd.ms-excel and "" for the same file)
        │     └─ try parse_upload() against each ListSpec in lists.EXPORTABLE
        │        headers match → DETERMINISTIC. No AI, no cost, no latency, exact.
        │        This is the path our own export takes and it MUST be tried first.
        │
        ├─ 2. spreadsheet, but no spec's headers matched?
        │     └─ DO NOT stop. Flatten to CSV text (_xlsx_to_csv already exists)
        │        and hand it to the model with "map these columns to this schema".
        │        The dead end here is what rejected his own export.
        │
        ├─ 3. image / PDF / screenshot / anything else
        │     └─ AI vision, the existing ingest.extract() path
        │
        └─ 4. several files → a queue, read one at a time, one result each
```

`accept` on the input is **not set at all**. Every `accept` list in this codebase
is a place a future format gets silently refused. The server decides.

### 5.2 The AI answers "what is this?" before "what's in it?"

`POST /assistant/ingest` today requires `kind` as a form field — the caller must
already know the file is a supplier list. On the arrival rail nobody has chosen a
station, and being made to choose is the friction we are removing.

So the read is two questions, in order:

1. **Classify.** `items | vendors | recipes | employees | sales | unknown`, with
   a one-clause reason in plain English: *"It has a column called Supplier and a
   column of phone numbers."* Cheap — this can run on the first 40 rows or a
   downscaled image.
2. **Extract**, against the schema for whatever it just decided.

If confidence is low, it asks **once**, with two tiles and no dropdown:

```
  I think this is your supplier list.          [ Yes, suppliers ]  [ No — it's stock ]
  It has a column called "Supplier" and phone numbers.
```

Two tiles, both live, one is pre-selected. A dropdown of six options here would
be handing the classification problem back to the person, which is the whole
thing we said the AI was for.

This is the "ai will play big role here as it wil dected whatever the doc or
images or ahwtever it is" ask, answered literally.

### 5.3 (c) Type it in

Inside the station popup, a third tab. Not a form — a **grid**: the spec's
columns as headers, one blank row, Tab moves right, Enter adds a row below.
`lists.VENDORS` already declares the columns, the widths, the required flags and
two sample rows; the grid is generated from `ListSpec`, so it can never drift
from the importer. Paste from a spreadsheet into the first cell fills the grid.

Ten suppliers typed by hand is five minutes and completely reasonable. Two
hundred stock items is not, which is why this is behind a click and the rail is
not.

### 5.4 (d) Skip

One link, top-right of the header: **"Skip — I'll do it as I go"**. No confirm
dialog, no "are you sure", no guilt copy. It sets a flag in `hotels.prefs`
(server-side, so it follows them to their phone — the current `mise.setup.done`
and `mise.onboarding.hidden` are localStorage and do not) and goes to
`/dashboard`. `/setup` stays in the sidebar under OVERVIEW, permanently, with
the counts still on it.

---

## 6. THE STATION POPUP

Clicking a tile opens a `SheetPopup` — centred on both axes, page behind locked,
stacks, Escape closes the top one only. All of that is already solved in
`components/SheetPopup.tsx`.

```
╭──────────────────────────────────────────────────────────────────────────╮
│  🤝 Suppliers                                                        [✕] │
│  0 so far                                                                │
├──────────────────────────────────────────────────────────────────────────┤
│  [ Upload a file ] [ Type them in ] [ Blank template ]                   │  Segmented
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   (the chosen door's body)                                               │
│                                                                          │
╰──────────────────────────────────────────────────────────────────────────╯
```

"Blank template" is `GET /api/vendors/import-template.xlsx` — it already exists,
and `roundtrip.py` already guarantees the file it writes is a file we accept
back, including for an empty restaurant (its point 4). A restaurant with nothing
to export still gets headers and two sample rows.

---

## 7. THE DUPLICATE PREVIEW

His words:

> "if duplcaite ask user to chekc and remove duplcaite by showing the previw of
>  duplcaute before ading wihtut confirmaiton"

`build_plan()` already returns exactly what this needs, per row: `verdict`
(new / duplicate / invalid), `existing` (what we hold), `differences` (the list
of **headers** that actually differ — "Phone", "Email"), and `reason` in
English. `Plan.as_dict()` already separates `unchanged` from `duplicates`.
None of the following needs new backend thinking, only the second call.

### 7.1 Three groups, and you land where a decision is needed

```
  47 new          9 already here          2 we couldn't read
  ready to add    need a look             skipped, here's why
```

Default tab: **duplicates if there are any**, otherwise new, otherwise invalid.
Never land on an empty tab — an empty state that renders nothing looks like a
failure, and landing on "0 new" after uploading a file reads as "it didn't
work."

### 7.2 The comparison

One `mise-card-inset` per duplicate. This is the screen his sentence is about.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Fresh Farms                                            row 12 of your file│
│                                                                            │
│                  WHAT WE HAVE              YOUR FILE SAYS                  │
│   Phone          +44 116 555 0101          +44 7700 900123    [keep][use]  │
│   Email          not set                   orders@fresh…      [keep][use]  │
│                                                                            │
│   The other 8 columns are the same.                                        │
│                                                                            │
│   [ Keep ours ]                                     [ Take theirs ]        │
└───────────────────────────────────────────────────────────────────────────┘
```

Seven rules, each one the difference between this and a merge-conflict tool:

1. **Only differing fields are rows.** `differences` gives exactly those. The
   eight identical columns collapse to one grey sentence. A merge tool shows you
   everything and makes you hunt; this shows you only what is in question.
2. **Two plain-English labels.** "What we have" / "Your file says". Never
   ours/theirs, never local/remote, never `<<<<<<<`.
3. **No red/green.** Diff colouring reads as error, and neither value is an
   error. The two values are `text-fg`; the chosen one gets a `mise-well` inset
   and a brand hairline. Choice is shown by depth, not by hue — which also means
   it survives all 23 themes and both modes.
4. **Every row arrives already decided, and the default is `keep`.** Nothing is
   destructive unless someone actively chooses it. A person who reads the card,
   agrees, and closes it has lost nothing.
5. **The commit button is live on the first paint and says what it will do.**
   "Add 47 · update 3 · leave 6" — and it re-counts as choices change. A control
   that is disabled on arrival reads as broken.
6. **Identical rows are not a conflict.** `differences == []` → they never enter
   this list. They get one line above it: *"6 rows are already here, unchanged —
   nothing to do."* The current inventory importer calls these "skipped", which
   sounds like data was lost. It was not.
7. **A file that repeats itself gets its own small group, first.** `list_io`
   already returns `reason: "the same name appears earlier in this file, on row
   12"`. That is almost always two lists pasted together, and the fix is in their
   file. One button: **"Keep the first of each."**

**Field-level choice, not only row-level.** Row-level skip/overwrite loses the
common case: the file has a better phone number and a worse address. Two taps per
differing field, defaults already set, plus a row-level pair for the impatient
and a header-level pair ("keep ours everywhere" / "take theirs everywhere") for
someone with ninety duplicates.

### 7.3 The invalid group is not an error list

```
  Row 31 — no name, so there's nothing to call this supplier.   [ Type one in ]
  Row 44 — "Phone" reads "see whatsapp".                        [ Fix ] [ Drop ]
```

Each line says what is wrong in a sentence, and offers the fix inline. `Plan`
already carries `reason` per row and `errors` for whole-file problems.

### 7.4 The second call

```
POST /api/vendors/import/commit
{ "rows": [ { "n": 12, "action": "update", "values": {...} }, ... ] }
```

`import/preview` exists (`backend/app/vendors/router.py:644`,
`backend/app/employees/router.py:956`). **`import/commit` does not exist yet for
either.** It is on the build list. It must be idempotent on `n` + key so a
double-tap on a phone cannot create twice.

---

## 8. PROGRESS WITHOUT A PROGRESS BAR

Delete every one of them: the "Step 1 of 9" bar, the `%` in `Onboarding.tsx`,
the tour's "1/9", the dashboard banner.

**The four tiles are a state display, not a progress display.** Each shows:

- the noun — Stock, Suppliers, Menu, Team
- **the count with its unit**, always. "0 items", "128 items", "41 dishes".
  Never a bare number. A number without its unit is worse than no number.
- one consequence line that changes with the count:

| | empty | populated |
|---|---|---|
| Stock | "Recipes can't be costed until this has something in it." | "128 items · 41 with a price" |
| Suppliers | "Nothing to compare prices against yet." | "9 suppliers · 6 with prices" |
| Menu | "No margins until there are dishes." | "41 dishes · 38 priced" |
| Team | "Rota and payroll wait on this." | "12 people · 9 active" |

State is carried by the card's own treatment, not by a bar:

- **empty** — `mise-card-inset`, dashed inner rule, count in `text-fg-faint`.
  Calm, not red. It is empty, not failing.
- **has data** — count in `text-fg` at `tabular-nums`, a 3px brand stripe down
  the left edge (`TileCard`'s `STRIPE.chosen`), consequence line becomes a fact.

**There is no total and no fraction.** No "2 of 4", no percentage, no ring.
Most restaurants will never do all four — a takeaway with no fixed staff will
never fill Team — and a fraction turns a permanent, reasonable state into a
permanent failure. Four tiles, each full or empty, reads in under a second and
never says "you are 50% of a person."

The single piece of forward motion on the page is **one sentence** under the
tiles, computed from the same counts, phrased as a capability rather than a
chore:

> "Add your suppliers next and Price Comparison starts working."

It has no button of its own. The tile above it is the button. When all four have
data the sentence is replaced by:

> "NIRAI is set up. Everything here stays — add more whenever you like."

No confetti, no modal, no celebration. The page just stops asking.

The counts come from the endpoint that already exists,
`GET /api/hotels/onboarding` (`backend/app/hotels/onboarding.py`). Its six
`STEPS` are trimmed to four for this page: **sales and expenses are not setup,
they are Tuesday.** They keep their own prompts on the dashboard, where they
belong, and dropping them turns a nine-step wizard into four tiles.

---

## 9. THE MOTION

He asked for animated, and he rejected the WebGL landing for looking cartoon.
Two measured lessons in `globals.css` bound this:

- `mise-rise` used to translate 12px with delays to 0.48s. *"i need to click one
  any button 2 or 3 times to make it click."* An audit found buttons still
  displaced 3.5 seconds after load. **A moving target is a missed tap.** It fades
  now.
- Past the twelfth child, `mise-stagger` animates nothing. 23 concurrent
  animations on `/inventory` blocked the main thread for 1.7s with one 831ms
  task, and a press cannot paint while the thread is busy.

**The principle: the only things that move are things that are changing state.**
Nothing moves to decorate. Motion that carries information reads as expensive;
motion that carries none reads as a screensaver. All of the below is CSS plus
one `requestAnimationFrame` counter. No library. `three` and `gsap` stay at zero
imports.

### The six pieces

**1 · Arrival — the stations settle.**
`mise-stagger` on the four tiles. Already exists, already opacity-only, already
capped. 30/48/66/84ms, 300ms each, done in 384ms. Nothing translates, so the
tile you aim at is where it appeared. *Why:* it says "these four are a set"
without a single pixel of displacement.

**2 · Drag-over — the room turns to look at you.**
A window-level `dragenter` sets `data-dropping` on the page root. Two things
change over 160ms: the content area gains an inset brand ring
(`box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-brand-500) 40%, transparent)`)
and the four station tiles fall to `opacity: .55` while the rail stays at 1.
Reverts in 120ms. **Nothing moves, nothing bounces, nothing pulses.**
*Why:* a whole-window response tells you the target is the whole window — the
one fact you most need and the one a 200px dashed box actively denies. And an
inset ring is the house language (`mise-well`, `mise-card-inset`); a glow around
the outside would be the only outer shadow on the page.

**3 · The read — three true sentences, not a spinner.**
While the file is being read the rail becomes one line of live status that
replaces itself, with `mise-shimmer` (exists) sweeping the rail:

```
  Reading  dineai-vendors.xlsx…
  It's a supplier list.
  42 rows. Checking them against what you already have…
```

Each crossfades in 180ms. These are **not fake stages** — they are the three
things the server genuinely learns in order: bytes received, classification
returned, extraction complete. Two sequential calls or one SSE stream, either is
fine.
*Why this above everything else:* an indeterminate spinner for eight seconds is
the cheapest-looking moment any app can have. Three true sentences over the same
eight seconds is the most expensive-looking, and it costs no animation budget at
all. It is also honest: if the AI is slow, you can see where it is.

**4 · The landing — the file flies to its station. Once.**
When the read resolves, the filename chip in the rail animates to the matching
tile: one absolutely-positioned element, a 380ms transform on
`cubic-bezier(0.22, 1, 0.36, 1)`, then removed from the DOM. The tile's count
then **counts up** from its old value to its new one over 500ms —
`requestAnimationFrame`, integer steps, `tabular-nums` so the digits never
change width and the card never reflows.
*Why:* this is the one moment in the entire product where an animation tells you
something you could not otherwise know — **which of the four piles your file went
into.** It is the visible payload of the whole AI-classification decision, and
it is the moment worth spending on. Once per file, never looped.
*Constraint:* **the tile must not move while this happens.** Only the flying chip
moves. Otherwise we have rebuilt the missed-tap bug at the exact instant someone
is reaching for the tile.

**5 · The station popup** — inherits `SheetPopup`'s existing scale-from-origin.
No new motion.

**6 · A choice lands.** Changing keep/use on a duplicate field applies
`mise-pop` (180ms, opacity only) to that field row and nothing else. The list
**must not re-order** — a list that rearranges under your finger is the worst
feedback there is.

### What explicitly does not move

No aurora, no parallax, no drifting gradient — the aurora is the landing page's
voice, not the app's, and `mise-onb-bg` (a 22s infinite background loop) is
deleted with the page it belongs to. No confetti; the current `Done` step fires
22 ember particles, which is the tone of a mobile game and not of a £39/month
business tool. No mascot, animated or still. **No looping animation anywhere on
this page** — every animation here is one-shot and tied to an event.

### `prefers-reduced-motion: reduce`

One block appended beside the existing ones in `globals.css`. The stagger, the
shimmer, the flying chip and the drag ring all resolve instantly to their end
state. The count-up **jumps to the final number**, never to zero — a reduced-
motion user must not be shown "0 items" as a resting state. The flying chip is
not rendered at all; the count simply changes.

---

## 10. MOBILE

Checked at 390×844, which is where he checks.

- **The rail cannot be a drop zone** — you cannot drag a file on a phone. It
  becomes three real buttons, full width, 56px tall, in the thumb zone:
  **Photo** (`capture="environment"`) · **File** · **Type it**. Photo is first
  because photographing the stock sheet on the wall is the thing a phone is
  uniquely good at.
- **The four stations are 2×2, not a list.** 2×2 plus the header and the rail
  fits above the fold at 844px; a single column does not, and he hates scrolling.
- Station popup is `SheetPopup`, already centred on both axes with the page
  behind locked.
- **The duplicate comparison stacks.** Field name on line 1; "What we have" and
  "Your file says" as two labelled lines; the choice as a 2-segment `Segmented`.
  No table, no horizontal scroll, same content.
- `100dvh`, never `100vh` — `100vh` on a phone includes the strip under the
  collapsing address bar and puts the bottom of the page out of reach.
- Paste: the desktop `⌘V` hint is hidden below `sm`, where the clipboard route
  does not exist. The Photo button covers the WhatsApp-screenshot case.
- Every tap target ≥ 44px. `npm run responsive` sweeps 360/390/768/1024/1440/1920
  for sideways scroll, overflow, clipped text and small targets — it must be
  clean before this is called done.

---

## 11. THE BUILD LIST, IN ORDER

Each step is shippable on its own and visible on the live site.

**1 — Make it reachable and make it themed.** Move `app/onboarding/page.tsx` to
`app/(app)/setup/page.tsx` as-is, strip the hard-coded palette to house tokens,
add `needs_setup` to the hotel Out schema (declare it — `response_model` drops
undeclared fields), and change the redirect in `frontend/lib/auth.tsx`. Nothing
new is designed; the page stops being invisible and stops being a different
product. *This is the single highest-value change in this document and it is
mostly deletion.*

**2 — Fix the two reader bugs, with tests.** Both are one-line-ish and both bit
him personally:
  - `backend/app/assistant/ingest.py:246` — a `.csv` must not be sent to Bedrock
    labelled `application/pdf`. Route text/CSV through the text branch.
  - `backend/app/assistant/router.py:371-378` — `/assistant/vision/read` must not
    answer a spreadsheet with "Please upload a photo (JPEG, PNG, WEBP or GIF)."
    And `ai-scan/page.tsx:1055` must not be `accept="image/*"`.

**3 — `POST /api/setup/read`, the one door.** Spreadsheet → `parse_upload`
against every `ListSpec` in `lists.EXPORTABLE`; no match → flatten and hand to
the model; image/PDF → vision. Returns `{kind, confidence, why, plan}` where
`plan` is `Plan.as_dict()`. A spreadsheet whose headers match costs zero AI
tokens and returns in milliseconds.

**4 — `POST /api/{vendors,employees}/import/commit`.** The second call.
Preview exists; commit does not. Per-row `create|update|skip`, idempotent,
audit-logged with `audit_service.record(user=…)` — `user=`, not `user_id=`, and
it commits, so it goes at the end of the transaction, not the middle.

**5 — The `/setup` screen proper.** PageHeader, the rail, four `TileCard`s from
`GET /hotels/onboarding` trimmed to four steps, the consequence line, the
migration strip. Motion pieces 1 and 2. No AI needed to look right — the tiles
render from counts.

**6 — The duplicate preview component.** `components/setup/ImportPlan.tsx`.
Three groups, field-level choice, defaults to keep, live commit button. Built
against `Plan.as_dict()`, which is already the exact shape. Shared — `/vendors`,
`/employees` and `/inventory` all get it, so this is not onboarding-only work.

**7 — Classification, and motion pieces 3 and 4.** The "what is this?" pass, the
three true status lines, the flying chip, the count-up.

**8 — The station popup's other two doors.** The typing grid generated from
`ListSpec`; the blank-template download (already an endpoint).

**9 — Delete the competition.** `components/Onboarding.tsx`, the dashboard
banner at `dashboard/page.tsx:294`, the auto-start of `Tour` for a hotel with no
data, `app/onboarding/`, and the `mise-onb-bg` and `mise-step` CSS that only
that page used (checked: both have exactly one consumer). **`mise-confetti`
stays** — `app/careers/page.tsx:176` uses it. **`ChefMascot` stays** — it is on
`/how-it-works`, `/sales` and `/stock-take`; it is only wrong as the first thing
a stranger sees. Move the skip flag from localStorage to `hotels.prefs` so it
follows the owner to their phone.

**10 — Recipes round trip.** `RECIPES` in `core/lists.py` with export, template
and preview, so the Menu station is not the one tile that cannot take a file.
This is the gap that is left after vendors and employees.

**Before any of it is called done:** `npm run lint` (not just `tsc` and
`build` — hook-order and used-before-declared pass both), `npm run responsive`,
and a screenshot of `/setup` on a light theme and a dark theme that somebody
actually looks at.

---

## 12. The one-line defence

The brief asks for a welcome. The Friday it came from asks for a receiving door.
This design builds the door, puts it inside the house so it is the same colour as
the rest of the house, makes every file go through one opening, shows the two
versions of a supplier side by side before anything is written, counts four
things instead of scoring nine, and moves exactly six times — each of them
because something changed.
