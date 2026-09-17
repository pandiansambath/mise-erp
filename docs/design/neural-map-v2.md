# `/control-room/graph` v2 — the map, redesigned

> "that realtime nerve movments are fine imopressive...but still in terms of
>  entire ui im expecting more grapgical ui.... also please fro this nerual map
>  alone pleas utilise a entier page please..currently u using only center place
>  and left is is sidebar...no need side bar..uitilse the entier page....and
>  pleae pleased dont make clumasy"

**The pulses stay exactly as conceived — motion carrying latency. Every static
thing around them is replaced.** This supersedes the layout half of
`neural-map-visual.md` (§2 skeleton, §3 banding, §5 dendrites, §12 fitting). The
theme rules (§9), the library decision (§8) and the honesty rules (§6) carry
over unchanged and are re-stated here where they bind.

---

## 0. What I looked at before writing a word

Live, 17 Sep 2026, `control@mise.app`, headless Chromium against
`https://nirai1.dineai.cloud`.

| Evidence | How |
|---|---|
| The page at 1920×1080, light | `scratchpad/shots/graph-1920.png` |
| The page at 1280×800, light | `scratchpad/shots/graph-1280.png` |
| The page at 1920×1080, `nocturne` | `scratchpad/shots/graph-1920-dark.png` |
| Every node's bounding box, fill, stroke, label, subtitle | `getBBox()` on each `g[role="button"]` |
| The real payload at 30 **and** 90 days | `GET /api/platform/graph` with the operator bearer |
| Resolved theme tokens on both grounds | `getComputedStyle(.mise-app)` |

Measured container geometry at 1920: `main` is **1634 × 983 at x=252**, the
canvas inside it is **1632 × 755**, the nav rail is **208 × 494** in a
**983px-tall** column, and `document.scrollHeight` is **1082** against a
`clientHeight` of **1080** — the page already scrolls 2px at both widths.

### The theme he is actually on

```
--color-shell #f4eef0   --color-fg #1a1114   --color-brand-500 #c4365a   data-mode light
```

A light theme, as `neural-map-visual.md` §0 found. Verified on `nocturne` too
(`--color-shell #14110f`, `--color-fg #f5efe9`): the "bright is a direction"
rule is working — one expression yields dark-disc-with-a-lit-rim on black and a
pale wash on white. It holds. **It is also why the light version looks weaker:
`mix(kind, shell, 0.55)` against `#f4eef0` produces a flat pastel with no
internal form.** §4 fixes that with a gradient, not with a branch.

---

## 1. What is actually on screen, and why he called it clumsy

Reading the 1280 screenshot, which is closest to his:

- **`NIRAI.Reading` does not exist on the page.** It is drawn at centre
  (377, 543); `Public traffic` is drawn at centre (395, 545). **Centre-to-centre
  distance: 18.1px. Sum of radii: 91px.** One of the three restaurants is
  entirely inside another node. The only trace is a stray `14` peeking from
  under the grey disc. This is worse than anything he reported.
- `NIRAI Madras Kitchen` and `Control Room` overlap by **49 × 54px** at 1280.
  Madras's figure reads `53 req` because the amber disc covers the `1`.
- `Virtual Private…` overlaps `EC2 Container R…` by **70 × 35px**, and
  `Bedrock`'s `$5.65` runs into `Virtual Private…`.
- **Seven of sixteen labels are truncated mid-word** — `Relational Data…`,
  `Elastic Compute…`, `Virtual Private…`, `EC2 Container R…`,
  `Simple Storage …`, `Claude Sonnet 4…`, `NIRAI Madras Ki…`.
- **About 40% of the card is bare.** All four corners are empty; the graph runs
  as a diagonal band from lower-left to upper-right.
- The nav rail is 208 × **494** in a 983px column. **489px of empty rail.** An
  empty column reads as a broken component, which is his most frequent complaint
  rendered literally.
- The legend strip is 1632px wide with ~830px of nothing to the right of its
  last item.

### The maths of the bug — one line explains the whole screenshot

`geometry.ts` places tenants on `arc(-0.78π … -1.18π)` and non-tenants on
`arc(+0.80π … +1.16π)`, intending two separated bands. Normalise them:

```
tenants      -0.78π … -1.18π   ≡   140.4° … 212.4°
non-tenants  +0.80π … +1.16π   ≡   144.0° … 208.8°
```

**The non-tenant band is a strict subset of the tenant band. They are the same
70° wedge, drawn twice, on top of each other.** `-1.18π` and `+0.80π` are 4°
apart, not half a turn. The "own band, separated by a visible gap" of
`neural-map-visual.md` §3 was written and then cancelled by a sign.

That is why `NIRAI.Reading` (147.6°) sits 3.6° from `Public traffic` (144.0°) —
about 29px of arc, for two nodes needing 91px of clearance.

Three more faults in the same thirty lines:

1. **Placement knows the wrong radius.** Layout uses `r`. The drawn node is
   `r + 10` (halo), its subtitle extends to `r + 25` below, and its name is up
   to 132px wide. Nothing in the maths knows any of that.
2. **Equal ANGLE on an unequal ellipse.** `rx = 520, ry = 302` is a 1.72:1
   ellipse. Nine services at 18.9° apart are 172px apart at the wide end and
   **102px apart in the middle** — where the nodes are biggest. The right ring
   crowds itself by construction.
3. **The model node's position is a function of the AWS bill's sort order.**
   `x = bedrock.x + 128`, no clamp. Bedrock's x comes from its rank by cost. If
   ECR overtakes Bedrock next month, Claude Sonnet moves 400px. And below
   ~1150px viewport width `bedrock.x + 128` is **off the right edge of the
   canvas** — which is exactly what he photographed.

**The determinism this design rests on is already broken for one node, and it is
broken by a coordinate derived from a neighbour.** The fix is slots, not
neighbours.

### Three faults the screenshot cannot show

- **The legend teaches a symbol the picture never draws.** `╌╌ modelled — a
  share, not a bill` is in the legend; the live payload contains **zero**
  `measured: false` edges. Nothing on the page is dashed. And with no modelled
  edge the map never answers his literal question *"what aws bill they consufe"*
  per restaurant — it shows the bill only at platform level.
- **Nine of sixteen edges pulse and represent no event.** `platform → service`
  carries dollars. A dollar is a rate, not a packet. §6 of the original spec
  forbids exactly this, and the build does it nine times.
- **The orphan is real and invisible.** At `days=90` the payload contains
  `fb1649e9… "Deleted restaurant"`, `severed: true`, 6 AI calls, $0.0537, last
  used 4 Aug. At `days=30` — the default — it is absent, because it is outside
  the window. The best fact on the page is one click away and nothing says so.
  (`meta.unattributed_ai_calls: 32` — 11% of all AI calls belong to nobody — and
  `meta.silent.services` are likewise in the payload and drawn nowhere.)

---

## 2. The decision on layout: still deterministic, no longer radial

**I am keeping determinism and rejecting force-directed.** The §2 argument holds
and the evidence above strengthens it: the one place the current layout derives
a coordinate from a neighbour rather than from a slot is the one node that will
move for no reason. A physics sim makes *every* node behave like that. He opens
this every morning; "where is NIRAI" must never become a search task.

**But the arcs go.** A radial layout traces the *rim* of each half and leaves the
*interior* empty — which is literally what the screenshot shows, and it is the
space complaint in geometric form. Radial also forces a 2-D spacing problem
(every node on a different bearing, every label wanting a different outward
direction) when what is needed is a spacing *guarantee*.

### THE CORTEX LAYOUT — four columns, solved from content

```
   A · DEMAND               B · STEM        C · SUPPLY              D · MODELS

  ╭───────────────────── the AI bypass, arcing over everything ──────────────╮
  │                                                                          │
 (○) NIRAI ───────────╮                  ⬡ Relational Database Service       │
     1,586 req · 267 AI calls            $15.19 · 40% of the bill            │
                      │                                                      │
 (○) NIRAI Madras Kitchen ─╮             ⬡ Elastic Compute Cloud             │
     153 req · no AI yet   │             $8.17 · 21%                         │
                           ├─▶ ▣ DineAI ▶⬡ Bedrock ───────────▶ ◆ Claude Sonnet 4.6
 (○) NIRAI.Reading ────────╯    5,360 in  $5.65 · 15%            249 calls · 503k tokens
     no HTTP · 14 AI calls      $38.02 out
   ─── NOT A TENANT ───────────────────── ⬡ Virtual Private Cloud
 (▨) Public traffic ───────╮             ⬡ EC2 Container Registry
     3,427 req · 64%       ├─▶            ⬡ EC2 - Other
 (○) Control Room ─────────╯             ⬡ Polly · Cost Explorer · S3
     194 req
```

Why columns:

- **Spacing becomes one-dimensional and therefore exactly controllable.** Within
  a column x is constant, so the only constraint is a vertical pitch you compute.
  Between columns the separation is hundreds of pixels. **Overlap becomes
  impossible by construction rather than something a solver tries to avoid** —
  categorically stronger than "thirty iterations of angular nudging".
- **Labels all point one way.** Column A's text is right-aligned to the left of
  its nodes; C and D are left-aligned to the right of theirs. One direction per
  column, so a label can never wander into a neighbour.
- **It fills a 1.88:1 letterbox natively.** The demand/supply split still reads
  left-to-right and the band of edges crossing the middle is still the page's
  central event. The topology still carries the epistemology; only the container
  changed.
- The interior is no longer empty, because there is no interior. Every pixel
  between the columns is edge.

The AI edges are the one thing that crosses a column: `restaurant → model` bows
**high over the whole diagram**, visibly skipping the platform. That is the
truest line on the page — the one flow nothing mediates — and it becomes the
most striking shape in the picture.

---

## 3. The layout algorithm — the actual maths

`U` = usable box, `M` = margin, `r` = radius, `g` = gap. Everything below is a
pure function of the payload and the box. No randomness, no iteration, and **no
coordinate derived from another node.**

### 3.0 The box and the keep-out inset

The map element is `height: calc(100dvh - 57px)` (`dvh`, not `vh` — the traps
table), `overflow: hidden`. The floating chrome (§5) is absolutely positioned and
costs **zero layout height**; instead the layout *reserves* it:

```
INSET = { top: 64, right: 16, bottom: 56, left: 16 }
U     = { w: W - 32, h: H - 120, x: 16, y: 64 }
```

Reserving it in the maths is the honest way to do floating chrome. Hoping is not.

- **1920×1080** → map box 1920 × 1023 → `U = 1888 × 903 at (16, 64)`
- **1280×800** → map box 1280 × 743 → `U = 1248 × 623 at (16, 64)`

> Today's canvas is 1632 × 755 = 1,232,160 px². Full-bleed at 1920 is
> 1920 × 1023 = **1,964,160 px², +59%**. At 1280 it goes 992 × 475 → 1280 × 743,
> **+102%**. The map more than doubles on his laptop.

### 3.1 Column membership and stable order

| Column | Kinds | Order — and it must never change between loads |
|---|---|---|
| A | `restaurant`, then a band gap, then `anonymous` / `operator` / `orphan` | restaurants by `detail.created_at` **ascending**; others fixed `anonymous, operator, orphan…` |
| B | `platform` | n = 1 |
| C | `service` | by `usd` **descending, computed on the 90-day window regardless of the selected window** |
| D | `model` | by `tokens` descending, same 90-day freeze |

**Restaurants are not ordered by traffic.** Traffic order re-shuffles the column
whenever a month is quiet — the same failure force-directed has, one level down.
Founding order never changes.

**Services are ordered by cost, but the ordering key is frozen to 90 days.** So
flicking `7 / 30 / 90` changes the *sizes* and never the *sequence*. He keeps
"RDS is at the top" as muscle memory while still seeing the window he asked for.

### 3.2 Radius

Per column `k`, derived from the space that column actually has:

```
pitch_k = U.h / n_k
rMax_k  = clamp(0.34 * pitch_k, 26, 64)
rMin_k  = clamp(0.52 * rMax_k,  20, 34)
r(v)    = rMin_k + (rMax_k - rMin_k) * sqrt(v / vMax_k)
```

Square root because the eye compares **area**; a floor of 20–34 because a quiet
node still has to be clickable and must never read as broken.

- `vMax_A` = max `metrics.requests` · `vMax_C` = max `metrics.usd` ·
  `vMax_D` = max `metrics.tokens`
- **A node alive on another channel but with `v = 0`** (`NIRAI.Reading`: no HTTP,
  14 AI calls) gets `r = rMin_k + 6`. It must not be the smallest thing in its
  column when it is not the quietest thing in its column.
- Platform: `r_B = clamp(0.068 * U.h, 40, 64)`
- Models: `r_D = clamp(0.34 * (U.h / n_D), 26, 44)`

Worked at 1920 (`U.h = 903`):

| Column | n | pitch | rMax | rMin |
|---|---|---|---|---|
| A | 5 | 180.6 | 61.4 | 31.9 |
| C | 9 | 100.3 | 34.1 | 20.0 |
| D | 1 | 903 | 44.0 | 26.0 |
| B | 1 | — | 62 | — |

→ NIRAI 51.6 · Madras 37.9 · Reading 37.9 · Public 61.0 · Control Room 38.7
→ RDS 34.1 · EC2 30.3 · Bedrock 28.6 · VPC 26.7 · ECR 26.3 · EC2-Other 24.8 ·
Polly 22.3 · Cost Explorer 21.9 · S3 20.6

### 3.3 Horizontal — solve the columns, do not guess fractions

**The labels move out of the nodes and sit beside them.** This is the
highest-leverage change in the redesign: it kills truncation, it makes vertical
pitch depend only on circle diameter, and it frees the node interior for
graphics (§4).

Measure, never estimate: on mount, render each label into a hidden `<text>` and
read `getComputedTextLength()`, cached in a `Map<string, number>`. Measure the
element that actually renders, not a canvas approximation.

```
labelW_k = max over the column of (line 1 width, line 2 width)
pad      = 12

need_A = labelW_A + pad + 2*rMax_A      // label LEFT of node
need_B = 2*r_B                          // label INSIDE
need_C = 2*rMax_C + pad + labelW_C      // label RIGHT of node
need_D = 2*rMax_D + pad + labelW_D

free = U.w - Σ need_k
gap  = free / (K - 1)                   // K = 4
```

Lay the footprints left to right from `U.x`, each separated by `gap`. Then
`xA = left_A + labelW_A + pad + rMax_A`, `xB = left_B + r_B`,
`xC = left_C + rMax_C`, `xD = left_D + rMax_D`.

Worked at 1920 (widths ≈ 12.5px semibold / 10.5px mono — replace with the
measured values at build):

```
need_A 266 | need_B 124 | need_C 285 | need_D 289      Σ = 964
free = 1888 - 964 = 924                gap = 308

A [  16,  282]   xA =  221
B [ 590,  714]   xB =  652
C [1022, 1307]   xC = 1056
D [1615, 1904]   xD = 1659          right edge 1904 = U.x + U.w  ✓
```

Column C's label block ends at `1056 + 34 + 12 + 205 = 1307`; column D's
footprint starts at 1615. **308px of clear air.** Compare `bedrock.x + 128`,
which has no clamp at all.

Same formula at 1280, labels stepped down one notch when `U.w < 1400`
(12.5 → 11.5px, mono 10.5 → 9.5px, widths × 0.90):

```
need_A 216 | need_B 85 | need_C 249 | need_D 270       Σ = 820
free = 428                             gap = 142.7
xA = 189 · xB = 417 · xC = 628 · xD = 1038      right edge 1264 = U.x + U.w  ✓
```

**Four columns still fit at 1280 with no breakpoint and no media query.** The
formula degrades continuously; nothing jumps. (Arbitrary Tailwind breakpoints
are emitted before named ones — the traps table. This avoids the question.)

**When `free < 0`** (≈ `U.w < 950`): fold column D into column C — the model is
drawn immediately right of its parent service with a two-line label beneath —
and if `free` is still negative, rotate the whole layout 90° into the phone form
(demand top, supply bottom). That is `neural-map-visual.md` §7's mobile design
and it needs one constant, not a second code path.

### 3.4 Vertical — groups, pitch, and the band gap

Column `k` has groups `g = 0…G-1`. Column A has two; every other column has one.

```
gMin  = 18      // minimum air between two circles in the same group
gBand = 54      // the gap you can SEE — this is what carries "NOT A TENANT"

need   = Σ_all 2*r_i
gapsIn = Σ_g (n_g - 1)
slack  = U.h - need - gapsIn*gMin - (G-1)*gBand
```

`gMin` can be as small as 18 **only because the labels are beside the nodes**.
A label under a node forces the pitch to clear the circle *and* the text;
beside, the pitch only clears the circle. That is the whole reason this layout
breathes where the current one does not.

**If `slack ≥ 0`** — spread it evenly over every gap:

```
extra = slack / (gapsIn + (G-1))
gap   = gMin  + extra
band  = gBand + extra
```

**If `slack < 0`** — shrink radii before shrinking air, because air is what stops
it looking clumsy:

```
s = (U.h - gapsIn*gMin - (G-1)*gBand) / need        // uniform scale
r_i ← max(18, r_i * s)
```

If `s` would push any `r` below 18, stop scaling and go to §3.7 (sub-columns).

Then walk, and centre the finished stack vertically in `U`:

```
y = U.y
for each group g:
  for each node i in g:   y += r_i;   place(x_k, y);   y += r_i + gap
  y += band - gap
```

Worked, column A at 1920:

```
need   = 2 × 226.9 = 453.8
gapsIn = 3,  G = 2   →   453.8 + 54 + 54 = 561.8
slack  = 903 - 561.8 = 341.2   over 4 gaps   →   extra 85.3
gap = 103.3    band = 139.3

NIRAI          y = 115.6    r 51.6
Madras         y = 308.4    r 37.9
NIRAI.Reading  y = 487.3    r 37.9
   ── band gap 139.3 ──
Public         y = 725.3    r 61.0
Control Room   y = 928.3    r 38.7        bottom edge 967 = U.y + U.h  ✓
```

| Pair | Clearance needed | Today | v2 |
|---|---|---|---|
| NIRAI.Reading ↔ Public traffic | 98.9 | **18.1 — fully occluded** | **238.0** |
| NIRAI ↔ Madras Kitchen | 89.5 | 29 | **192.8** |
| Madras ↔ Control Room | 86 | 85 — touching | not adjacent |
| RDS ↔ EC2 (col C) | 64.4 | 160 | 118.4 |
| VPC ↔ ECR (col C) | 53.0 | **overlapping 70 × 35** | 107.0 |

### 3.5 Collision is a proof, not a pass

**Within a column**, two nodes cannot overlap:
`y_{i+1} - y_i = r_i + gap + r_{i+1}` and `gap ≥ 18 > 0`, so the circles are
always separated by at least 18px.

**Between columns**, the footprint solve already guarantees
`left_{k+1} - right_k = gap ≥ 0`, and each footprint contains the node *and* its
label. At 1920 that margin is 308px against a maximum radius of 62.

**Therefore no collision-resolution pass exists, and none is needed.**

Ship the assertion anyway — it would have caught this bug on day one:

```ts
// dev only. 16 nodes → 120 pairs → microseconds.
if (process.env.NODE_ENV !== "production") assertNoOverlap(placed);
```

comparing full footprint AABBs (node + bloom + corona + label block) and
`console.error`-ing any intersecting pair with both labels and the overlap in px.

### 3.6 Clamping, and truncation as a last resort

Every placed node carries its own footprint:

```
foot.left   = x - r - ringPad - (side < 0 ? labelW + pad : 0)
foot.right  = x + r + ringPad + (side > 0 ? labelW + pad : 0)
foot.top    = y - r - ringPad
foot.bottom = y + r + ringPad
```

`ringPad = 13 + spineLen` — the dendrite corona (§4), which the current code
does not account for at all.

One clamp per column, applied to the whole column so relative alignment survives:

```
shift = max(0, U.x - min(foot.left)) - max(0, max(foot.right) - (U.x + U.w))
```

If a column still does not fit, **step the label font down one notch and
re-measure**. Only if it *still* does not fit, truncate — and truncate **to the
measured width by binary search on `getSubStringLength()`**, never
`slice(0, 15)`. A truncated label keeps a `<title>` with the full name.

Today's rule truncates `Relational Database Service` at 16 characters inside a
96px hexagon while 380px of empty margin sits to its right. **In v2 no label on
today's payload is truncated at either width.**

### 3.7 Fifty restaurants

```
rFloor    = 18
capacity  = floor((U.h + gMin) / (2*rFloor + gMin))            // vertical
maxSubcol = floor(availA / (2*rFloor + pad + labelW_short))     // horizontal
```

At 1920: `capacity = floor(921 / 54) = 17`; `availA ≈ 754`, a name-only label
≈ 140px → `maxSubcol = 4`. **Column A holds 4 × 17 = 68 restaurants.**
At 1280: `capacity = 11`, `availA ≈ 300` → `maxSubcol = 2` → **22**.

`subcols = ceil(n / capacity)`, filled **right-to-left** so the founding-order
head of the list stays nearest the stem. Sub-columns beyond the first carry a
**name-only single-line label**; the figure moves to hover and to the popup.

**50 restaurants at 1920: 3 sub-columns of 17, r 18–26, 606px of the 754px
available. It fits, and nothing overlaps, by the same proof.**

Past `n > capacity × maxSubcol` the column switches to **grouped mode**: one node
per plan tier (Kitchen / Service / Group) with a count chip and a summed
magnitude; clicking a tier blooms it into its members while the others recede to
8%. At 1280 that threshold is 22. Shrinking 200 nodes into dots is not
legibility; a group node is the honest answer.

---

## 4. The nodes — this is what "more graphical" means

Today a node is one flat bloom path, one flat body path, a 1.6px stroke, up to
two 2.5px arcs, and two lines of text — one of them *inside* the shape. Five flat
elements. It is the only thing on the page not in the house style:
`mise-card-inset` is a surface with an inset shadow and a lit lower edge, and
these are bare vector shapes sitting on top of it.

Moving the text out (§3.3) frees the interior. Here is what goes in it.

### 4.1 Shared anatomy — four layers

**1 · Bloom** — the kind shape at `r + 14`, filled
`color-mix(in srgb, var(--kind) 12%, var(--color-shell) 88%)`. One flat shape:
no blur, no `drop-shadow`, no `mix-blend-mode`. It separates the node from the
`mise-cr-grid` backdrop on both grounds. Dormant nodes get it at 6%.

**2 · Body — a radial gradient, and this is the single biggest win.**

```xml
<radialGradient id="n-{id}" cx="34%" cy="28%" r="78%">
  <stop offset="0%"   stop-color="{mix(kind, fg,    0.10)}"/>
  <stop offset="62%"  stop-color="{mix(kind, shell, 0.28)}"/>
  <stop offset="100%" stop-color="{mix(kind, shell, 0.50)}"/>
</radialGradient>
```

An off-centre focal point is the entire difference between *a circle* and *a
sphere*. Four lines of `<defs>` per node. `var()` resolves in `stop-color` —
already proven in the house chart kit. And it obeys §9 by construction: the
bright stop moves toward `--color-fg`, the dark stops toward `--color-shell`, so
it is a lit dome on black **and** a lit dome on white, with no `[data-mode]`
branch.

Plus an **inner rim** — a second path at `r - 1.5`, no fill, stroke
`mix(kind, fg, 0.30)` at 0.35 alpha — and a 1.6px outer stroke at
`mix(kind, fg, 0.22)`. Bloom + gradient + inner rim is the same grammar as
`mise-card-inset`'s inset shadow and lit lower edge. The nodes finally belong to
the page they sit on.

**3 · Membrane** — the channel ring at `r + 7`, 3px, round caps, one arc segment
per channel, 14° of gap between segments, starting at −90°.

- **lit** — `mix(kind, fg, 0.18)`
- **unlit track** — `mix(kind, shell, 0.70)`, **same width**: present, resting,
  never grey, never thinner (§4 rules 1–3 of the original spec)
- **absent** — no arc drawn at all; only for a channel that cannot apply

**4 · Dendrite corona — build it, but count something real.**

`neural-map-visual.md` §5 proposed 33 spines, one per toggleable feature. Never
built — and the payload has something better: `detail.areas`, *the areas they
actually opened, with request counts*. Measured, not configured. The backend's
own comment says "switched on" and "used" are different claims.

**One spine per product area, length = that area's share of this restaurant's
traffic.** 24 spines at fixed angles in the canonical key order of the existing
`AREA_LABEL` map (stable forever — a spine that moves between loads is noise),
radius `r + 13`, width 1.6px, round cap:

```
used   → len = 6 + 10 * sqrt(requests_area / busiestArea)   stroke mix(kind, fg, 0.20)
unused → len = 5                                            stroke mix(kind, shell, 0.62)
```

On today's real data:

- **NIRAI** — 12 lit spines of very uneven length. A dense, spiky corona.
- **Madras Kitchen** — 12 lit spines, chat / notifications / talent heavy: a
  visibly different silhouette. You can see they are different businesses
  without reading a word.
- **NIRAI.Reading** — zero HTTP, so a **complete ring of 24 short unlit tracks**.
  Visibly whole, visibly idle. That is §4's "same silhouette" rule delivered by
  real data instead of by decoration.

Below `r = 30` the corona degrades to a single arc plus a `12/24` chip. Never 24
sub-pixel smears.

**No node-internal sparkline.** I checked: `metrics` is a single-window aggregate
with no time series anywhere in the payload. A sparkline would have to be
invented, and inventing a *curve* is worse than inventing a node. The corona is
the internal detail, and every mark in it is measured.

### 4.2 Per kind

| | Shape | Colour | Membrane | Interior | Label block (beside) |
|---|---|---|---|---|---|
| **Platform** | rounded square, r 62 | `--color-brand-500` | two arcs: left `http`, right `cost` | 2 lines **inside**: `DineAI` 15px semibold / `5,360 in · $38.02 out` 10px mono | none |
| **Restaurant** | circle | `--chart-1` | `http` · `ai` | 24-spine corona | `NIRAI` / `1,586 req · 267 AI calls` |
| **Public traffic** | circle, **hatched** | `--chart-8` slate | `http` lit, `ai` **absent** | 45° `<pattern>` at `mix(slate, fg, 0.25)` over the gradient | `Public traffic` / `3,427 req · 64% of everything` |
| **Control Room** | circle | `--chart-4` amber | `http` | corona from its own areas | `Control Room` / `194 req` |
| **Orphan** | circle | last kind colour, low chroma | **one 40° gap in the ring** | corona, all unlit | `(deleted restaurant)` / `$0.05 · 6 calls · last 4 Aug` |
| **AWS service** | hexagon | `--chart-3` sky | `cost` | **share bar across the waist** | `Relational Database Service` / `$15.19 · 40% of the bill` |
| **AI model** | diamond | `--chart-7` violet | `ai` | **in/out token split bar** | `Claude Sonnet 4.6` / `249 calls · 503k tokens · $2.16` |

Three of these are worth defending:

**The platform node stops being a placeholder.** Today it is the palest, flattest
object on the page — a washed-out rounded rectangle with 11px text — and it is
the subject of the entire sentence. In v2 it is the largest node, the only
rounded square, it carries the brand gradient, it states both totals with their
units inside itself, and **one 40°-long highlight arc rotates slowly around its
rim on an 8-second loop**. That rotation is the only pure decoration in this
spec and I want it: it is what makes the stem read as *running*. CSS
`transform: rotate` on a `<g>` — compositor only, and the first thing after
motion-preference to go.

**Services get a share bar.** A horizontal bar across the hexagon's waist, width
= this service's share of the whole AWS bill, `mix(sky, fg, 0.22)`, one `<rect>`
in a `clipPath`. RDS shows a bar at 40% of its width; S3 shows a 0.07% sliver.
"Which of these is eating the money" answered in peripheral vision, inside the
shape. It is also what rescues the legend's "size = volume" claim, which the
radius scale cannot honestly carry alone: a **500× money difference is only a
1.65× radius difference**, and the bar makes the ratio literal.

**The model gets an in/out split.** 460k tokens in, 53k out for the window — an
8.7:1 ratio nobody in this product has ever been shown. Two stacked slices inside
the diamond.

### 4.3 States that are in the data and currently invisible

- `detail.is_active === false` → the membrane becomes a single **dashed** ring
  and a `suspended` chip joins line 2. All three are active today; the day one is
  not, the map must not look identical.
- `metrics.errors_5xx > 0` → a `--tone-bad` wedge on the membrane at 4 o'clock
  plus `· 3 errors` in line 2. Zero today, which is exactly when to build it.
- A restaurant with no HTTP **and** no AI says **`ready · nothing yet`** — never
  `0`, never blank. The money page already speaks this way.

---

## 5. The page — full bleed, and what happens to the nav

### 5.1 The shell

`frontend/app/control-room/layout.tsx` gains one branch:

```tsx
const bleed = pathname === "/control-room/graph";
```

When `bleed`:

- `<OperatorNav />` is **not rendered**;
- the wrapper drops `gap-4 px-4 py-4 lg:gap-5 lg:px-6 lg:py-5` and becomes
  `h-[calc(100dvh-57px)] overflow-hidden p-0`;
- `<main>` keeps `flex min-w-0 flex-1` and now spans the full 1920.

`dvh`, not `vh` — the layout viewport includes the strip under a collapsing
address bar, and content sized against it has an unreachable bottom.
`overflow-hidden` is what finally kills the 2px scroll present at both widths
today.

I am **not** using a route group. Moving `/graph` under `(bleed)/` would mean
relocating the platform-owner guard, `FleetProvider` and `ConfirmProvider`, all
of which this layout owns once for eleven routes. A three-line conditional is the
smaller, safer change.

### 5.2 The nav — a labelled menu behind one labelled button

**Decision: `◀ Control Room`, a `mise-glass` pill floating at the top-left of the
canvas. Click → a popover listing the same eleven `CR_NAV` items, labelled, with
the same `isActive` logic, "The map" shown as current.**

*Why not an icon rail.* The eleven destinations are Overview, Hotels, AWS bill,
The map, Health, AI spend, Broadcast, Job board, Plans, Trail, Operators. Five of
those are abstractions with no guessable glyph. The house law is **less
confusion, not fewer pixels** — a labelled list one click behind a labelled
button beats eleven ambiguous icons that are always visible and never legible.

*Why not hover-to-expand.* An edge-triggered rail fires when the pointer sweeps
toward the leftmost node, and the leftmost node is at `x = 221`. It would open in
his face every time he reached for NIRAI.

Exact spec:

- **Pill** — `mise-glass mise-press`, `◀ Control Room`, 13px, ≈150 × 32, at
  `top: 16, left: 16`. `aria-haspopup="menu"`, `aria-expanded`.
- **Popover** — anchored beneath, 220px, `mise-card-inset`, `mise-pop`, the
  eleven items reusing `CR_NAV` and `isActive` **verbatim**: one nav definition,
  one active rule, no second place for "which route am I on" to go wrong.
  `Esc` closes · click-outside closes · `Tab` cycles · `↑`/`↓` move · `Enter`
  follows.
- The **`DineAI Control Room` wordmark in the header becomes a link to
  `/control-room`** — a second, always-visible, zero-cost way out.
- **`Esc` on the map with nothing open opens the menu and focuses it.**
- Below `lg`: identical. No horizontal strip on this route.

### 5.3 The page header goes

`PageHeader title="The map"` plus its subtitle costs **92px of the scarce axis**
for a title he only sees after clicking a nav item called "The map", above a
picture whose centre says `DineAI`. Once the band labels exist (§5.5) the diagram
names itself. The subtitle sentence moves into the legend block, where it is read
at the moment it is needed.

### 5.4 Floating chrome — four corners, zero layout height

| Where | What |
|---|---|
| top-left | `◀ Control Room` pill · `7 / 30 / 90` `Segmented` · the totals line `5,360 requests · 281 AI calls · 537,539 tokens · $38.02 of AWS` |
| top-right | `Graph / List` toggle |
| bottom-left | the legend block (§5.6) |
| bottom-right | `Our counters start 2026-09-16.` · `generated 09:12 UTC` |

All four are `mise-glass`, `pointer-events` only on themselves, and all four sit
inside the `INSET` the layout already reserved. The picture runs underneath them,
edge to edge.

`Graph / List` is `neural-map-visual.md` §15's accessible view and does not exist
today. It is also the `prefers-reduced-motion` view and the low-power view —
built once, used three times. A `<table>` grouped by column, every figure with
its unit.

### 5.5 Band labels — five of them, and they teach the diagram

Promised in §2 of the original spec, never built. 10px mono uppercase,
`letter-spacing: 0.16em`, `fill-fg-faint`, on a 1px hairline rule spanning the
column's footprint width, 26px above the column's first node:

`RESTAURANTS` · `NOT A TENANT` · `THE PLATFORM` · `AWS SERVICES` · `MODELS`

Five texts and five lines. Half the legend's job, done permanently, in the margin
that would otherwise be dead.

### 5.6 The legend is a filter

Bottom-left, two rows, each item drawn **as the actual mark**, not as a swatch:

```
○ restaurant   ▨ not a tenant   ⬡ AWS service   ◆ model   ◌ deleted
── measured    ╌╌ modelled (a share, not a bill)
● a pulse is one call · its speed is how long that call took, next to the others
```

Hovering `⬡ AWS service` lights the nine services and drops everything else to
10%. Hovering `╌╌ modelled` flashes every dashed edge. A legend that teaches by
demonstration and doubles as a filter is strictly better than a key.

**The `╌╌ modelled` row renders only if a modelled edge exists.** A legend entry
for a symbol the picture never draws is worse than no legend — and that is the
state of the page today.

### 5.7 Loading, empty, error, and the orphan outside the window

- **Loading: the skeleton IS the layout.** The four column rules, the five band
  labels and the platform node draw immediately, because with a deterministic
  layout we know where everything goes before the payload arrives. A soft
  highlight sweeps each column rule (`<linearGradient>` `gradientTransform`,
  1.6s). Nodes land staggered 40ms with `mise-pop`. **Nothing moves when the data
  arrives** — a property only a deterministic layout has.
- **Error** — `ErrorCard` floated **over** the skeleton, never instead of it. The
  shape of the page survives its own failure.
- **Empty** — the platform node, five band labels, and one line:
  *One platform node, no tenants yet. The first restaurant to sign up appears
  here.*
- **The orphan.** It exists at 90 days and not at 30, and the map must not
  silently omit its best fact. One backend field —
  `meta.orphans_outside_window: { count, earliest, latest }` — and the orphan's
  slot in column A renders as a **dotted placeholder** captioned
  `1 deleted restaurant · last active 4 Aug · widen to 90 days`. Clicking it sets
  the window to 90. A hidden fact becomes a discoverable one for six lines of
  Python.

---

## 6. Edges and pulses

### 6.1 Geometry

Every edge is a cubic bezier with **horizontal control handles**:

```
C  x1 + k, y1   x2 - k, y2         k = 0.42 * (x2 - x1)
```

Every edge therefore **leaves its node horizontally and arrives horizontally**.
At the platform node five edges fan into the left face and nine fan out of the
right — a nerve trunk. Today they arrive on arbitrary bearings, which is a large
part of the scatter.

**The AI bypass** — `restaurant → model` uses a raised control pair,
`y1 - 0.34*U.h` and `y2 - 0.34*U.h`, apex clamped to `U.y - 24`, drawn **last**
so it passes over everything. It is the only edge that crosses a column, and that
is the point: nothing mediates an AI call.

### 6.2 Weight and colour

```
measured:  width = 2 + 6 * sqrt(w / wMax)      // 2px floor
modelled:  width = 1.5, fixed, always          // geometry must not imply precision
```

Square root with a 2px floor, because linear makes 153 req a 1.2px hairline that
is invisible on `#f4eef0`. Today that is exactly what happens.

**Each edge gets a gradient along its own length:**

```xml
<linearGradient id="e-{id}" gradientUnits="userSpaceOnUse" x1 y1 x2 y2>
  <stop offset="0%"   stop-color="{mix(sourceKind, fg, 0.28)}"/>
  <stop offset="100%" stop-color="{mix(targetKind, fg, 0.28)}"/>
</linearGradient>
```

The line changes hue as it crosses, so it visibly belongs to both ends. Sixteen
`<defs>`. It is the cheapest thing on this page that makes an edge look like a
conduit rather than a pen stroke.

Opacity 0.42 · 0.9 when one of its nodes is hovered · 0.07 when dimmed.

### 6.3 The modelled edges — build them

There are none today. Build the four: `restaurant ⇢ platform`, dashed `6 4`,
fixed 1.5px, labelled with the apportioned share carrying **the dashed underline
the money page already uses for "modelled"**. `cost_map.py` already computes the
apportionment.

Without them the legend teaches a symbol that never appears, and *"what aws bill
they consufe"* — his words — is answered only at platform level.

Routing stays as §6 argued: never restaurant → service. That would be
4 × 9 = **36 dashed lines** across the middle — a hairball, and epistemically
false. In through the stem, out through the stem: 5 in + 9 out = 14, and you can
watch the apportionment happen exactly where it happens.

### 6.4 The pulses — keep the idea, fix three things

He likes these. They stay. Three corrections:

**1 · Cost edges must stop pulsing.** Nine of sixteen edges currently emit
discrete packets representing dollars. A dollar is a rate, not an event, and §6
of the original spec forbids exactly this. Cost edges get a slow marching
`stroke-dashoffset` **drift** instead — which also halves the in-flight pulse
count for free.

**2 · The latency mapping is calibrated for the wrong range.** From the payload:

```
AI edges    NIRAI→Sonnet 148ms · Reading→Sonnet 1080ms · orphan→Sonnet 0ms
HTTP edges  latency_ms = null on all four   →   every one defaults to 900ms
HTTP nodes  avg_ms:  Public 7 · Control Room 58 · NIRAI 68 · Madras 95
```

`clamp(ms/1000, 0.4, 6)` sends every HTTP latency (7–95ms) to the 0.4s floor —
identical speed, story dead — and `?? 900` does not catch the orphan's `0`, so
its pulse flies at maximum speed. Replace with a **per-channel log map**:

```
duration_s = 0.5 + 3.5 * (log10(ms) - log10(lo_ch)) / (log10(hi_ch) - log10(lo_ch))
```

`lo` / `hi` are that channel's min and max across the graph. HTTP then spreads
0.5s (Public, 7ms) to 4.0s (Madras, 95ms); AI spreads 0.5s (NIRAI) to 4.0s
(Reading). Relative truth preserved, the difference actually visible. HTTP edges
take the source node's `avg_ms` — a field that already exists and is currently
unused. The legend then reads *"its speed is how long that call took, next to the
others"*.

**3 · A pulse should look like a spark, not a dot.** Today: one 2.6px circle plus
a 5%-length tail at 0.3 alpha. Replace with a **3px core at
`mix(kind, fg, 0.55)` over a 6px body at `mix(kind, fg, 0.20)`, and a 9px tapered
tail** drawn as a four-stop gradient stroke. Still one `arc()` and one `stroke()`
per pulse.

**And add the landing flash.** When `t ≥ 1`, push a ring at the target expanding
`r → r + 16` over 260ms, alpha 0.35 → 0, in the target's kind colour. Capped at
six in flight. That is the synapse firing, it is what will make the stem feel
alive, and it costs one more `arc()` per frame.

Budget unchanged: ≤ 40 sprites, one `clearRect`, one rAF, cancelled on
`document.hidden`, everything dead under `prefers-reduced-motion` (edges then
carry a static count chip, and `List` is one click away).

---

## 7. Constraint compliance — checked, not assumed

| Constraint | How v2 satisfies it |
|---|---|
| Works on white **and** dark | Every colour is `mix(kind → fg)` for lit and `mix(kind → shell)` for ground, **including both gradient stops**. One expression, no `[data-mode]` branch. Verified today on `#f4eef0`/`#1a1114` and `#14110f`/`#f5efe9`. |
| No `mix-blend-mode: screen`, no `drop-shadow` glows | Bloom is a filled shape at `r + 14`. Halo is `color-mix`. Zero filters. |
| Canvas re-resolves the palette on theme change | Unchanged — `getComputedStyle` plus the `MutationObserver` on `<html>` `data-mode`/`class`/`style` stays exactly as built. |
| No new libraries | Hand-rolled SVG + one canvas. `three` and `gsap` stay imported by zero files. Nothing added. |
| `prefers-reduced-motion` | Kills pulses, drift, breathing and the platform rim highlight. Edges get static count chips; `List` is the fallback view. |
| `document.hidden` | rAF cancelled. Unchanged. |
| 50 restaurants | 3 sub-columns of 17 at 1920 (§3.7); grouped mode past 68, and past 22 at 1280. Stated with the arithmetic. |
| Never scrolls | `h-[calc(100dvh-57px)] overflow-hidden`; chrome floats and is reserved as `INSET`, so the fit is structural rather than a subtraction that is currently 2px wrong. |
| Determinism | Every coordinate is a function of (kind, stable index, box). **No coordinate is derived from a neighbour** — which is the `bedrock.x + 128` bug, and it is gone. |
| A number without its unit | Every label line 2 carries units: `req`, `AI calls`, `$`, `tokens`, `% of the bill`. |
| A control disabled on arrival | `7 / 30 / 90` is never disabled; `ai_usage` holds 90 days. |
| An empty state that renders nothing | Loading draws the full skeleton; empty draws the platform, five band labels and one sentence; error floats over the skeleton. |
| Greyscale acceptance test | Shape (circle / hex / diamond / square / hatched / gapped), dash-vs-solid, spine density and every label survive it. Colour is never the only cue. |

---

## 8. Ordered list of changes

Each step is separately shippable and separately visible. Steps 1–8 are the whole
of his complaint; 9–10 are the honesty debt the screenshots exposed.

| # | File | Change | Why it is in this position |
|---|---|---|---|
| **1** | `frontend/app/control-room/layout.tsx` | `const bleed = pathname === "/control-room/graph"` → skip `<OperatorNav>`; wrapper becomes `h-[calc(100dvh-57px)] overflow-hidden p-0`. | Biggest visible change for three lines. +59% canvas at 1920, **+102% at 1280**. |
| **2** | new `frontend/components/controlroom/CrNavMenu.tsx` | The `◀ Control Room` pill + popover over `CR_NAV` / `isActive`. Header wordmark becomes a link to `/control-room`. | Must land **with** step 1. Never ship a page you cannot leave. |
| **3** | `frontend/app/control-room/graph/geometry.ts` | Replace `layout()` entirely with §3: column membership and stable order, radius, the footprint solve, the vertical walk, the clamp. Keep `radiusFor`'s sqrt idea; drop the arcs. Add dev-only `assertNoOverlap`. | Fixes the overlaps, the truncation, the off-canvas model node and the sort-order drift in one pass. |
| **4** | `frontend/app/control-room/graph/NeuralMap.tsx` | Labels **out** of the nodes into measured two-line blocks beside them (`getComputedTextLength`, cached). Width-based truncation as a last resort with a `<title>`. | Depends on 3. Kills all seven ellipses and frees the interior for step 5. |
| **5** | `NeuralMap.tsx` + new `graph/NodeArt.tsx` | Per-node graphics: radial-gradient body, inner rim, bloom; membrane with gaps; **24-spine dendrite corona from `detail.areas`**; service share bar; model in/out bar; platform two-line interior and rotating rim highlight; suspended and `errors_5xx` states. | "More graphical". Only possible after 4. |
| **6** | `NeuralMap.tsx` | Edges: horizontal bezier handles, `sqrt` width with a 2px floor, per-edge `userSpaceOnUse` gradient, the AI bypass arcing over the top. | Edges stop being hairlines and start looking like conduits. |
| **7** | `NeuralMap.tsx` | Pulses: cost edges drift instead of pulsing; per-channel log latency map using `avg_ms` for HTTP; spark core plus tapered tail; landing flash. | His favourite thing, corrected — same idea, honest calibration. |
| **8** | `frontend/app/control-room/graph/page.tsx` | Drop `PageHeader`. Four floating `mise-glass` chrome blocks. Five band labels. Legend as a hover filter with the `╌╌ modelled` row conditional. `Graph / List` toggle and the `<table>` view. | 92px back on the scarce axis; the diagram teaches itself. |
| **9** | `backend/app/platform_admin/graph.py` | Add the four **modelled** `restaurant ⇢ platform` share edges (`measured: false`) from `cost_map.py`; put the source node's `avg_ms` on HTTP edges as `latency_ms`; add `usd_share` to each service node. | Makes the legend honest and answers *"what aws bill they consufe"* per restaurant. Plain dict — **no `response_model`**, which has silently dropped undeclared fields nine times. |
| **10** | `backend/app/platform_admin/graph.py` | `meta.orphans_outside_window: { count, earliest, latest }`; surface `meta.unattributed_ai_calls` (32 of 281 calls belong to nobody) and `meta.silent.services` in the platform popup. | The orphan becomes discoverable at the default window instead of hiding behind a control nobody knows to move. |

**Before claiming any of it:** `npm run lint`, not just `tsc` and `build` —
`NeuralMap.tsx` gains hooks in step 5, and hook-order errors pass both of the
others. Then screenshot at 1920 and 1280 on **`chalk` and `nocturne`** and read
the PNGs. The instrument that found every fault in this document was the picture,
not the assertion.

---

## 9. What would make v2 fail, ranked by what he sees first

1. **Labels left inside the nodes.** Every other improvement is downstream of
   moving them out: no truncation, a small vertical pitch, and an interior to
   draw in. Skip step 4 and steps 5–7 have nowhere to go.
2. **The nav shipped as icons.** Eleven abstractions, eleven guesses, and the
   complaint becomes "now I can't find anything".
3. **Cost edges left pulsing.** Nine lies a second, on the page whose entire
   claim is that it distinguishes measured from modelled.
4. **The dendrite corona built from invented data.** If `detail.areas` is empty
   for a node, draw the full unlit ring — never a fabricated one, and never
   nothing.
5. **The footprint solve replaced by fixed fractions** because they "looked fine
   at 1920". `0.74 × span` puts column C's labels 105px inside column D at 1920.
   I checked. The solve exists because the guess fails.
6. **`vh` instead of `dvh`**, and the page has an unreachable bottom on a phone.
