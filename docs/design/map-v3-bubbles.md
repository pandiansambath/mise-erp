# `/control-room/graph` v3 — bubbles, and bubbles inside them

> "this clumsy map(its not thte much imopressive also the shapes are not nice
>  use bubbles instead please bubbule wil be imprssive to look like bubbuel
>  inside that anothe bublles etcetc redesgin"

> "each and every node is node of other node...under that node ther will be so
>  many nodes... i mean under the any hotel if we lcick i will show us zoominded
>  view of its own pages as nodes like what access it shas sho wthose pages,..on
>  that oage what access read or write ..wht they did....how many time chatted
>  woht ai...ectcet... if if clikc it need to tak me to ai spend page to get
>  full view"

> "also its not reponse... also screen is fixed i mean the map...we need like if
>  we scroll we can rotate the entier ..we can move...pull...zoon ni zoom
>  out..ectetc.....also whatever showng in aws bill page the exact both need to
>  match ok"

This supersedes `neural-map-v2.md` entirely — its four-column solve is the thing
that is now broken on the live site, and §5 below proves it with measurements.
It keeps three things from `neural-map-visual.md` / `neural-map-data.md`
unchanged, and re-states them where they bind: **the honesty rules** (measured ≠
zero, modelled is marked, orphans are not dropped), **the theme rule** (lit is a
direction toward `--color-fg`, never a colour), and **the pulse rule** (a pulse
is a packet, so only discrete things pulse — money never does).

---

## 0. What I looked at before writing a word

Live, 22 Sep 2026, signed in as `control@mise.app`, headless Chromium against
`https://controlroom.dineai.cloud`. Deployed commit `4154a3a` — confirmed from
`/api/health`, so this **is** the four-column rebuild, not the old radial one.

| Evidence | Where |
|---|---|
| The map at 1440×900 | `scratchpad/shots/map-1440.png` |
| The map at 390×844 | `scratchpad/shots/map-390.png` |
| The bottom-left pile, 2× crop | `scratchpad/shots/crop-pile.png` |
| The top-left collision, 2× crop | `scratchpad/shots/crop-top.png` |
| The AWS bill page at 1440, full | `scratchpad/shots/money-1440.png` |
| Every `<text>` box + every overlapping pair | `getBoundingClientRect()` on all 51 labels |
| The real payload | `GET /api/platform/graph?days=30`, 26 nodes / 28 edges |

Two independent loads seven minutes apart produced the identical pile, so it is
structural, not a race.

### What is on screen at 1440×900, described

Left edge: a vertical stack of fifteen spheres at x≈210. Beside each, to its
left, a name and a mono subtitle — `NIRAI Madras Kitchen / 536 req · no AI yet`,
`ckb / 531 req · 1 AI calls`, and so on. A pale rounded square labelled `DineAI`
floats alone at x≈488, y≈480. At x≈760 a second vertical stack, this one of
pale-blue **hexagons**, each with an English-ish AWS name and a dollar figure to
its right. At x≈1230, on its own, one purple **diamond**: `Claude Sonnet 4.6 ·
271 calls · 569k tokens`. Thin curved lines fan from the left stack into the
square and out to the hexagons.

Then the faults, in the order a stranger meets them.

---

## 1. What is measurably broken

### 1.1 Six node labels are superimposed at the bottom left

The crop (`crop-pile.png`) shows, in one 200×90px region: **`CSK dhab…`**,
**`Public traffic`**, **`Control Room`**, **`pandianshotel`**, **`karpagam`**,
three separate **`ready · nothing yet`** subtitles, **`4,167 req`** and
**`438 req · no AI yet`** — all drawn on top of one another, and an orange disc
drawn *inside* a grey one. The automated pass found **51 overlapping text pairs**
at 1440×900, of which these are the unambiguous ones:

```
karpagam ↔ pandianshotel        karpagam ↔ ppp          karpagam ↔ Control Room
karpagam ↔ 4,167 req            pandianshotel ↔ ppp     pandianshotel ↔ Control Room
ppp ↔ Control Room              Public traffic ↔ 4,167 req
Control Room ↔ 438 req          "ready · nothing yet" ↔ "ready · nothing yet"  (×3)
```

**The cause is one line.** `frontend/app/control-room/graph/geometry.ts`,
`placeColumn()`:

```ts
y: Math.min(U.y + U.h - r, Math.max(U.y + r, y)),
```

That is a clamp, and a clamp is a **many-to-one function**. Column A now holds
15 demand nodes. Summing the real radii from the payload gives ≈ 900px of
diameter, plus 13 in-group gaps × `G_MIN` 18 = 234px, plus one band gap
`G_BAND` 54 — **≈ 1,188px of content in an 803px box**. `slack` is −385, so
`extra = Math.max(0, slack)/…` is 0 and the running `y` overruns the bottom by
385px. Every node past the edge is mapped onto `U.y + U.h − r`. They do not
*risk* landing together; they are *sent* there.

The file's own header says *"overlap stops being something an algorithm tries to
avoid and becomes something the arithmetic cannot produce."* That is true only
while `Σdiameters ≤ H`. The fleet went from 3 restaurants to 13 and no branch
exists for the other case.

And the proof that would have caught it is compiled out of the build that ships:

```ts
if (process.env.NODE_ENV === "production" || !placed.length) return;
const bad = assertNoOverlap(placed);
```

### 1.2 The busiest restaurant on the platform has no visible name

`crop-top.png`. NIRAI — 3,020 requests and 240 AI calls, the largest node in the
payload — sits under the floating `7 days / 30 days / 90 days` pill. One letter,
`N`, is visible at x≈126. Its subtitle `3,020 req · 240 AI calls` starts at
**x = 8**, eight pixels from the window edge. The node's top is clipped by the
canvas.

The chrome is `pointer-events-none absolute inset-x-0 top-0 z-20` and the layout
solves against the full canvas height as if the chrome were not there. Floating
chrome over a scene that assumed the whole height is a collision by
construction.

### 1.3 At 390px the map is unusable

`map-390.png`. All four solved columns land on top of each other. Reading down
the left third: `NIRAI Madras Kit…` on `Elastic Compute Cloud - Compute`;
`536 req` on `$8.24`; `531 req` on `Bedrock $4.49` on `ckb`; `322 req` on
`Virtual Private Cloud $3.50` on `pkpk`; `DineAI` truncated to `Dir…` and drawn
*underneath* the Claude Sonnet diamond; `Cost Explorer $0.68` on `JustKitchen`;
`Polly $0.44` on `pppk`; and the legend row `restaurant / AWS service / AI model`
sitting directly on the footnote sentence. There is no width at which the
four-column solve degrades gracefully, because `gap = (U.w − sumNeed) /
(live.length − 1)` simply goes negative and the columns march through each
other. Mobile parity is mandatory on this product; this is zero parity.

### 1.4 The right 18% of the canvas is empty

The AWS column sits at x≈760, the single model diamond at x≈1230. Between
x≈1000 and x≈1180, and below y≈520 from x≈1280 to 1440, there is nothing at all.
At 1920 (`graph-1920.png`, the previous build) the same hole is ~500px wide.
*"we have so much space wasted in right and left side"* is his most-repeated
complaint and this page commits it twice: once as the empty band, once as the
bottom third of column D.

### 1.5 The shapes

Circles for restaurants, hexagons for AWS, a diamond for the model, a rounded
square for DineAI. The hexagons are the weakest thing on screen: a hexagon with
a spherical radial-gradient painted on it reads as a sticker of an AWS console
icon, not as an object. The diamond is worse — one diamond, alone, in 200px of
white, reads as an error marker. He is right, and "use bubbles" is the correct
instruction.

### 1.6 The picture has no structure to read

Thirteen restaurants → one square → nine services. That is a bipartite fan: 22
curves all crossing the same 300px of middle. It answers "who is connected to
what" — which nobody asked, because the answer is *everything to everything* —
and it does not answer "which restaurant costs what", which is the question.

### 1.7 Thirteen restaurants wear the identical crown

The dendrite ring is built from `detail.areas`, sorted by request count. From
the live payload:

```
NIRAI         talent 657, notifications 643, reports 371, hotels 227, …
ckb           talent 210, notifications 210, hotels 31,   reports 16,  …
pkpk          notifications 118, talent 118, reports 16,  chat 14,     …
opk           notifications 44,  talent 44,  hotels 11,   chat 6,      …
pppk          notifications 8,   reports 8,  talent 8,    chat 4,      …
```

`talent` and `notifications` are exactly paired at the top of every single one,
because `components/NotificationBell.tsx:100` polls `/api/notifications` and
`/api/talent/chats` on a `setInterval(refresh, 45_000)`. The ring that is
supposed to be each restaurant's fingerprint is, for its two longest spines, the
notification bell. Thirteen identical crowns — the repeated element that reads
as cheap, and in this case also untrue.

### 1.8 The numbers do not match the AWS bill page

Side by side, same session, same minute:

| | The map | `/control-room/money` |
|---|---|---|
| Headline AWS figure | **$37.09** | **$24.53** |
| Period it covers | rolling 30 days | `SEPTEMBER 2026 SO FAR` |
| Requests | 9,685 | 9,674 |
| Credits | *not mentioned* | "Credits covered $24.53 — you have not been charged" |
| RDS | `Relational Database Service $15.36` | `Database — the server $9.14` + `Database — the disk $1.88` |
| EC2 | `Elastic Compute Cloud - Compute $8.24` | `The app server $5.98` |
| Bedrock | `Bedrock $4.49`, and the model node shows **no dollars at all** | `AI — Bedrock $1.22`, plus "our ledger recorded $2.41 — ×0.51 apart" |
| Pool (shared box / platform / caused by use) | absent from the screen | a chip on every line |
| Unexplained residual | absent | "$4.78 nobody caused — the platform's own share" |

Every one of those is a real divergence, and none of them is a rounding error.
§4 says exactly where each figure must come from instead.

---

## 2. The idea: containment means summation

He asked for bubbles inside bubbles twice. The burden is on me to make the
containment mean something, because containment that means nothing is
decoration.

There is exactly one containment relation in this data that is **true**:

> **A bubble contains the things whose numbers add up to its own.**

- Every measured request belongs to exactly one **restaurant**.
- Within a restaurant, every request belongs to exactly one **area**
  (`/api/inventory/…` → Inventory).
- Within an area, every request is exactly one of **read** or **write**.

Areas sum to the restaurant. Restaurants sum to the platform. So a pack where a
child's *area* (πr², not r) is its share of the parent's is not a picture of a
hierarchy — it **is** the arithmetic, drawn. Zooming in is division; zooming out
is addition. That is the rationale for every nested circle on this page, and any
circle that cannot pass that test does not get drawn nested.

### Where "bubbles inside bubbles" is wrong, and I am not doing it

**AWS services and AI models must not be nested inside a restaurant.** The
backend's own doc is emphatic and correct: *"a model is not owned by a
restaurant — it is a shared node several of them point at"*, and *"a
restaurant's share of the box is a split of rent, not a measurement of blame."*
Drawing `Bedrock` inside `NIRAI` states that NIRAI contains Bedrock, which is
the exact falsehood the honesty rules forbid. A restaurant's *share* of the bill
is modelled; its *AI calls* are measured. Nesting would flatten that difference
into one visual.

So: **the demand side nests. The supply side is the container, not the
content.** Which turns out to be prettier anyway — see §3.1.

---

## 3. The design

### 3.0 One scene, one camera, no columns

The whole canvas is one continuous field. There is exactly **one transform** on
it:

```ts
type Camera = { k: number; x: number; y: number; theta: number };
```

Everything in §3 and §5 is a consequence of that single statement: **drilling
down is not a different mechanism from zooming — it is the same camera flying to
a computed target.** That is why pan/zoom/rotate and click-to-open are one
feature and not two, and it is why there is no popup.

### 3.1 Level 0 — the field, and the bill as its rim

The canvas is a squircle inset 12px, carrying `mise-card-inset` (the house
surface, inset not raised). Hugging the *inside* of that rim is the **BILL
BAND**: a 12px-thick stroked path following the squircle, divided into arcs —
**one arc per line on the AWS bill page, arc length ∝ dollars, total arc = 100%
of the perimeter**.

Why the bill is the rim and not nine more bubbles:

1. **It is the only closed partition on this page.** Nine service bubbles say
   "here are nine numbers". A band whose full circumference *is* $24.53 says
   "these nine things **are** the bill" in a way that cannot be misread. When he
   says "both need to match", a shape that visibly sums is doing half that job
   before anyone reads a digit.
2. **It costs zero interior space.** Nine hexagons currently occupy ~45% of the
   canvas. The band occupies the border the page already has. That is the answer
   to the wasted-rails complaint, and it is a structural answer, not a nudge.
3. **It is true.** Nothing on this platform runs outside the bill. The container
   of everything *is* the bill. Drawing it as the outermost enclosure is the one
   piece of containment on this page that is literally physical.

The band is the only non-circular thing in the design, and it earns it.

Arc styling:
- Fill: `--chart-3` family for the shared box, `--chart-4` for platform-only,
  `--chart-7` for caused-by-use (AI). Same three pools the bill page already
  chips, same three hues.
- Hairline `--color-shell` gap of 2px between arcs so adjacency is readable
  without a legend.
- Hover/focus: the arc thickens 12 → 18px over 140ms and a chip rises naming it
  **in the bill page's words** (§4.3).
- The dollar total sits at the top-centre of the band, 28px, `font-display`,
  tabular, with its `Source` chip beside it.

### 3.2 Level 1 — the pack

Inside the field, a deterministic circle pack of everything on the demand side:
13 restaurants, Public traffic, Control Room, and any orphans.

**Radius:** `r ∝ √(requests + ai_calls × 12)`, so **area** is load, as it is
today (`radiusFor` already scales by `Math.sqrt` and that judgement was right).
The `×12` weights an AI call as roughly a dozen HTTP requests — it is the one
kind of call that costs real money per unit (`$0.01` per the bill page's own
"Per AI call" figure vs `$0.13/1k` marginal), and a restaurant with 240 AI calls
and no traffic should not look empty.

**Floor:** no bubble smaller than 44px diameter. When the pack cannot satisfy
that, §3.7 takes over rather than the pack degrading.

**Determinism:** sorted by load descending, packed with the front-chain
algorithm (`packEnclose`, ~70 lines, no dependency — `d3-hierarchy` is not in
`package.json` and 26 nodes do not justify adding it). Same payload, same
picture, every morning. He opens this daily; a layout that settles differently
each load makes "where is NIRAI" a search task forever.

**Inside each bubble, not beside it:**

```
┌─────────────────┐
│     NIRAI       │   name        — 13px semibold, fill-fg
│   3,020 req     │   load        — 11px mono, fill-fg-soft
│  ● ● ● ● · · ·  │   the speckle — see below
└─────────────────┘
```

Labels inside the bubble is the whole point of bubbles. v2 moved labels
*outside* to fix truncation and bought collisions instead (§1.1). A bubble is
big enough to hold its own name because its size is the data. The rule:

> A label renders only if its measured width ≤ 1.7·r. Otherwise the bubble shows
> **initials** (`NMK`), and the full name appears on hover, on focus, and in the
> breadcrumb when it is the focused node.

Measured, not estimated — keep the existing hidden-`<text>` +
`getComputedTextLength()` probe from `NeuralMap.tsx`. That technique is correct
and stays.

**The speckle.** At rest, an openable bubble shows a faint arrangement of small
dots inside it — its children, at 8% opacity, in their real packed positions.
You can *see* there is something in there before you click. This is the "less
confusion = better UX" law: the affordance is the content itself, not a chevron.

**Non-tenants sit ON the rim.** Public traffic (4,167 req — 43% of everything)
and Control Room (438 req) are drawn tangent to the bill band, half inside and
half over it, with a 20°-hatched interior instead of a solid fill. They consume
the box and bill to nobody, and the picture says so by where they are. This
replaces v2's "band gap in column A", which was the right idea with no room to
express it.

**Orphans sit outside** the field entirely, tethered by a line with a visible
gap where it crosses the rim. Charge with nowhere to go. (The `severed` flag
already exists in the payload and already means this.)

**No hexagons. No diamonds. No squares.** Everything is a bubble except the
band.

### 3.3 Level 2 — inside a restaurant

Camera flies until the bubble fills 82% of the viewport's smaller dimension.
When its on-screen radius crosses 180px, its children fade in, packed inside it:

| Bubble | Size by | What it is |
|---|---|---|
| One per **area opened** | requests in that area | Inventory, Purchasing, Reports, Payroll… via `AREA_LABEL` |
| **AI** | `ai_calls` | calls · tokens · cost · avg latency |
| **Access** | number of roles | who can do what |
| **Nothing yet** | — | only when there are no areas at all (§3.8) |

Areas come from `detail.areas`, which already exists, is measured (not
configured), and is capped at 12 — and 12 is right, because a 13th bubble in a
360px circle breaks the tap floor.

**Polled areas are removed** (§1.7). `notifications`, `talent`, and anything
matching the health probes are excluded from a restaurant's pack and surfaced
once, as a single grey `background · 1,300 req` bubble at level 1. What is left
for NIRAI is `reports 371, hotels 227, chat 186, inventory 132, purchasing 127`
— a portrait of a business, different for every tenant. Requires one change in
`graph.py`: tag each area row `opened | polled` rather than dropping it, so the
totals still add up and the map can say where the difference went.

### 3.4 Level 3 — inside an area: read and write

Click `Inventory` and it opens into exactly **two** bubbles:

```
        ┌──────── Inventory · 132 req ────────┐
        │   ╭──────────╮      ╭─────────╮     │
        │   │   READ   │      │  WRITE  │     │
        │   │   118    │      │   14    │     │
        │   ╰──────────╯      ╰─────────╯     │
        └─────────────────────────────────────┘
```

`usage_daily` already carries `method` and `endpoint` per row. READ = `GET`;
WRITE = `POST|PUT|PATCH|DELETE`. Inside each, the top endpoints as leaf bubbles,
labelled from the templated path. That is his *"on that page what access read or
write..what they did"*, and it needs one extra `group_by(method)` in the areas
query — no new table, no new column.

Write bubbles carry a slightly warmer fill (`--chart-4` mix) because a write is
the consequential half, and the operator scanning for "what did they actually
change" should find it without reading.

**Three levels and then a door.** Level 4 does not exist. Below an endpoint
there is only the audit trail, and that is a page, not a bubble.

### 3.5 Bubbles that OPEN vs bubbles that LEAVE

The single rule that keeps this comprehensible:

> **A bubble either opens, or it leaves. Never both.**

| Bubble | Behaviour | Destination |
|---|---|---|
| Restaurant | opens | its areas |
| Area | opens | read / write |
| Read · Write | opens | endpoints |
| **AI** (level 2) | **leaves** | `/control-room/hotels/{id}/ai` |
| **AI** (level 1, the model) | **leaves** | `/control-room/ai` |
| **Access** | **leaves** | `/control-room/hotels/{id}/settings` |
| **Bill band / any arc** | **leaves** | `/control-room/money` |
| **Endpoint** | **leaves** | `/control-room/hotels/{id}/activity` |
| Restaurant name in breadcrumb | **leaves** | `/control-room/hotels/{id}` |

Every one of those routes already exists — `hotels/[hotelId]/layout.tsx` defines
the four sub-tabs `Vitals · Activity · AI · Settings`. The map does not
reimplement any of them; it is the index, and the pages are the article. That
answers *"if i clikc it need to tak me to ai spend page to get full view"*
literally.

**They look different before you click.** An *opening* bubble carries the
speckle. A *leaving* bubble carries a small `↗` glyph on its rim at 45°, and on
hover its rim brightens all the way round rather than thickening. Two
affordances, learned once, and never a surprise about whether a click changes
the page.

### 3.6 The transition — the moment this lives or dies

**Opening.** The camera tweens `{k, x, y}` to frame the target at 82% of
`min(vw, vh)`.

```
duration     520ms
easing       cubic-bezier(0.22, 1, 0.36, 1)   ← the house curve, globals.css:923
```

The bubble does **not** move relative to everything else. Its siblings do not
fade out; they fly off the edges because the camera moved, and they are still
there when you come back. That is what makes it a zoom and not a navigation, and
it is what stops the operator losing his place — which is the failure that made
the old SheetPopup drill feel like leaving the map.

Children:

```
speckle → real       starts at 220ms into the fly
                     180ms opacity + 0.92→1 scale, ease-out
                     stagger 12ms per child, largest first, capped at 12
```

The speckle is already in the right positions at the right relative sizes, so
the children do not *appear* — they **resolve**. The dots you could see from
outside become the things you can read. That continuity is the whole
transition; without it, a zoom into a plain disc is a cut.

Parent's own label crossfades out over 160ms starting at 200ms, and reappears as
the last breadcrumb crumb. The name is never in two places and never absent.

**Closing.** 380ms, same curve. Faster up than down — descending is a decision,
retreating is a release.

**Leaving (the door).** The bubble scales to fill the viewport over 260ms while
its fill flattens to `--color-shell`, and the route changes underneath. The
destination page's own `mise-pop` entrance plays on top. Net effect: the bubble
becomes the page. Implemented as a plain `router.push()` fired at 200ms, so a
slow navigation never leaves a white hole — the flattened bubble is the loading
state.

**`prefers-reduced-motion: reduce`.** Every tween duration becomes 0. The camera
snaps, children appear with opacity only, the door is an immediate `push`. One
guard at the top of the tween function, not a second code path:

```ts
const D = reduceMotion ? 0 : 520;
```

The pulses already respect this and that behaviour stays as written.

### 3.7 Mobile, 390×844

Available scene after chrome: **390 × (100dvh − 56 header − 44 breadcrumb − 44
bill bar) ≈ 390 × 700**. `100dvh`, never `100vh` — the trap table is explicit
that `100vh` on a phone includes the strip under the collapsing address bar and
the bottom becomes unreachable.

Sixteen bubbles in 273,000px² gives a smallest diameter of ~28px. That is under
the 44px tap floor, so:

> **Below 640px, level 1 shows the top 8 by load plus one aggregate bubble:
> `+7 quiet`.** Tapping the aggregate zooms into it; inside, the seven unpack at
> full size. Same mechanism, one extra level, every tap target ≥ 44px at every
> depth.

This is click-to-open doing exactly the job he wants it to do: no list, no
scroll, and nothing hidden — the aggregate states its own count.

The **bill band moves off the perimeter** at <640px and becomes a 44px
horizontal stacked bar pinned under the header. A rim on a tall narrow rectangle
puts two thirds of its arcs down the sides where no label can sit; a stacked bar
keeps the "these sum to the total" property that was the band's whole reason to
exist, and loses only the poetry.

Tap targets: minimum 44×44 for every bubble, the fit button, and every crumb.

### 3.8 Empty states

Four restaurants in the live payload have `areas: []` — CSK dhabha, karpagam,
pandianshotel, ppp — and they are **precisely the four in the collision pile**.
At level 2 they must not render an empty circle.

They render one bubble:

```
   ╭───────────────────────────╮
   │   Never opened a page     │
   │   signed up 4 days ago    │
   │            ↗              │
   ╰───────────────────────────╯
```

A door to `/control-room/hotels/{id}`. An empty state that renders nothing looks
like a failure; this one is a sales lead, and it is the thing the operator most
wants to know.

Likewise at level 1: if `include_silent` ever yields zero demand nodes, the field
draws the bill band alone with the sentence *"Nothing has been measured since
{measured_from}"* — never a blank canvas, never `0`.

### 3.9 Colour, and the theme rule

Unchanged from v2 because v2 got this right, and it is the rule most likely to be
broken by someone building bubbles from a reference image found online:

> **"Lit" is a direction, not a colour.** Every active state is a `mix()` toward
> `--color-fg` and away from `--color-shell`. `--color-fg` is near-white on the
> ten dark themes and near-black on the twelve light ones, so one expression
> goes brighter on black and deeper on white with no branching.

Concretely, and these are the only fills in the design:

| Thing | Fill |
|---|---|
| Restaurant, active | `radialGradient` 34%/28%, stops `mix(base, fg, .10)` → `mix(base, shell, .45)` → `mix(base, shell, .78)` |
| Restaurant, quiet | flat `mix(base, shell, .86)`, full-strength 1.6px rim |
| Bill arc | `--chart-3 / 4 / 7` by pool |
| Write bubble | `mix(--chart-4, base, .5)` |
| Non-tenant | `<pattern>` 20° hatch, 3px pitch, `--color-fg-faint` at 22% |
| Severed | rim `strokeDasharray` with a genuine gap, not a dash pattern |

`base` is `--chart-1` for restaurants, `--chart-8` for anonymous/orphan,
`--chart-4` for operator — the existing `KIND_VAR` map, unchanged.

**Never a drop-shadow, never `mix-blend-mode: screen`, never a glow.** Every
neural-network visual on the internet assumes a black background; the Control
Room is on a white theme today (`--color-shell #f4eef0`) and both tricks are
invisible on it. Depth comes from the radial gradient and from `mise-card-inset`
on the field. That is the house language: **inset, not raised.**

**Canvas cannot read `var()`.** Resolve the palette once with
`getComputedStyle` and re-resolve on the `data-mode` / `class` / `style`
MutationObserver already in `NeuralMap.tsx`. Theme vars are set on
`documentElement` (`lib/theme.tsx:461`), so that observer is watching the right
element. Keep it exactly as it is.

### 3.10 Motion that carries information stays

The pulses are the one thing on this page he has praised —
*"that realtime nerve movments are fine imopressive"*. They survive verbatim:

- A pulse is **a packet**, so only discrete things pulse. Requests and AI calls
  pulse. **Money never pulses**, because a dollar is a rate, not an event.
- Pulse speed is **real latency**: `edge.latency_ms ?? metrics.avg_ms`, clamped
  to 0.18–6.0 seconds. The 0.18s floor matters — real HTTP here is 7–95ms and a
  0.4s floor flattened every one of them to the same speed.
- At level 1 they travel between the pack and the bill band. At level 2 they
  travel inside the focused bubble, between its areas. **The pulse budget is 40
  total at any depth**, reallocated on focus change, so descending never costs a
  frame.

---

## 4. The numbers, and making them match the bill page

He has said this twice. It has to be a rule with a mechanism, not an intention.

### 4.1 One clock for money, a different, labelled clock for traffic

The `$37.09` vs `$24.53` gap is not a bug in either number. `graph.build()` sums
`CloudCostDaily` over a **rolling 30 days**; `costs.billed()` sums the same table
over a **calendar month**. 23 Aug – 22 Sep straddles two months, so the map picks
up nine days of August's $41.91. Both are right; the page is wrong, because one
segmented control is driving two different clocks and labelling neither.

> **Rule.** Money on the map uses the money page's period selector — the same
> component, the same options (`JUL · AUG · SEP SO FAR · ALL 3 MONTHS`), the
> same default. The `7 / 30 / 90` control stays, governs **traffic and AI
> only**, and is relabelled `Activity: 7 / 30 / 90 days`. The bill band carries
> its own period caption: `SEPTEMBER 2026 SO FAR · USD`.

Two clocks is honest. Two clocks under one unlabelled control is not.

### 4.2 One function, not two queries

`graph.py` re-implements the cost aggregation:

```python
select(CloudCostDaily.service, CloudCostDaily.usage_type, func.sum(...))
  .where(..., CloudCostDaily.record_type.notin_(("Credit", "Refund")))
```

`costs.billed()` does the same thing and then also computes credits, net, pools,
`shared_split` and `unclassified`.

> **Rule.** The graph endpoint calls `costs.billed(db, start, end)` and renders
> its output. It does not query `CloudCostDaily` itself. Two implementations of
> one number is how they drift, and they already have.

### 4.3 One name for one thing

The bill page calls it **"Database — the server"**; the map calls it
**"Relational Database Service"**. Same line. `money/lines.ts` `describeLine()`
exists precisely for this, is keyed on `usage_type` (the stable field — the
Bedrock service key *contains the model name* and changes whenever we change
model), and has a documented fall-through that tags unknown keys `NEW` rather
than hiding them.

> **Rule.** Every AWS label on the map comes from `describeLine()`. If a name
> only exists on one of the two screens, the two screens cannot be compared by
> eye, and comparing them by eye is the entire requirement.

### 4.4 One granularity

The bill page's rows are `service × usage_type` — RDS is two lines, `the server`
$9.14 and `the disk` $1.88. The map folds them into one `$15.36` node.

> **Rule.** One arc per bill-page row. RDS is two arcs. `EC2 - Other` is two
> arcs, because `lines.ts` warns in capitals that it spans two pools (EBS is the
> shared box, data transfer is platform).

### 4.5 Every figure carries its provenance

`components/controlroom/Source.tsx` already exists, already defines exactly the
four kinds this needs — `live · billed · estimate · entered_by_hand` — already
escalates a `billed` figure to amber past 26 hours, and already documents the
rule the map is currently breaking: *"Every figure carries one. A figure without
one is a bug."*

| Figure on the map | `Source` kind |
|---|---|
| Bill band total, every arc | `billed` |
| Requests, DB reads/writes, AI calls, tokens, latency | `live` |
| Any per-restaurant share of the box | `estimate` |
| Credit balance | whatever the server returned |

### 4.6 Modelled stays visibly modelled

The current legend entry — `modelled — a share, not a bill` — is the one piece
of this already right, and it **survives**, but it stops being a line style
invented for the map and becomes the legend for the grammar the bill page
already uses: **a dotted underline under the number**. That grammar is on the
money page's `SHARE OF THE BOX` column today (`$12.66`, `$1.13`, `$0.99`, each
dotted-underlined). One grammar across both screens.

Measured edges keep their solid, weight-scaled stroke. Modelled edges keep
fixed-width dashes — scaling a model's thickness by its value implies a
precision it has not got, since the box costs the same with one restaurant or
fifty.

### 4.7 The residuals are drawn, never dropped

Three numbers exist that the map currently hides:

- `meta.unattributed_ai_calls: 2` — real calls, real tokens, attached to no
  model.
- The bill page's **"$4.78 nobody caused — the platform's own share of
  $24.53"**.
- **`meta.silent.services`** — seven services on the account that billed nothing
  this period (Glue, KMS, Secrets Manager, SNS, SQS, Transcribe, CloudWatch).

> **Rule.** Unattributed AI and the platform's own share get a visible,
> clickable bubble each, in the hatched non-tenant style. Silent services get a
> single neutral crumb on the band: `7 services billed nothing`. An unexplained
> residual that is invisible is how a $10-a-month surprise hides — the bill page
> already says this in words, and the map is the screen where it should be
> impossible to miss.

### 4.8 The reconciliation goes on the AI bubble

The bill page carries the most interesting sentence either screen holds:

> "AWS billed $1.22 for Bedrock; our own ledger recorded $2.41 — **×0.51
> apart**, so the per-restaurant figures above are scaled to AWS's total rather
> than to ours."

That factor belongs on the AI bubble as a chip: `ledger ×0.51 → AWS`. It is the
one number that tells an operator whether to trust the AI costs he is looking
at.

---

## 5. Why the collisions cannot come back

Not "we will be careful". Four structural reasons, each tied to a measurement in
§1.

**(a) No node is ever placed by a clamp.** A pack solves for its container: add a
restaurant and every bubble gets slightly smaller. There is no "off the end"
case to clamp, because there is no end. The failure mode changes from
*superposition* to *smallness* — and smallness is caught by the 44px tap floor,
which has a designed answer (§3.7). **An unhandled overflow becomes a handled
state.** That is the whole fix.

**(b) A label that does not fit is not drawn.** Labels live inside their bubble,
so label-vs-label collision is not representable — two labels colliding would
require two bubbles to overlap, which the pack forbids. The `width ≤ 1.7·r`
test degrades to initials, and initials degrade to nothing at r < 18px, where
the name lives in the tooltip and the breadcrumb. v2 moved labels outside to
cure truncation and caught collisions; bubbles cure both, because the label's
container is sized by the same data that sized the bubble.

**(c) The chrome reserves its space.** The scene solves inside
`canvas − insets`, `insets = { top: 56, bottom: 48, left: 0, right: 0 }` at
desktop and `{ top: 100, bottom: 56 }` at <640px. Floating chrome over a *fitted*
scene is fine; floating it over a scene that assumed the full height put the
platform's busiest restaurant behind a segmented control (§1.2).

**(d) `assertNoOverlap` runs in production.** It is currently
`if (process.env.NODE_ENV === "production") return`, which removes the check from
the only build that ships. On ≤60 nodes it is 1,770 comparisons, once per
payload — well under a millisecond. It writes its result to
`data-map-overlap="0"` on the container so a Playwright assertion can read it
without a screenshot, and logs to console when non-zero. The reason it was
dev-only was cost; the cost estimate was wrong by three orders of magnitude.

---

## 6. Gestures

He asked for four and the map has none. All four are the same camera.

### Desktop

| Gesture | Effect |
|---|---|
| Wheel / trackpad scroll | zoom about the cursor, ×1.0015^Δy |
| Trackpad pinch (`ctrlKey` wheel) | zoom about the cursor |
| Drag empty field | pan · `cursor: grab` → `grabbing` |
| **Shift + drag** | rotate about the viewport centre |
| Click a bubble | focus — fly and open |
| `Esc` / `Backspace` | up one level |
| `F` / double-click empty field | fit everything |
| `Tab` / arrows | move focus between siblings; `Enter` opens |

### Touch

| Gesture | Effect |
|---|---|
| One finger drag | pan |
| Two finger pinch | zoom |
| Two finger twist | rotate |
| Tap a bubble | focus |
| Two-finger tap, or the `⤢` button | fit everything |

### The three rules that stop anyone getting lost

1. **Zoom is clamped**, `k ∈ [kFit, kFit × 40]`, with a rubber-band overshoot of
   12% that springs back in 240ms.
2. **Rotation is capped at ±30°** and snaps back to 0 whenever `fit` runs.
   Rotation carries no information here — it is in because he asked for it, it
   feels good under a two-finger twist, and letting someone end up reading the
   platform upside down would be a cost with no benefit.
3. **There are always two ways back**: a permanent 44×44 `⤢` button at
   bottom-right (never disabled — a control that is disabled on arrival reads as
   broken), and a breadcrumb of bubbles at top-left:

   ```
   ● DineAI  ›  ● NIRAI  ›  ● Inventory
   ```

   Each crumb is a 14px filled circle in that node's own colour plus its name.
   Clicking a crumb flies there. 32px of height, and it is the only chrome on
   the page that is worth its pixels.

**The URL follows the camera.** `?focus=<nodeId>` via `history.replaceState`
(throttled to fire only on focus change, never during a tween). Browser Back
goes up a level. The view is shareable — "look at NIRAI's write traffic" becomes
a link.

---

## 7. Performance — what runs per frame, and what does not

A previous feature on this project caused visible phone jank from per-frame React
state writes. This section is the contract.

### Per frame, inside one `requestAnimationFrame` loop

1. Advance the camera tween — four floats.
2. Write **one** attribute: `sceneRef.current.setAttribute("transform", …)`.
3. Write the counter-scale on the label overlay group — one attribute.
4. Draw ≤40 pulse arcs to the 2D canvas.

That is it. Two `setAttribute` calls and ≤40 `arc()` calls.

### Never per frame

| | Why |
|---|---|
| **No `setState`** | The camera is a `useRef`. React re-renders only when the *focus node* changes — a handful of times per session. This is the rule that was broken before. |
| **No re-packing** | The pack is one `useMemo` keyed on `nodes`. Zooming scales a solved layout; it never re-solves one. |
| **No `getComputedStyle`** | Palette resolved once, plus once per `data-mode` mutation. |
| **No text re-measure** | Once per payload, via the existing hidden-`<text>` probe. |
| **No layout thrash** | Nothing reads `getBoundingClientRect()` inside the loop. Sizing comes from one `ResizeObserver`. |
| **No CSS transitions on transformed elements** | A CSS transition on the same attribute the rAF loop writes fights it and produces the rubber-banding that looks like jank. Tween in JS or transition in CSS — never both on one property. |

### Culling, with hysteresis

Children enter the DOM when the parent's **on-screen** radius exceeds **180px**
and leave when it drops below **140px**. The 40px gap is deliberate: equal
thresholds make a slow zoom mount and unmount repeatedly at the boundary, which
is the most expensive thing this page could possibly do. DOM node count stays
≤ ~60 at any moment, at any depth.

### Labels must not scale

Text in a scaled `<g>` becomes illegible at k<1 and enormous at k>4. Labels
therefore live in a **separate, unscaled overlay `<g>`**, repositioned by the
same rAF write. Font size is constant in screen pixels at every zoom level — 13px
is 13px whether you are looking at the platform or at one endpoint.

### The budget

60fps on a t3.micro-served page in Chrome on a mid-range Android. If the pulse
loop and the camera tween cannot share one rAF, the pulses yield — the camera is
interactive and the pulses are ambient, and a dropped pulse is invisible while a
dropped camera frame is the whole feel of the page.

---

## 8. What I am deliberately not doing

1. **Not WebGL / three.js.** `@react-three/fiber` is in `package.json` and this
   is not the page for it. Sixty circles and forty sprites do not need a GPU
   pipeline, and a WebGL canvas cannot read the theme tokens without the same
   resolve-and-observe dance, plus it loses text rendering, focus rings and
   accessibility.
2. **Not a force simulation.** Non-deterministic. He opens this every morning
   and "where is NIRAI" must never become a search task. The pack is solved and
   seeded.
3. **Not d3.** No `d3-hierarchy` in `package.json`. The front-chain pack is ~70
   lines. A dependency for 70 lines on a page that already hand-rolls its own
   rAF loop would be out of character with the rest of this codebase.
4. **Not GSAP**, despite it being a listed dependency — it is imported nowhere
   in `app/`, `components/` or `lib/`, and introducing it here means a second
   ticker competing with the pulse loop.
5. **Not nesting AWS or AI inside restaurants.** Argued in §2. This is the one
   place I am declining part of "bubbles inside bubbles", and the reason is that
   it would state something false.
6. **Not keeping the hexagons, the diamond or the rounded square.** All three go.
7. **Not `SheetPopup` for drill-down.** Zoom replaces it. A popup floating over
   a map asks the reader to hold two spatial models at once, and the popup wins
   — which is how the map became a launcher for a modal instead of a map. The
   sheet remains available for the *doors* if a route turns out to be too heavy,
   but the default is the page.
8. **Not free rotation.** ±30°, springs back on fit.
9. **Not four levels.** Three, then a door.
10. **Not fixing `talent`/`notifications` by hiding them.** They are 1,300 real
    requests that really hit the box and really cost money. They move to one
    honest bubble; they are not deleted, because then the totals stop adding up
    and §2's whole argument fails.

---

## 9. Build order

Each step is independently shippable and independently visible.

| | Step | Why first |
|---|---|---|
| 1 | The pack + the field + labels inside bubbles, no zoom | Kills all 51 collisions and the 390px pile on day one. The single biggest visible win, and it is mostly deletion. |
| 2 | The camera: pan, zoom, rotate, fit, breadcrumb | The mechanism everything else is built on. |
| 3 | Level 2 — areas, with `opened` vs `polled` split in `graph.py` | The drill-down he asked for, and it makes thirteen restaurants look like thirteen different businesses. |
| 4 | Doors — AI, Access, bill, endpoints | Wires the map into pages that already exist. |
| 5 | The bill band from `costs.billed()` + `describeLine()` + `Source` chips | Makes the two screens say the same thing. Needs no new frontend work once 1–2 land. |
| 6 | Level 3 — read/write | One `group_by(method)`. |
| 7 | Mobile aggregation, tap floors, `100dvh` | Verified at 390 with a screenshot, not a selector count. |

**Verification, every step:** screenshot at 1440×900 and 390×844, and *read the
PNG*. Green assertions on this project have passed on an empty menu, a blank
preview and four grey boxes where dishes should be. Plus the
`data-map-overlap="0"` assertion from §5(d), and `npm run lint` — not just `tsc`
and `build`, which pass hook-order and used-before-declared errors that have
bitten four times.

---

## 10. The one-paragraph version

The map becomes one field with one camera. The AWS bill is the rim of that field
— the only closed partition on the page, drawn as the one shape where "these
nine things **are** $24.53" cannot be misread, and costing zero interior space.
Inside it, every restaurant is a bubble whose **area is its load**, packed, with
its name inside it. Click one and the camera flies in; the faint speckle you
could already see inside it resolves into its pages, because containment here
means the children's numbers add up to the parent's. Click a page and it opens
into read and write. Click AI, or Access, or the bill, and the bubble becomes
the page that already exists for it. Pan, zoom, rotate and drag are the same
camera; `⤢` and a breadcrumb of bubbles are always there to get back. Nothing is
placed by a clamp, so nothing can stack; every label lives inside its own bubble,
so no two labels can collide; and every figure carries the same `Source` chip and
the same dotted-underline-means-modelled grammar the AWS bill page already uses —
so when he puts the two screens side by side, they match.
