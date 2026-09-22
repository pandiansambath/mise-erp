# Onboarding v3 — the visual language

> "why everythign is splitted ...clumsy...worst worst UI UX...inboading is not
>  like what im expeceted...please chnage the style please"
>
> "PLESE FORM A DESAGINER TEAM AND DESIGN A SUPER AWESOME UI UX"

**This document is type, spacing, colour, surface, motion and the exact class
recipes.** Flow, states, copy and the API contract are the other designer's
document — `docs/design/onboarding-v3-flow.md`. I use its region names
(PageHeader / STEP BAR / STAGE / ACTION BAR) and its five steps and six modes
unchanged. Where I disagree with it I say so in §15.

Written against the live site and against `globals.css`, not against a
description of either.

---

## 0. Evidence

Signed in as `superadmin@gmail.com` on `https://nirai1.dineai.cloud`, Chromium,
deviceScaleFactor 1. Every screenshot below was opened and read.

| What | File | What it proves |
|---|---|---|
| `/setup`, 1440×900 | `scratchpad/shots/d1440-setup.png` | Content ends at y=587 in a 900px viewport. **313px of empty page below it, and the page does not scroll** (`scrollHeight` 900 = `innerHeight` 900). The flow designer measured the same fault independently at 1280×800 — content ending at y≈600, ~200px of dead page — so it is the layout, not one viewport. |
| `/setup`, 390×844 | `scratchpad/shots/m390-setup.png`, `…-full.png` | `scrollHeight` **1342px against an 844px viewport** — 1.6 screens. Two of the four tiles are below the fold. The mic FAB sits on the Suppliers tile; the floating nav covers the Menu tile. |
| Geometry, both | `scratchpad/shots/{d1440,m390}-setup-geo.json` | Drop card **1110×168**. Each station tile **266×120**. Hint well text **11px**. No `h1` on the page — the title is an `h2` at 30px. |
| **The import preview, 1440** | `scratchpad/shots/d1440-plan-open.png` | The panel is **352×423 on a 1440×900 screen**. 1088px of blurred backdrop. |
| The import preview, 390 | `scratchpad/shots/m390-plan-open.png` | **352×423 — the identical pixel geometry.** The desktop is rendering the phone layout. |
| `/inventory`, 1440 and 390 | `scratchpad/shots/d1440-inventory.png`, `m390-inventory.png` | The house's best data screen: full-width tray, sticky column heads, zebra, units on every number, a pinned tally. The preview shares none of it. |
| `/vendors`, 1440 | `scratchpad/shots/d1440-vendors.png` | The dotted-leader idiom (`name … value`) I reuse in §5. |
| Theme tokens, live | `page.evaluate` on `.mise-app` | Any **cold page load renders `chalk`** (`--color-brand-600: #0949a4`, shell `#ffffff`) regardless of the hotel's saved theme (claret, `#a11f44` / `#f4eef0`), for at least 6 seconds. Reproduced on `/setup`, `/inventory` and `/dashboard`. |
| All 22 themes | computed from `lib/theme.tsx` | `shell`→`paper` contrast is **1.08–1.13 on every theme and exactly 1.000 on chalk**. `text-white` on `bg-brand-600` is **below 4.5:1 on 8 of 22 themes**. Numbers in §1.4 and §14. |

**Cleanup on his live tenant.** Ten sign-ins as `superadmin@gmail.com` across
six scripted runs, plus page loads. One 8-row CSV of South-Indian dry goods was
posted to `/inventory/import/preview` twice (once at each width) to photograph
the preview screen; seven rows came back `new` and one — *Urad Dal* — matched
an item he already has, which is what produced the "already here and different"
row in the screenshot. `/inventory/import/preview` is documented and was
verified as read-only: *"WHAT WOULD HAPPEN. Writes nothing."* **The plan was
never committed** — `Add 7 · leave 1` was never clicked. Inventory read
`68 of 68` before the probe and `68 of 68` after. No AI endpoint was called:
the deterministic inventory parser matched the headers, so
`/assistant/read-any` never ran and nothing was spent. Nothing was created,
edited or deleted. Six temporary Playwright scripts were written under
`frontend/` and deleted; `git status` is clean of them.

---

## 1. What is actually wrong — "clumsy", named

"Clumsy" is not vagueness on his part. It is four specific, measurable
properties, and every one of them is visible in the two screenshots.

### 1.1 Four sibling surfaces, no parent

`d1440-setup.png` shows, top to bottom: a drop card (1110×168), four station
tiles (266×120 each), a naked sentence, and a hint strip (1110×44). **Six
objects, all children of the page, none of them containing another.** Nothing
on the screen tells you that the tiles are the *result* of the drop card, or
that the hint explains the drop card. The reader has to hold the relationship
in their head, and holding relationships in your head is what "splitted" feels
like from the inside.

The fix is structural and it is the single biggest one here: **one parent
object per step.** The stage is a tray; the question, the input and the preview
live inside it. Five steps, one shape.

### 1.2 No focal point, because the title loses on area

The title *Set up NIRAI* measures 559×36 ≈ **20,000 px²**. The paragraph block
under it plus the drop card's paragraph measures ≈1110×70 ≈ **78,000 px²** of
15–16px grey text. The heading is 1.9× the type size and **a quarter of the
ink**. The eye goes to mass before it goes to size, so the first thing you read
is a 150-character sentence.

Two fixes, both cheap: cap the measure at **54ch** (today's line is ~150
characters — nearly triple the comfortable maximum), and let the question be
the only thing on the screen set in the display face.

### 1.3 Equal weight everywhere

Four tiles, identical size, identical border, identical inset shadow, each
holding an emoji, a word and a number. `71 items` is set in **mono at 14px in
`text-fg-soft`** — the same weight as the caption under it. Nothing is
foreground. When everything is a box, a box means nothing, and the screen reads
as a control panel with no controls.

The tiles are also **120px tall around ~64px of content** — 47% air. That is
the "padding a thin thing to look busy" trap, and it shows.

### 1.4 The surfaces cannot separate, and the design system is why

This is the part that is not the page's fault. Measured from `lib/theme.tsx`
across all 22 themes:

| | shell | paper | contrast |
|---|---|---|---|
| chalk | `#ffffff` | `#ffffff` | **1.000** |
| claret (his) | `#f4eef0` | `#fef9fb` | 1.099 |
| every other theme | — | — | 1.078 – 1.132 |

And `.mise-card-inset` and `.mise-well` are **the same recipe**. In light mode
both are `color-mix(in srgb, #0f172a 4%, var(--color-paper))` with the same
inset shadow; the card just adds a radius and a hover. So a `mise-well` row
inside a `mise-card-inset` card — which is exactly what `ImportPlan.tsx` does,
and what the hint strip does on `/setup` — is **invisible as a nesting**. You
get a flat grey field with hairlines drawn on it.

> **Law 1. Structure comes from line, space and type weight. Never from fill.**
> There is no fill difference available on this product. Stop asking for one.

### 1.5 The preview is the phone layout, shown on a desktop

`SheetPopup` takes a `columns` prop that sizes the panel: `1` →
`max-w-[min(30rem,94vw)]`, `4` → `w-[min(72rem,95vw)]`. `setup/page.tsx` opens
the plan with **no `columns` prop at all**, so it defaults to 1 and the panel
renders at **352px on a 1440px screen** — measured, both widths, identical.

That is his "so much space wasted in right and left side" complaint at its
worst, on the one screen where a restaurant checks that its data arrived
correctly. **The component already supports the fix. The caller never asked.**

### 1.6 And inside that 352px

From `d1440-plan-open.png` and `ImportPlan.tsx`:

- Everything is 10px or 11px. `text-[11px]` ×6, `text-[10px]` ×2.
- The **188 new rows are the ones you actually want to check**, and they are
  collapsed inside a `<details>`, capped at 60, listed as bare names — **no
  unit, no category, no quantity, no supplier**. Seven items about to be
  created and you cannot see what they are.
- The column headers `what we have` / `your file says` sit **underneath** the
  values, at 10px. You read the data before you learn which column is which.
- The file's column is struck through by default. Logically correct ("keep
  ours"); visually it reads as *your file was rejected*.
- The summary sentence — the most important line in the popup, the one he
  checks against what he sent — is 14px regular grey, the least emphatic thing
  on screen.
- `bg-brand-600 text-white` on the commit button. On 8 of 22 themes that is
  below 4.5:1 (§14).

### 1.7 There is no match view at all

`_find_vendor` in `backend/app/inventory/router.py` resolves the supplier
column **at commit time**, and a miss is reported afterwards in `notes[:20]`.
So today you discover that your 200 items did not link to their suppliers
*after* the write, in at most twenty truncated sentences. The screen the user
asked for — *"match inventory items with the name in vendor (show preview like
this matched to this)"* — does not exist in any form.

### 1.8 Two fixed elements are sitting on the content

At 390 (`m390-setup.png`, `m390-setup-full.png`): the floating bottom nav
covers the **Menu** tile's title — you see `17 dishes` under a bar, with no
word saying what seventeen dishes are — and the mic FAB sits on the
**Suppliers** tile's right edge. Both are worse than untidy: a fixed element
over a control eats the tap, and the shell's own comment in `AppShell.tsx`
records that this exact class of bug was fixed on Employees and Inventory by
padding `<main>` to `pb-36`.

The cause here is that `/setup` lays out as ordinary page content and lets the
document scroll under two fixed objects. The fix is structural, not padding:

> **The bottom of a phone screen belongs to the tally, and to nothing else.**
> `Workbench`'s `mise-bench-tally` already rests at
> `bottom: var(--mise-tabbar)`, and its children get `pb-24 lg:pb-16` *above*
> it, never below. The mic FAB does not render on this route at all (§10.5).
> Nothing in the stage is `fixed`.

### 1.9 Two more, for the record

- **Cold-load theme.** Any hard navigation renders the chalk palette (pure
  white, pure black, `#0949a4`) whatever the hotel's theme is, and had not
  reconciled after 6s. It is app-wide, not an onboarding bug — but a new
  owner's *first ever page load* is an onboarding page, so the section that
  most needs to look like the brand is the one guaranteed not to. Worth a
  ticket on its own; §14 says how this spec survives it regardless.
- **Emoji as iconography.** 📦 🤝 🍲 🧑‍🍳 are the only colour on `/setup` and
  they render differently on every OS. They are also the only thing at the top
  of each tile, so the tile's identity is outsourced to a system font.

---

## 2. Five laws

1. **Structure from line, space and weight — never from fill.** (§1.4.)
2. **One parent object per step.** The stage is the parent; everything else is
   inside it. No sibling cards.
3. **A box means work.** A raised or bordered box is reserved for something
   that needs a decision. Rows that need nothing are ruled lines, not cards.
   This is what stops 200 rows becoming 200 boxes of equal weight.
4. **Every number carries its unit, in the same breath.** `25 kg`, never `25`.
   The unit is 12px `text-fg-faint` immediately after the figure, never on its
   own line, never in a header only.
5. **Nothing is disabled on arrival and nothing renders empty.** A blocked step
   is clickable and explains itself; an empty table shows ghost example rows
   (§9).

---

## 3. The frame — reuse `Workbench`, build no shell

`frontend/components/Workbench.tsx` already is this section's shell, and using
it is worth more than any new chrome I could design:

| Workbench slot | Onboarding uses it for |
|---|---|
| `title` | **The step's question**, set in `mise-bench-title` (24px display, condenses to 0.82 on scroll) |
| `subtitle` | `Step 2 of 5 · ` + the why-line, one sentence, collapses to 0 height on scroll |
| `action` | `Save & close` and the `⋯` overflow |
| `tools` | **The step bar** (§4) |
| `tally` | **The action bar** — the AI input and the primary button |
| `children` | The stage body: source strip, then preview |

What that buys, already built and already debugged: `data-bench` (so
`<main>` drops its padding and the rail can bleed full width), the sticky
condensing rail on one clock (`--bench-ms` / `--bench-ease`), the tally pinned
at `bottom: var(--mise-tabbar)` so it clears the phone's floating nav, and the
`-mx-4 lg:-mx-8` bleed that matches `<main>`'s padding exactly. Every one of
those is a bug this section would otherwise rediscover.

**No `max-w-*` anywhere on the page.** The old `/onboarding` was `max-w-xl` —
576px of content in a 1430px shell, 854px of empty page — and that is the
complaint he has made more than any other.

**No aside column unless it has two facts to show.** An empty right rail reads
as a broken component. The stage is full width; if a step ever gains a "what
this unlocks" panel, it takes 4 of 12 columns *and only renders when populated*.

### Height binding — the trap

> `flex-1` against a `display:block` parent is inert. It has cost this repo
> three attempts at one bug.

At `lg` the shell is `lg:h-screen lg:overflow-hidden lg:grid-cols-[16rem_1fr]`
and `<main>` is `lg:overflow-y-auto`, so it is a real scroll container and a
flex chain can bind to it. **Below `lg` the document scrolls** and there is
nothing to bind to. Therefore:

- **≥1024px:** the stage grows with content inside `<main>`'s scroller. The
  rail is sticky at `top-0`, the tally sticky at `bottom-0`.
- **<1024px:** the stage grows with content, the document scrolls, the rail is
  sticky at `top: var(--mise-topbar)` and the tally at
  `bottom: var(--mise-tabbar)` — both already handled by `mise-bench-rail` /
  `mise-bench-tally`.
- **Never `100vh`.** `100dvh` only. `100vh` on a phone includes the strip under
  the collapsing address bar and puts the bottom of the content out of reach.
- Whoever builds this **measures** the bound height with `page.evaluate` before
  claiming it works. "877px available, 486px reported" is how this failed last
  time.

### The one departure: no `PageHeader`

`PageHeader` renders `text-2xl sm:text-3xl` (30px). If the page carries both a
30px *"Onboarding"* and a 24px question, the chrome outshouts the content and
we are back to §1.2. So the page title is not a headline here — the sidebar
already says where you are. Above the rail, on the left:

```tsx
<p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-fg-faint">
  Setting up
</p>
```

11px, and that is all. The question is the only headline on the screen.

---

## 4. The stepper

### 4.1 The decision: horizontal, at every width, and **not a track**

**Not vertical.** At 1440 a 14rem vertical rail holding five items is ~700px of
empty column next to the 16rem sidebar — the exact fault he names. At 390 a
vertical stepper eats the whole first screen before you have done anything.

**Not a progress bar, and not a connected track.** A track exists to be partly
full, and a track that is 40% full is a shaming device for a restaurant that
did suppliers and stock in March and came back in June. So there is **no
connecting line at all**. The bar is one tray divided into five keys.

> Three lit keys and two unlit keys reads as *three things done*.
> A bar 60% full reads as *40% failed*. Same data, opposite feeling.

State lives in each segment on its own: a 2px rule across the **top of that
segment only**, a mark, and a count. There is no percentage anywhere in this
section, no ring, no "3/5 complete" with a fill.

### 4.2 Desktop (≥640px) — five keys on one tray

72px tall. Equal fifths. Divided by `divide-x divide-line`, so the division is
a hairline, not a gap — one instrument, not five cards (Law 2).

```tsx
const SEG: Record<StepState, string> = {
  current: "bg-glass/[0.05]",
  done:    "hover:bg-glass/[0.03]",
  todo:    "hover:bg-glass/[0.03]",
  draft:   "hover:bg-glass/[0.03]",
  skipped: "opacity-70 hover:bg-glass/[0.03] hover:opacity-100",
  blocked: "hover:bg-glass/[0.03]",
};
const RULE: Record<StepState, string> = {
  current: "bg-brand-500",
  done:    "mise-bg-good",
  draft:   "mise-bg-warn",
  todo:    "bg-transparent",
  skipped: "bg-transparent",
  blocked: "bg-transparent",
};

<nav aria-label="Setup steps"
     className="mise-card-inset hidden grid-cols-5 divide-x divide-line
                overflow-hidden rounded-2xl sm:grid">
  {steps.map((s, i) => (
    <button key={s.key} type="button" onClick={() => go(s.key)}
      aria-current={s.state === "current" ? "step" : undefined}
      className={`mise-press relative flex min-h-[4.5rem] flex-col justify-center
                  gap-1 px-4 py-3 text-left transition-colors ${SEG[s.state]}`}>
      <span aria-hidden
        className={`absolute inset-x-0 top-0 h-[2px] ${RULE[s.state]}`} />
      <span className="flex items-center gap-2">
        <StepMark state={s.state} n={i + 1} />
        <span className={`truncate text-[0.875rem] ${
          s.state === "current" ? "font-semibold text-fg" : "font-medium text-fg-soft"
        }`}>{s.title}</span>
      </span>
      <span className="pl-[1.875rem] truncate text-[0.75rem] tabular-nums text-fg-faint">
        {s.hint}
      </span>
    </button>
  ))}
</nav>
```

`StepMark` — a 22px circle, always the same 22px, so nothing reflows when a
step completes:

| state | mark | recipe |
|---|---|---|
| `done` | tick | `grid h-[1.375rem] w-[1.375rem] place-items-center rounded-full border` + `background: color-mix(in srgb, var(--tone-good) 18%, transparent)`, border `…45%`; inside a 12px `<svg className="mise-tick">` stroked `currentColor` with `.mise-tone-good` |
| `current` | numeral | `bg-brand-600 text-[0.6875rem] font-bold` + `.mise-btn-ink` (§14) + `ring-2 ring-brand-500/25` |
| `todo` | numeral | `border border-line-2 text-[0.6875rem] font-semibold text-fg-faint` |
| `draft` | 7px dot | `border border-line-2` + inner `h-[7px] w-[7px] rounded-full mise-bg-warn` |
| `skipped` | en-dash | `border border-dashed border-line-2 text-fg-faint` |
| `blocked` | numeral | same as `todo`. **Never greyed out, never a lock.** |

Hint line, 12px, `tabular-nums`, this exact copy:

```
done     6 suppliers          ← the count, with its noun. Law 4.
current  nothing yet   |  63 waiting   ← draft count if there is one
todo     none yet
skipped  skipped
blocked  needs dishes first
```

No "0 suppliers". Zero written as a digit is a score; "none yet" is a state.

### 4.3 390px — five pips and one label

Five 78px labels are unreadable and a sideways scroller is not acceptable. One
row, 56px tall, the whole thing a single 44px+ tap target that opens the step
sheet. Click, not scroll.

```tsx
<button type="button" onClick={openStepSheet}
  className="mise-card-inset mise-press flex min-h-[3.5rem] w-full items-center
             justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left sm:hidden">
  <span className="flex min-w-0 flex-col">
    <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-fg-faint">
      Step 2 of 5
    </span>
    <span className="truncate text-[0.9375rem] font-semibold text-fg">Stock</span>
  </span>
  <span aria-hidden className="flex shrink-0 items-center gap-1.5">
    {/* done */}    <i className="block h-2 w-2 rounded-full mise-bg-good" />
    {/* current */} <i className="block h-2 w-[1.125rem] rounded-full bg-brand-500" />
    {/* todo */}    <i className="block h-2 w-2 rounded-full bg-glass/25" />
    {/* skipped */} <i className="block h-2 w-2 rounded-full border border-line-2" />
  </span>
</button>
```

The current pip is a **stadium, not a bigger dot** — width is the cue, so the
row's rhythm does not jump when you move between steps. `bg-glass/25` for
`todo` rather than `bg-line-2`: `--color-glass` is white on dark themes and the
foreground colour on light ones, so it is grey in both, and it is an idiom the
codebase already exercises (`even:bg-glass/[0.02]` on the inventory table).
`bg-line-2` would work too but has zero occurrences in the repo, and an untested
utility is not what a stepper should be the first to try. Tap opens a
`SheetPopup` listing the five as 56px rows, each with its mark, title and hint
line from §4.2. Tapping a row switches step and closes.

### 4.4 The one celebration in the entire flow

When the fifth step completes, the five top rules draw left to right as a
single brand-coloured line, once, 600ms, then settle back to their own colours.
No confetti, no burst, no sound, no mascot. This is a work tool and he will see
this screen more than once.

---

## 5. Type scale

Six sizes. Today's page uses 30 / 16 / 15 / 14 / 11 / 10 with no ratio between
them; this is a 1.2 scale with one display step on top.

| Role | Class | px |
|---|---|---|
| **The question** (rail title) | `mise-bench-title font-display font-semibold text-fg` (24px, `-0.02em`, set by `globals.css`) | 24 |
| Why-line (rail subtitle) | `text-sm text-fg-faint sm:truncate` capped `max-w-[54ch]` | 14 |
| Result headline | `font-display text-[1.375rem] font-semibold tracking-tight text-fg` | 22 |
| Body / prose | `text-[0.9375rem] leading-[1.6] text-fg-soft max-w-[54ch]` | 15 |
| Row primary, buttons, inputs | `text-[0.875rem] font-medium` | 14 |
| Column head, unit, secondary | `text-[0.75rem] text-fg-faint` | 12 |
| Region label | `text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-fg-faint` | 11 |

**Rules**

- **Nothing below 11px, and 11px only for the uppercase region label.** Every
  `text-[10px]` in `ImportPlan.tsx` goes. An 11px lower-case sentence carrying
  real information — today's hint strip — is a legal footer, and people read it
  as one.
- **54ch, everywhere prose appears.** Measured today: 150 characters per line.
- **One display-face element per screen.** The question. `font-display`
  (Fraunces) appears nowhere else in the stage.
- **Numbers are `tabular-nums`, always**, so a column of counts does not
  shimmer as it updates.
- The three text levels do all the work: `text-fg` for the thing itself,
  `text-fg-soft` for prose, `text-fg-faint` for labels, units and metadata. No
  fourth level, no opacity modifiers on text.

### Hierarchy inside one step, in order of ink

1. the question (24px display, dark)
2. the primary action in the pinned tally (brand fill)
3. the rows that need a decision (a box + a warn spine)
4. everything else (14/12px, ruled, `fg-soft`/`fg-faint`)

If an element is not in that list it does not get emphasis.

---

## 6. Spacing and density

**Base 4. Permitted steps: 4, 8, 12, 16, 24, 32, 48.** Banned: `p-5` (20px),
`gap-2.5`, `mt-0.5` as a layout gap. Today's `/setup` uses nine different
values in 40 lines of JSX, and inconsistent density is half of what "clumsy"
means.

| | <1024px | ≥1024px |
|---|---|---|
| Page gutters | `px-4` (from `<main>`) | `px-8` |
| Between page blocks | `space-y-4` | `space-y-6` |
| Tray padding | `p-4` | `p-6` |
| Row padding | `px-4 py-3` | `px-4 py-2.5` |
| Chip/button gap | `gap-2` | `gap-2` |
| Preview row height | 64px (two lines) | **40px (one line)** |
| Step bar | 56px | 72px |
| Action bar | 56px + safe-area | 64px |
| Tap-target floor | **44px** | 32px |

**Content drives height.** No `min-h` on a card to make it look substantial.
The station tiles are 120px around 64px of content today and it shows. If a
step's idle state is 300px tall, the stage is 300px tall and the page ends.

**Target:** every step fits one screen at 390 in its idle state. The current
page needs 1.6.

---

## 7. The mapping screen — one row per HIS column

The flow spec's §4.3. Visually this is the hardest screen in the section,
because it is the one screen where the product asks the user to do work *for*
it, and the only thing that makes that acceptable is that it is instantly
self-evident.

### 7.1 It is the stage, full width — never a modal

Six columns is six rows. At 64px a row that is 384px plus a 36px header, so it
fits at 1280×800 with the rail and tally and still has room under it. (At 390
it is six stacked cards and it does not fit — one thumb-scroll, §7.6. I am not
going to claim otherwise; six decisions is six decisions.) Putting it in a
`SheetPopup` would repeat §1.5 — the densest screen in the narrowest box.

### 7.2 A three-column grid, and the middle column is the whole design

```
Your column          The first rows say                     Use it as
─────────────────────────────────────────────────────────────────────────────
▍Item Name           Basmati Rice · Paneer · Chicken thigh  [ Name (required) ▾ ] guessed
 Category            Dry Goods · Dairy · Meat               [ Category ▾ ]
 Unit                kg · kg · kg                           [ Unit (required) ▾ ]
 Quantity            25 · 10 · 8                            [ Opening stock ▾ ]
 Unit Cost           1.80 · 5.40 · 4.10                     [ Don't use this ▾ ]
                     ↳ Prices come from the supplier's price list, not the
                       stock sheet.
 Supplier            Local Supplier · — · Fresh Foods       [ Supplier ▾ ]
```

**The sample values are the largest thing in the row after the heading**, and
that is deliberate: he is matching *Basmati Rice* to *Name*, not matching two
abstract words. They get 14px `text-fg-soft`; the picker is 14px; only the
column heading is `font-semibold text-fg`.

```tsx
const MAP_COLS = "lg:grid-cols-[14rem_minmax(0,1fr)_16rem]";

<div role="table" className="overflow-hidden rounded-2xl border border-line">
  <div role="row" className={`hidden border-b border-line bg-shell/95 px-4 py-2
                              lg:grid ${MAP_COLS} gap-4`}>
    <span className="text-[0.75rem] font-medium text-fg-faint">Your column</span>
    <span className="text-[0.75rem] font-medium text-fg-faint">The first rows say</span>
    <span className="text-[0.75rem] font-medium text-fg-faint">Use it as</span>
  </div>

  <div role="row"
       className={`mise-spine ${needsYou ? "mise-spine-warn" : "mise-spine-none"}
                   grid min-h-[4rem] items-center gap-2 border-b border-line/60
                   px-4 py-3 even:bg-glass/[0.02] lg:gap-4 ${MAP_COLS}`}>
    <span className="truncate font-mono text-[0.875rem] font-semibold text-fg">
      Item Name
    </span>
    <span className="truncate text-[0.875rem] text-fg-soft">
      Basmati&nbsp;Rice <Dot/> Paneer <Dot/> Chicken&nbsp;thigh
    </span>
    <span className="flex items-center gap-2">
      <FieldPicker value="name" />
      {guessed && <span className="mise-chip shrink-0" data-tone="amber">guessed</span>}
    </span>
  </div>
</div>
```

Four specifics:

- **The column heading is `font-mono`.** It is a quotation from his file, not
  our words, and the mono face says so without a label. It is the only mono in
  the section (today's station tiles use mono for counts, which is the wrong
  place for it — a count is our number, not his text).
- **Three sample values, truncated at 24 characters, joined by a 4px
  `text-fg-faint` middot** — `<Dot/>` is
  `<span aria-hidden className="mx-1.5 text-fg-faint">·</span>`. An empty cell
  renders as `—` in `text-fg-faint`, not as a gap: a gap looks like a bug.
- **`guessed` is an amber chip, and only on a guess.** An exact or alias hit
  gets no chip at all. Chipping all six would tell him to check all six; the
  point is to tell him which two.
- **The "why not" line is part of the row, indented under the picker**,
  `text-[0.75rem] text-fg-faint` with a `↳`, `pl-4`. It appears only for
  `Don't use this column` on a field we deliberately refuse (price, calculated
  cost). It is the money law stated where somebody hits it, and it must not be
  a tooltip — a tooltip on a phone is nothing.

### 7.3 The picker is a button that opens a popup, not a `<select>`

A native `<select>` cannot show the field's own sample values or the reason a
column is refused, and on iOS it is a wheel. So:

```tsx
<button type="button" onClick={open}
  className="mise-well mise-press flex min-h-[2.75rem] w-full items-center
             justify-between gap-2 rounded-xl px-3 text-left text-[0.875rem]
             text-fg lg:min-h-[2.5rem]">
  <span className="truncate">Name <span className="text-fg-faint">(required)</span></span>
  <span aria-hidden className="shrink-0 text-fg-faint">▾</span>
</button>
```

`mise-well` is correct here — this is an input, which is the one thing
`mise-well` is for (§14.2b). The popup is a depth-2 `SheetPopup` listing our
fields with *their* sample values, plus `Don't use this column` last, separated
by a rule.

### 7.4 The primary button is never disabled

> A control that is disabled on arrival reads as broken.

| state | label | on press |
|---|---|---|
| ready | `Preview 63 rows` | goes |
| a required field unmapped | `Name is still missing` | scrolls that row into view, moves focus to its picker, and flashes the row |

Same size, same position, same fill in both states — `mise-btn-primary`. The
"missing" state is **not** greyed and **not** red; it is the same button
telling you what it is waiting for. The flash is the existing `mise-shake`
keyframe plus a 900ms `mise-spine-warn` on that row, and the explanation
appears under the picker in `text-danger` (which is already theme-correct:
`#be123c` pinned on light, mixed toward `fg` on dark).

### 7.5 The error above it, always

The mapper only opens because something failed, so the failure is stated above
it in a `mise-card-inset` strip with a `mise-spine-warn`, 15px:

> **This doesn't look like a stock list yet.**
> I need a column with the item's **name**, and I couldn't find one. Your file
> has: `Item Name`, `Category`, `Unit`, `Quantity`, `Unit Cost`, `Supplier`.

His column names inside that sentence are `font-mono text-[0.8125rem]` — the
same quotation convention as the table, so the eye connects the sentence to
the rows under it.

The "or is this a suppliers list?" offer is a second line in the same strip,
never a separate card, and its button is `mise-well` — it is an alternative,
not the recommendation.

### 7.6 At 390 — stacked cards, one per column

```
┌──────────────────────────────┐
│ Item Name            guessed │  ← mono heading + chip, 12px gap
│ Basmati Rice · Paneer ·      │  ← 14px fg-soft, wraps to 2 lines max
│ Chicken thigh                │
│ [ Name (required)        ▾ ] │  ← full-width, 44px
└──────────────────────────────┘
```

`mise-card-inset rounded-xl p-3 space-y-2`, 8px between cards. **This is the
one place cards are right at 390 even though no decision is pending** — every
row here *is* a decision by definition, so Law 3 holds. Six cards ≈ 700px, one
scroll of the thumb, and the primary stays pinned in the tally.

### 7.7 "Read using the layout you set on 14 Sep"

When a remembered mapping is used, the mapper does not open. One line sits
above the preview, 12px, `text-fg-faint`, with the escape as a text link:

```tsx
<p className="px-1 pb-2 text-[0.75rem] text-fg-faint">
  Read using the layout you set on 14 Sep.{" "}
  <button className="mise-press text-fg-soft underline underline-offset-4">
    Change columns
  </button>
</p>
```

Not a chip, not a banner, not dismissible. It is provenance, and provenance
belongs in the quietest type on the screen — until you need it, at which point
it is the only underlined thing there.

---

## 8. The preview

This is where he spends his time and where today's design is weakest. Four
decisions.

### 8.1 It is not a popup during the flow

Inside the five-step flow the plan **is** the step's content, in the stage, at
full width. A popup over a page you have never used is a second surface
competing with the first — §1.1 again.

Outside the flow (he drops a file on the finished section, or on any list
page), the same component opens in `SheetPopup` **with `columns={4}`** →
`w-[min(72rem,95vw)]`. That is 1152px at 1440 against today's 352px. One prop.

### 8.2 A CSS grid with ARIA roles, not a `<table>`

One component, both widths, same DOM: at `lg` it is a grid of columns; at 390
each row's cells stack. That makes mobile parity structural rather than a
second implementation, and it makes sticky group headers and virtualisation
straightforward. Roles keep it a table for a screen reader.

Column templates are **literal strings in a const map**, one per step —
`grid-cols-[…]` assembled at runtime emits no CSS.

```ts
const COLS: Record<StepKey, string> = {
  vendors:   "lg:grid-cols-[minmax(0,1fr)_10rem_12rem_8rem]",
  items:     "lg:grid-cols-[minmax(0,1fr)_4.5rem_8rem_7rem_13rem]",
  employees: "lg:grid-cols-[minmax(0,1fr)_9rem_10rem]",
  menu:      "lg:grid-cols-[minmax(0,1fr)_9rem_5rem_6rem]",
  recipes:   "lg:grid-cols-[minmax(0,1fr)_6rem_7rem]",
};
```

### 8.3 Verdict chips are the filter, and the default view is the work

Above the list, four chips. They are the summary **and** the control. Default
selection: `needs you` when there is anything to decide, otherwise `all`.

> **This is the answer to "I hate scrolling" on a 200-row import.** The first
> screen shows 4 rows, not 203. The rest is one tap away.

```tsx
<div className="flex flex-wrap items-center gap-2 pb-3">
  <Chip tone="amber" n={4}   on={f==="todo"}  onClick={…}>need you</Chip>
  <Chip tone="green" n={188} on={f==="new"}   onClick={…}>new</Chip>
  <Chip tone="slate" n={8}   on={f==="same"}  onClick={…}>already here</Chip>
  <Chip tone="red"   n={3}   on={f==="bad"}   onClick={…}>couldn&apos;t read</Chip>
  <span className="ml-auto text-[0.75rem] text-fg-faint">from stock-list.csv · 203 rows</span>
</div>
```

```tsx
// Chip — mise-chip carries the theme-safe tone; the tap size is added here.
<button type="button" aria-pressed={on} onClick={onClick}
  className={`mise-chip mise-press min-h-[2.25rem] gap-1.5 px-3 text-[0.8125rem]
              lg:min-h-[2rem] ${on ? "ring-2 ring-brand-500/30" : ""}`}
  data-tone={tone}>
  <b className="tabular-nums">{n}</b> {children}
</button>
```

A chip with `0` is **not rendered**. A row of zeroes is how a good import looks
like a failure.

### 8.4 The rows

Ruled, not boxed — except rows that need a decision, which get a box (Law 3).

```tsx
{/* the tray */}
<div role="table" aria-label="What will be imported"
     className="overflow-hidden rounded-2xl border border-line">

  {/* sticky column head */}
  <div role="row"
       className={`sticky top-0 z-10 hidden border-b border-line bg-shell/95
                   px-4 py-2 backdrop-blur-sm lg:grid ${COLS.items} gap-3`}>
    <span role="columnheader" className="text-[0.75rem] font-medium text-fg-faint">Item</span>
    <span role="columnheader" className="text-[0.75rem] font-medium text-fg-faint">Unit</span>
    <span role="columnheader" className="text-[0.75rem] font-medium text-fg-faint">Category</span>
    <span role="columnheader" className="text-right text-[0.75rem] font-medium text-fg-faint">In stock</span>
    <span role="columnheader" className="text-[0.75rem] font-medium text-fg-faint">Supplier</span>
  </div>

  {/* group header, sticky under the column head */}
  <div role="rowgroup"
       className="sticky top-[2.375rem] z-[9] border-y border-line bg-shell/95
                  px-4 py-1.5 backdrop-blur-sm">
    <span className="text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-fg-faint">
      New — 188 items
    </span>
  </div>

  {/* a row that needs nothing: a rule, a spine, no box */}
  <div role="row"
       className={`mise-spine mise-spine-good grid gap-1 border-b border-line/60
                   px-4 py-3 even:bg-glass/[0.02] hover:bg-glass/[0.05]
                   lg:gap-3 lg:py-2.5 ${COLS.items}`}>
    <span role="cell" className="truncate text-[0.875rem] font-medium text-fg">Basmati Rice</span>
    <span role="cell" className="text-[0.875rem] text-fg-soft">kg</span>
    <span role="cell" className="truncate text-[0.875rem] text-fg-soft">Dry Goods</span>
    <span role="cell" className="text-right text-[0.875rem] tabular-nums text-fg">
      25<span className="ml-1 text-[0.75rem] text-fg-faint">kg</span>
    </span>
    <span role="cell" className="truncate text-[0.875rem] text-fg-soft">
      Fresh Farms <span className="mise-tone-good" aria-label="matched">✓</span>
    </span>
  </div>
</div>
```

**Group order: work first, reassurance last.** `need you` → `couldn't read` →
`new` → `already here, unchanged`.

**No truncation, ever.** `ImportPlan` today shows 60 of 188 and then "…and 128
more". If the list is long, virtualise it; do not hide it. The whole purpose of
this screen is *"he can compare it against what he sent — if he pasted forty
suppliers and this says sixty, something invented twenty"*, and you cannot
compare against a list that stops.

### 8.5 The rows that need a decision — the only boxes

```tsx
<div role="row"
     className="mise-spine mise-spine-warn mise-card-inset m-2 grid gap-2
                rounded-xl p-3 lg:p-4">
  <div className="flex flex-wrap items-baseline justify-between gap-2">
    <span className="text-[0.9375rem] font-semibold text-fg">Urad Dal</span>
    <span className="flex gap-1">
      <Choice on={!take}>Keep ours</Choice>
      <Choice on={take}>Use the file</Choice>
    </span>
  </div>

  {/* headers ABOVE the values, not below */}
  <dl className="grid gap-1">
    <div className="grid grid-cols-[6.5rem_1fr_1fr] gap-3">
      <span />
      <span className="text-[0.75rem] font-medium text-fg-faint">what we have</span>
      <span className="text-[0.75rem] font-medium text-fg-faint">your file says</span>
    </div>
    <div className="grid grid-cols-[6.5rem_1fr_1fr] gap-3 text-[0.8125rem]">
      <dt className="truncate text-fg-faint">Unit</dt>
      <dd className={take ? "text-fg-faint line-through" : "font-medium text-fg"}>kg</dd>
      <dd className={take ? "font-medium text-fg" : "text-fg-faint line-through"}>L</dd>
    </div>
  </dl>
</div>
```

Three changes from today, each with a reason:

1. **Headers above the values.** You cannot read a diff whose legend is
   underneath it.
2. **The chosen side is `font-medium text-fg`; the other is faint + struck.**
   Today both sides are the same weight and only the strike distinguishes them,
   which at 11px is a hairline.
3. **The row is a box.** It is the only kind of row that is, and that is now a
   signal rather than decoration.

`Choice` keeps its current shape, with the ink fixed:
`on ? "bg-brand-600 mise-btn-ink" : "mise-well text-fg-soft"`, `min-h-[2rem]`,
`lg:min-h-[1.75rem]`.

### 8.6 390px — what replaces the table

Not a table, not a sideways scroller, and **not 200 cards**.

```
┌──────────────────────────────┐
│ [4 need you] [188 new]       │   two rows of chips, 36px tall
│ [8 here]     [3 unread]      │   tapping one FILTERS the list below
├──────────────────────────────┤
│ Urad Dal                     │   ← a decision: a box, 3 lines
│ kg → L · Pulses → Dry Goods  │
│ [  Keep ours  |  Use file  ] │   full-width segmented, 44px
├──────────────────────────────┤
│ Basmati Rice          25 kg  │   ← no decision: a rule, 2 lines, 64px
│ Dry Goods · Fresh Farms ✓    │
├──────────────────────────────┤
```

Row recipe at 390 (the same DOM as §8.4 — the `lg:grid-cols-*` simply does not
apply, so the cells stack):

```tsx
<div role="row" className="mise-spine mise-spine-good grid grid-cols-[1fr_auto]
     gap-x-3 gap-y-0.5 border-b border-line/60 px-4 py-3">
  <span className="truncate text-[0.9375rem] font-medium text-fg">Basmati Rice</span>
  <span className="text-right text-[0.9375rem] tabular-nums text-fg">
    25<span className="ml-1 text-[0.75rem] text-fg-faint">kg</span>
  </span>
  <span className="col-span-2 truncate text-[0.75rem] text-fg-faint">
    Dry Goods · Fresh Farms
  </span>
</div>
```

64px per row, no horizontal scroll at any width, and the quantity keeps its
unit. Compare the app's own mobile inventory card at 135px — half the height,
because a preview is read, not operated.

---

## 9. The vendor ↔ item match view

The hard part: *"Rice → Local Supplier"* for 200 rows without a wall.

### 9.1 Do not draw 200 arrows. Group by the few side.

The relationship is many-to-one. 200 items land on 5–15 suppliers. Draw the
**suppliers**, with their catch:

```
┌ Suppliers this list points at ───────────────────────────── 203 items ─┐
│ ▍Sunrise Foods   [not one of your suppliers] ·········  12 items       │
│    [ Add as a new supplier ]  [ Match to an existing one ]  Leave blank│
│ ▍Local Market → Local Supplier?  looks like a typo ····   8 items      │
│    [ Yes, that's it ]  [ Pick another ]                                │
│  Fresh Farms ······································  96 items  ▸      │
│  Exotic ···········································  61 items  ▸      │
│  Farm2Land ········································  15 items  ▸      │
│  No supplier yet ··································  11 items  ▸      │
└────────────────────────────────────────────────────────────────────────┘
```

**Six rows instead of two hundred.** Two of them need work and they are at the
top with their controls already open — a control you have to discover is a
control nobody uses. The four that are fine are one line each and collapsed.

The dotted leader is the `/vendors` page's own idiom
(`d1440-vendors.png`), so this reads as part of the product:

```tsx
<li className="mise-spine mise-spine-warn border-b border-line/60">
  <button type="button" onClick={toggle}
    className="mise-press flex w-full items-center gap-3 px-4 py-3 text-left">
    <span className="shrink-0 text-[0.875rem] font-medium text-fg">Sunrise Foods</span>
    <span className="mise-chip shrink-0" data-tone="amber">not one of your suppliers</span>
    <span aria-hidden className="mx-1 h-px min-w-6 flex-1 border-b border-dotted border-line-2" />
    <span className="shrink-0 text-[0.875rem] tabular-nums text-fg">
      12<span className="ml-1 text-[0.75rem] text-fg-faint">items</span>
    </span>
  </button>

  <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-7">
    <button className="mise-btn-primary mise-press min-h-[2.25rem] rounded-lg px-3
                       text-[0.8125rem] font-semibold">Add as a new supplier</button>
    <button className="mise-well mise-press min-h-[2.25rem] rounded-lg px-3
                       text-[0.8125rem] text-fg-soft">Match to an existing one</button>
    <button className="mise-press min-h-[2.25rem] px-2 text-[0.8125rem] text-fg-faint
                       underline-offset-4 hover:underline">Leave blank</button>
  </div>
</li>
```

Expanding a matched supplier reveals its items as name chips — 18 of them (≈3
lines), then `+78 more` which opens the preview filtered to that supplier:

```tsx
<div className="flex flex-wrap gap-1.5 px-4 pb-3 pl-7">
  {names.slice(0, 18).map((n) => (
    <span key={n} className="mise-chip" data-tone="slate">{n}</span>
  ))}
  {rest > 0 && (
    <button className="mise-chip mise-press" data-tone="sky">+{rest} more</button>
  )}
</div>
```

### 9.2 Per-row, in the preview: one cell, four states

The supplier column in §8.4 carries the state inline so it is visible while
reading the list, not only in the panel above.

| state | cell renders | ink |
|---|---|---|
| `matched` | `Fresh Farms ✓` | name `text-fg-soft`, tick `mise-tone-good` |
| `suggested` | `Local Market → Local Supplier?` | arrow + target `mise-tone-warn`, `Yes` / `Pick another` inline at 13px |
| `unknown` | `Sunrise Foods` + amber chip `new supplier` | `mise-tone-warn` chip |
| `blank` | `— add later` | `text-fg-faint`. **Not an error, not a warning.** Plenty of items have no supplier. |

**Confidence is a word, never a percentage.** "looks like a typo", not "87%
match". A percentage invites arguing with the number instead of looking at the
two names.

**Never a red column.** If step 1 was skipped there are no suppliers to match
against, and a column of 200 failures reads as the product being broken. One
line above the table instead, and the column does not render.

### 9.3 The depth-2 picker, and "apply to all 12"

Tapping a supplier cell opens `SheetPopup depth={2} columns={2}` — 40rem wide,
sitting over the preview with a rim of it visible at the edge, which is what
tells you the list is still there. It keeps its `←`.

The layout is a search field, a radio list, then — separated by a full rule —
the two escapes and the multiplier. That order matters: the multiplier is the
most powerful control in this section and the most dangerous, so it must be
read *after* the choice has been made, not before.

```tsx
{/* the multiplier — below the rule, above the save */}
<label className="mise-well mise-press flex min-h-[3rem] cursor-pointer items-center
                  gap-3 rounded-xl px-3 py-2.5">
  <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand-600)]" />
  <span className="text-[0.875rem] text-fg">
    Apply to all <b className="tabular-nums">12</b> rows that say
    <span className="ml-1 font-mono text-[0.8125rem] text-fg-soft">Local Market</span>
  </span>
</label>
```

- **The count is bold and `tabular-nums`; the matched value is `font-mono`.**
  Same convention as §7 — mono means *this is a quotation from your file*.
- It is **unticked on arrival** and the sheet's primary reads `Save` when
  unticked and `Change 12 rows` when ticked. The button label is the only
  place the consequence is stated as a number, and it changes live.
- If it is ticked, closing the sheet puts a banner above the table:
  `12 rows changed: Local Market → Local Supplier.` + `Undo`, styled as §10.3.
  A bulk change with no visible receipt is the thing people cannot trust.
- Never a "select all" checkbox in the table itself. A checkbox column on 203
  rows is 203 more targets and one mis-tap away from a change nobody chose;
  the multiplier is scoped to a value he has just looked at, which is the safe
  version of the same power.

### 9.4 At 390

The panel becomes one tappable summary row — `Suppliers · 2 need a look ▸` —
opening a `SheetPopup` containing exactly the list above at full width. Tiles
open popups; click, don't scroll. The per-row supplier stays as line 2 of the
card (§8.6), and tapping it opens the same depth-2 picker with its `←` intact.

---

## 10. The AI revision bar

The flow spec's §6. It is **pinned to the bottom of the preview it edits** —
not a floating bubble, not a side rail. Visually this is the most important
placement decision in the section, so the design has to earn it:

> Adjacency *is* the affordance. A thing attached to the bottom of a table
> reads as "this edits the table". The same input floating 24px off the
> bottom-right corner reads as "chat", and chat is a place you go to ask, not
> a tool you use on what is in front of you.

### 10.1 It lives in `Workbench`'s `tally`, beside the primary

The tally is already `sticky`, already full-bleed, already offset by
`var(--mise-tabbar)` on a phone. One row at ≥640px, two at 390.

```tsx
<div className="flex items-center gap-3">
  <div className="mise-well flex min-w-0 flex-1 items-center gap-2 rounded-xl
                  px-3 py-2 focus-within:ring-0">
    <span aria-hidden className="shrink-0 text-fg-faint">✨</span>
    <input
      className="min-w-0 flex-1 bg-transparent text-[0.875rem] text-fg
                 placeholder:text-fg-faint focus:outline-none"
      placeholder='Tell me what to change — e.g. "change all Local Market to Local Supplier"' />
    <kbd className="hidden shrink-0 rounded border border-line px-1.5 py-0.5
                    text-[0.6875rem] text-fg-faint sm:block">↵</kbd>
  </div>
  <button className="mise-btn-primary mise-press shrink-0 rounded-xl px-4 py-2.5
                     text-[0.875rem] font-semibold">
    Add 188 · leave 8
  </button>
</div>
```

`mise-well` already has `:focus-within` in `globals.css` — a brand border plus
a 3px brand ring at 18%. That is the entire focus treatment; do not add a
second one.

**The placeholder quotes a real value from the data on screen.** A generic
"Ask me anything" teaches nothing; `change all Local Market to Local Supplier`
teaches the whole grammar in one line, and it is a sentence he could actually
mean.

### 10.2 Thinking — the table does not move and does not grey

```tsx
{/* the input goes read-only; the typed text STAYS */}
<div className="mise-well flex min-w-0 flex-1 flex-col gap-1 rounded-xl px-3 py-2">
  <div className="flex items-center gap-2">
    <span className="mise-readrail w-4 shrink-0 rounded-full" aria-hidden />
    <span className="truncate text-[0.875rem] text-fg-soft">
      change all Local Market to Local Supplier
    </span>
  </div>
  <div className="flex items-center gap-2 text-[0.75rem] text-fg-faint">
    <span>Working through <b className="tabular-nums text-fg-soft">63</b> rows…</span>
    <button className="mise-press text-fg-soft underline underline-offset-4">Stop</button>
  </div>
</div>
```

- **The typed text never clears.** If it fails he edits and resends; retyping
  a 60-character instruction is the difference between using this feature
  twice and using it once.
- **No overlay, no opacity drop on the table, no skeleton.** He is reading the
  rows while it works — that is the reason the bar is attached to them.
- Over 15s the second line becomes `Still going — long lists take a moment.`
  Same position, same size. Nothing appears or disappears; a word changes.

### 10.3 The receipt banner

Above the table, never over it, never a toast. A toast for a 12-row change is
a receipt that self-destructs.

```tsx
<div className="mise-spine mise-spine-good mise-card-inset mb-3 flex flex-wrap
                items-center gap-x-3 gap-y-2 rounded-xl px-4 py-2.5">
  <span className="text-[0.875rem] text-fg">
    <b>I changed 12 rows.</b>{" "}
    <span className="text-fg-soft">
      Supplier <span className="font-mono text-[0.8125rem]">Local Market</span>
      {" → "}<span className="font-mono text-[0.8125rem]">Local Supplier</span>
    </span>
  </span>
  <span className="ml-auto flex shrink-0 gap-2">
    <button className="mise-well mise-press min-h-[2rem] rounded-lg px-3 text-[0.8125rem]">
      Show the 12
    </button>
    <button className="mise-press min-h-[2rem] px-2 text-[0.8125rem] text-fg-soft
                       underline underline-offset-4">
      Undo “Local Market → Local Supplier”
    </button>
  </span>
</div>
```

**`Undo` is text, not a button with a fill.** A filled Undo invites pressing;
this one has to be findable, not tempting. It names what it undoes, because a
stack of ten anonymous Undos is a stack you stop trusting after the second.

Edited cells get one mark, shared with manual edits — a 5px brand dot at the
cell's top-left, `absolute -left-1 top-1 h-1.5 w-1.5 rounded-full bg-brand-500`
on a `relative` cell. One vocabulary, not two.

### 10.4 When it is wrong — the visual grammar for the five cases

All five render **in the bar, above the input, in the same 15px**, and the
table is untouched. No colour on the ones that are merely unhelpful; the tone
is reserved for the one that would have been expensive.

| Case | Surface | Tone |
|---|---|---|
| matched nothing | one line + real values from the column as `mise-chip[data-tone=slate]` buttons | none |
| didn't understand | one line + three example instructions as chips built from *this* list's columns | none |
| too big (>25% of rows) | a `mise-spine-warn` strip with the first 5 rows listed, then `Apply to 48 rows` / `Cancel` | warn |
| asked a question back | one line, input stays live and focused | none |
| unavailable (429/503) | one line, `Try again` as `mise-well` | none |
| invented rows | `mise-spine-bad` strip, refused wholesale | bad |

The chips are the point. `[ Local Mart ] [ Localmarket Ltd ]` is a repair you
can tap; "no matches found" is a dead end with good manners.

### 10.5 The floating voice bubble is hidden on this route

Measured on the live page: the mic FAB sits on top of the Suppliers tile at
390 (`m390-setup.png`). There is now a full-width AI input on this screen, so a
second floating one is both redundant and an overlap bug. `VoiceBubble`
returns `null` on `/onboarding`.

---

## 11. Motion

Restrained. A work tool. Every rule below has a `prefers-reduced-motion`
answer, and every new keyframe ships with its own reduce block in the same
section of `globals.css` — the file's existing convention.

| Moment | What moves | Duration | How |
|---|---|---|---|
| Step change | **the stage body only.** The rail and the step bar do not move — they are the fixed furniture that makes five steps feel like one screen. | 140ms | `key={step}` + `mise-fade-in` with `translate-y-1.5 → 0` |
| Rows arrive | first 10 rows only | 200ms each, 24ms apart | new `.mise-rows-in` (§14). Rows 11+ appear with the 10th. |
| AI is reading | a 2px indeterminate rail across the **top edge of the tray**, plus 6 skeleton rows **at the exact height of the real rows** | 1.6s loop | `.mise-readrail` (§14) + `.mise-shimmer` on skeletons |
| A match is confirmed | that row's spine `warn → good` and a 12px tick draws | 200ms + 350ms | `transition-[border-color] duration-200` + `.mise-tick` |
| Bulk accept | ticks cascade | 480ms, 24ms apart, **capped at 12** | `.mise-tick-in` (exists — the payroll cascade) |
| Commit succeeds | the primary button's count rolls, then the step's pip ticks once | 520ms + 480ms | `AnimatedNumber` + `.mise-tick-in` |
| All five done | the five top rules draw as one line, left to right, once | 600ms | new, `iteration-count: 1` |
| Press | everything clickable | 120ms | `mise-press` |

**Never animated:** the step bar's layout, row heights, tray size, anything
that reflows text. No parallax, no confetti (the old `Done` step had 22
particles), no mascot, no `mise-card-slide` (600ms with a `rotateX` tilt — far
too theatrical for something you see five times in a row), no `mise-step`
(550ms rise + 7px blur; it is the old wizard's entrance and it is three times
too slow for a step you revisit).

**The AI indicator is the important one.** Today a 24px `Spinner` sits in a
1110px card for the 10–20 seconds an AI read takes, and says nothing except
"wait". Replace it with: the file name, a verb that changes as the work
changes — `Reading stock-list.csv` → `Found 196 rows` → `Matching suppliers` —
and skeleton rows *the size the real rows will be*, so nothing jumps when the
data lands. The verb changing is the proof of life; the sweep is decoration.

---

## 12. Empty states

> An empty state that renders nothing looks like a failure.

Every step's empty state has the same three parts and the **same layout as its
filled state**. Arriving at an empty step must not look like arriving at a
different screen.

1. **The question and why-line** — unchanged, in the rail. The page does not
   change shape.
2. **Two doors, equal size, unequal weight.** Primary: the file
   (`mise-btn-primary`). Secondary: `Type them in` (`mise-well`). Tertiary, as
   text only: `Ask AI`. Three 112×72px tiles at 390, a row at desktop.
3. **The table, already there, holding ghost rows.** Three example rows at
   `opacity-45 select-none pointer-events-none`, `aria-hidden`, with an
   `Example` chip pinned to the tray's top-right.

The ghost rows are **not invented** — `backend/app/core/lists.py` already ships
`sample_rows` for every list, and they are good: `["Basmati Rice", "kg", "Dry
Goods", 25, "Fresh Farms"]`, `["Anita Sharma", "E001", "Chef", …]`, `["Paneer
Butter Masala", "Mains", 1, 12.50, "yes"]`. Surface them through the existing
template endpoint and the empty state costs no new copy and cannot drift from
what the importer accepts.

```tsx
<div className="relative">
  <span className="mise-chip absolute right-3 top-3 z-10" data-tone="slate">Example</span>
  <div aria-hidden className="pointer-events-none select-none opacity-45">
    {/* the real preview component, fed sample_rows */}
  </div>
</div>
```

Per-step question and why-line, so the five read as one voice:

| Step | Question (the rail title) | Why-line |
|---|---|---|
| 1 Suppliers | **Who do you buy from?** | Every price, every order and every margin hangs off this list. |
| 2 Stock | **What do you keep in stock?** | This is what recipes cost against. Match each item to its supplier and the money side switches on. |
| 3 Team | **Who works here?** | Rota, attendance and payroll all wait on this. Pay is not in this file. |
| 4 Menu | **What do you sell?** | Your dishes and their prices. Ingredients come next. |
| 5 Recipes | **What goes into each dish?** | This is the step that turns a price into a margin. |

Never "You haven't added any suppliers yet." The empty state invites; it does
not report a deficit.

### 12.1 Steps 4 and 5 are one table, and must not look like a repeat

The flow spec is right and it is load-bearing: `RECIPES` **is** the menu — one
row per dish, no ingredient lines — and step 5 writes lines against those same
rows. Two steps, one table. Visually that is a hazard: if step 5's preview
looks like step 4's, the honest reaction is *"I already did this"*.

So the two steps are given **different shapes, not different colours**:

- **Step 4 is a flat list.** One row per dish, columns `Dish · Category ·
  Serves · Price`. The same grid as steps 1–3. Nothing nests.
- **Step 5 is a grouped list**, and the group is the dish. The dish is a
  40px header row — `text-[0.9375rem] font-semibold text-fg` — carrying its
  economics on the right, and its ingredient lines are indented `pl-7` under
  it at 14px with the same spine vocabulary.

```
▸ Paneer Butter Masala      6 ingredients · £2.41 a portion · sells £12.50 · 81%
    180 g  Paneer        → Paneer ✓
     40 ml Cream         → Double cream ✓
      2 pcs Tomato       → Tomato ✓
```

Indentation is the whole signal. One glance says *this step is about what is
inside the things from the last step*, and no copy has to say it.

**The margin figure is the one number in the entire section allowed to be
large:** `font-display text-[1.125rem] font-semibold`, in `mise-tone-good`
above 60%, `mise-tone-warn` below 25%, plain `text-fg` between. This is the
moment onboarding shows what the product is *for*, and it happens before
anything is saved.

And the caveat travels with it, always, 12px `text-fg-faint` directly beneath:
`2 ingredients have no price yet, so this is a partial cost.` A number without
its caveat is worse than no number — the same law as Law 4, applied to
confidence rather than to units.

If step 5 ships after the rest, its stage is a normal empty state with real
copy and a working link, never a greyed step or a missing fifth key. A bar
that says "of 5" with a dead fifth is a bar that is lying.

---

## 13. The three exits

He asked for two ways out and the flow spec correctly found three. They are
different actions and they must not look alike. Ranked by how often they are
pressed, and given ink in exactly that order — which is the reverse of how
today's page does it.

| | Where | Recipe | Why there |
|---|---|---|---|
| **Save & close** | rail `action`, always visible | `mise-well mise-press min-h-[2.25rem] rounded-xl px-3.5 text-[0.875rem] font-medium text-fg-soft` | The common exit. Quiet, reachable, never the brightest thing on screen. |
| **I'm done with this** | inside the `⋯` overflow, and again full-width at the bottom of step 5 | a row in the overflow popup; at the bottom of step 5, `mise-well` full width | It is a decision with a consequence. It gets a `SheetPopup` that states the consequence in numbers before it happens. |
| **Finish setting up →** | the tally's primary, **only** when all five are done or skipped | `mise-btn-primary`, replacing the commit button in place | It is the last press of the whole section. It appears where the primary has always been, so it is found without looking. |

Three rules:

1. **`⋯` is `mise-well`, 36×36, and it is the only icon-only control in the
   rail.** An overflow menu with two items is still better than two competing
   text buttons in a 3-item header.
2. **No exit is ever `mise-btn-primary` except `Finish setting up`.** Today's
   `Skip — I'll do it as I go` is a filled 171×38 pill alone in the header's
   right half — it is, by area and position, the most prominent affordance on
   the page, and it means *leave*.
3. **The per-step skip is not an exit** and does not live with them. It is
   text at the bottom of the stage: `text-[0.8125rem] text-fg-faint
   underline-offset-4 hover:underline`, and it confirms inline on one line —
   `Skipped. You can come back any time.` — never in a popup. A popup for
   skipping one section of a setup you are allowed to abandon entirely is
   ceremony.

The finish sentence lands on `/dashboard` with its numbers in it: *NIRAI is set
up — 6 suppliers, 71 items, 9 people, 17 dishes, 12 costed recipes.* Set in
15px, not a toast, in the dashboard's own first card. "Done" is also what a
setup that lost half the file says.

---

## 14. Colour, and where the design system is the obstacle

### 14.1 The colour law

- **`brand-*` = identity and the single primary action.** Never a verdict.
- **`--tone-good / warn / bad` = verdicts only**, via `.mise-tone-*`,
  `.mise-bg-*`, `.mise-chip[data-tone]`. These are deliberately
  theme-independent; the app already learned that using brand for "healthy"
  makes *in stock* and *out of stock* the same colour on a green theme
  (`globals.css`, the note above `.mise-chip[data-tone]`).
- **`fg / fg-soft / fg-faint` are the only text colours.** No opacity
  modifiers on text.
- **A step you have not started is grey.** Not red, not amber. Nothing you have
  not done yet is a warning.
- **No literals.** Not one `text-white`, `bg-slate-*`, `border-white/15`. The
  old `/onboarding` had about thirty and that is why it looked like a different
  product.

### 14.2 The design system is the obstacle in four places. Four small fixes.

**(a) `text-white` on `bg-brand-600` fails AA on 8 of 22 themes.** Measured
contrast of white against each theme's own `brand-600`:

```
graphite 3.19   honey 3.19   apricot 3.56   sunset 3.56
ocean    3.68   light 3.77   dark  3.77     emerald 3.77      ← all below 4.5
```

Every theme has a *valid* ink; it is just not always white (black scores 6.59
on honey, where white scores 3.19). So pick it per theme, once, in
`themeVars()`:

```ts
/** The ink that reads on this theme's brand-600. Neither black nor white wins
 *  on all 22 — white fails on honey (3.19:1), black fails on porcelain
 *  (2.45:1) — so it is chosen from the theme's own brand, not decreed. */
function brandInk(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? "#ffffff" : "#0b0b0b";
}
// in themeVars(): "--brand-ink": brandInk(t.brand["600"]),
```

```css
.mise-btn-ink   { color: var(--brand-ink, #fff); }
.mise-btn-primary {
  background: var(--color-brand-600);
  color: var(--brand-ink, #fff);
}
```

There are **177 places in `app/` and `components/` where `text-white` sits in
the same class string as `bg-brand-600`** (108 of them in that order).
Migrating them
all is a separate sweep and not this section's job. **The rule here is only
that onboarding adds none of them** — every primary in this spec is
`.mise-btn-primary` or `.mise-btn-ink`.

**(b) `mise-well` inside `mise-card-inset` is invisible.** They are the same
recipe (§1.4). `ImportPlan.tsx` nests them for every row, which is why the
popup is a flat grey field.

> **Rule, not a code change: `mise-well` is for INPUTS and for a sub-block that
> takes focus. Sub-blocks inside a card use rules and spacing.** The one
> exception is §8.5 — a row that needs a decision, which uses
> `mise-card-inset` *with a margin*, so the gap around it makes it read as a
> raised thing even though the fill is identical.

**(c) Rows need state without becoming cards.** Ten lines of CSS, token-only,
correct on all 22 themes and in dark:

```css
/* ── Import/preview row state ──────────────────────────────────────────────
   A row's verdict is a 3px spine, not a fill and not a card. On this product
   fill is not available: shell→paper contrast is 1.00–1.13 on every theme. */
.mise-spine       { border-left: 3px solid transparent; }
.mise-spine-good  { border-left-color: var(--tone-good); }
.mise-spine-warn  { border-left-color: var(--tone-warn); }
.mise-spine-bad   { border-left-color: var(--tone-bad); }
.mise-spine-none  { border-left-color: transparent; }
```

**(d) The plan sheet is 352px wide because nobody passed `columns`.** Not a
system fault — `SheetPopup` supports `1|2|3|4`. `columns={4}` →
`w-[min(72rem,95vw)]`. One prop, 1152px instead of 352px at 1440.

### 14.3 Two new keyframes (with their reduce blocks)

```css
/* Preview rows arriving: the first ten only, then the rest are simply there.
   A 200-row stagger is a loading screen pretending to be an animation. */
@keyframes mise-row-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.mise-rows-in > *:nth-child(-n + 10) { animation: mise-row-in 200ms ease-out both; }
.mise-rows-in > *:nth-child(2)  { animation-delay: 24ms; }
/* …3..10 at 48,72,96,120,144,168,192ms — written out, not computed. */

/* The AI is reading: a 2px indeterminate rail on the tray's top edge. */
@keyframes mise-readrail-k { from { background-position: -200% 0; } to { background-position: 200% 0; } }
.mise-readrail {
  height: 2px;
  background-image: linear-gradient(90deg, transparent 20%,
    var(--color-brand-500) 50%, transparent 80%);
  background-size: 200% 100%;
  animation: mise-readrail-k 1.6s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .mise-rows-in > * { animation: none; }
  .mise-readrail { animation: none; background-image: none;
                   background-color: color-mix(in srgb, var(--color-brand-500) 45%, transparent); }
}
```

### 14.4 It has to survive the cold-load theme bug

Measured: a hard page load renders chalk — `shell #ffffff`, `paper #ffffff`,
`fg #000000`, `line rgba(0,0,0,0.22)`, `brand-600 #0949a4` — whatever the hotel
chose, for at least 6 seconds. A brand-new owner's first page load is this
page.

This spec is already immune, and deliberately so: **every piece of structure is
line, space and weight (Law 1), and colour only ever carries meaning that is
also carried by a word.** `✓ matched`, `not one of your suppliers`,
`couldn't read` — read the screen in greyscale and nothing is lost. The bug
should still be fixed (it is app-wide and belongs to the main session), but
this section must not wait on it.

---

## 15. Where I differ from the flow spec, and from him

**Adopted from the flow spec without change**, because they are right and
because two designers disagreeing on the spine is worse than either answer:
the five steps and their order; Menu and Recipes as one table written by two
steps (§12.1); the mapper keyed on *his* headings with his real first values
(§7); the four match states with `suggested` never auto-applied (§9); the AI
bar pinned to the preview rather than floating or railed (§10); the three
exits (§13); and `/onboarding` inside `(app)` with `/setup` redirecting.

**From the flow spec — three places.**

1. It keeps `PageHeader`. I drop it (§3). A 30px "Onboarding" above a 24px
   question is two headlines, and §1.2 is exactly what happens when chrome
   out-masses content.
2. It shows the step bar as five tiles. I make it five keys **on one tray with
   hairline divisions and no connecting track** (§4.1) — five separate tiles is
   five more boxes of equal weight, which is the complaint.
3. It says the preview scrolls inside the stage with the action bar pinned. I
   let the **page** scroll and pin the action bar via `Workbench`'s `tally`
   (§3), because that is what `/inventory` already does with 68 rows and it
   removes a nested scroll container — and nested scrollers are where
   `flex-1`-against-`block` has bitten this repo three times.

**From him — one place, and it is small.** He said "I hate scrolling", and a
203-row preview is a long page. I am not putting it in an inner scroll box and
I am not paginating it. Instead: the decisions are grouped first, the primary
action is pinned, and the default filter is `need you` — **so the first screen
is 4 rows, not 203, and scrolling the other 199 is optional.** His rule as
recorded is *never make someone scroll to reach what the page is FOR*, and
nothing this page is for is below the fold.

---

## 16. Acceptance — what a screenshot must show

Not selector counts. Screenshots, opened and read.

1. **1440×900, step 2, 203-row preview:** the stage is ≥1100px wide. No element
   is centred in a 352px column. No empty rail either side.
2. **1440×900, any step, idle:** less than 120px of empty page below the last
   element, or the stage genuinely ends there because content drove its height.
3. **390×844, every step, idle:** `document.scrollHeight <= 844`. Today: 1342.
4. **390×844, preview:** no horizontal scroll, the action bar is visible above
   the floating nav, and the mic FAB is not on top of anything.
5. **Six themes** (claret, chalk, honey, ocean, dark, porcelain): every verdict
   is still distinguishable, no invisible text, and the primary button's label
   clears 4.5:1 against its fill — measured, not eyeballed.
6. **Greyscale**: print one screenshot in grey. Every state is still readable.
7. **`prefers-reduced-motion: reduce`**: nothing animates, nothing is invisible
   because an entrance animation never ran.
8. **A 200-row import**: count the rendered rows. If it says 188 new, 188 are
   reachable. No "…and 128 more".
9. **Zero rows in a group**: that chip is absent, not showing `0`.
10. **Every number on screen has its unit or its noun beside it.**
11. **The mapper at 1280×800 and at 390:** six columns, no scroll at 1280, one
    thumb-scroll at 390, and the primary button says `Name is still missing`
    rather than being grey. Screenshot the disabled-looking state and confirm
    it does not exist.
12. **Steps 4 and 5 side by side:** the two screenshots must not be mistakable
    for one another. If they are, §12.1 has failed.
13. **The AI bar:** it is attached to the bottom edge of the preview, and the
    table is neither greyed nor moved while it thinks. Screenshot mid-request.
14. **Nothing in the stage is `position: fixed`.** Grep it, then screenshot at
    390 and confirm no element overlaps another.

---

## 17. Build order

1. `--brand-ink` + `.mise-btn-primary` / `.mise-btn-ink`, `.mise-spine-*`,
   `.mise-rows-in`, `.mise-readrail` in `globals.css` and `lib/theme.tsx`.
   ~40 lines, no page touched yet.
2. `SheetPopup columns={4}` wherever the plan opens. One line, and it is the
   single most visible improvement in this document.
3. The preview component (§8) as a grid with roles, with the chip filter and
   the group order. It replaces `ImportPlan`'s body and keeps its logic —
   `groups`, `decisions`, `summarise`, `nameOf` are all correct and stay.
4. The `Workbench` frame and the step bar (§3, §4).
5. The mapping screen (§7). It is the only new *screen* in the section and it
   is entirely client-side against data the preview endpoint already returns.
6. The match panel (§9) and its depth-2 picker. It needs the preview endpoint
   to return the resolved supplier, which today only happens at commit time —
   that is the flow spec's §10, and it is the only backend change this visual
   spec depends on.
7. The AI revision bar (§10), which needs `/assistant/revise-rows`. Its idle
   and error shapes can be built and reviewed before the endpoint exists.
8. Empty states (§12) fed from `sample_rows`; step 5's grouped shape (§12.1).
9. The three exits (§13).
10. Motion (§11) last, so nothing is animating a layout that is still moving.

Steps 1–3 alone fix the largest measured faults: 352px → 1152px, 10px → 12px
floor, 60-row truncation → none, and a primary button that passes contrast on
every theme.
