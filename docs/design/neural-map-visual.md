# `/control-room/map` — the neural map

> "we need to createe a super speical impressive graphical NEURAL maps
>  treess...like which one is under whihc one...how they chained linked ot one
>  aother... and whihc point to which one etcet...entier thing abt our
>  project..under proejct how mamy hotels are ther..unders hotel what are all
>  ther..what using..what aws bill they consufe...what ai they using..hw muhc
>  time...how many token..ectect.... litrelly like a human brain sumilation
>  neural netork UI view we need"

VISUAL AND INTERACTION spec. The data model is `docs/design/neural-map-data.md`
(planner) — nothing here designs an endpoint. Where this spec needs a field, it
says so in §14 as a requirement on that payload.

---

## 0. Evidence this is built on

Read live, 16 Sep 2026, `control@mise.app`, before any of it was designed.

| What | How |
|---|---|
| The Control Room shell, 1920×1080 | Playwright + operator login → `scratchpad/cr-overview-1920.png`, `cr-money-1920.png` |
| Phone shell, 390×844 | `scratchpad/cr-overview-390.png` |
| Container geometry | `main` is **1634 × 1111 at x=252, y=79**. Header 59px. Rail 208px wide, 450px tall. |
| The resolved theme tokens on his screen | `getComputedStyle` on `.mise-app` |
| Whether a graph library is installed | `frontend/package.json` + `grep -rn "from \"three\"" app components lib` |
| AI per-hotel truth | `/api/platform/ai/by-hotel?days=90`, supplied by the coordinator |

### The finding that reshaped this design

**His Control Room is on a WHITE theme right now.**

```
--color-shell : #ffffff      --color-fg      : #000000
--color-paper : #ffffff      --color-fg-faint: #4a5158
--color-line  : rgba(0,0,0,0.22)
--color-brand-400: #2f7ae5   data-mode = "light"
```

Every reference image for "neural network UI" on the internet is white-on-black:
additive glow, `mix-blend-mode: screen`, `filter: drop-shadow`. **Every one of
those techniques is invisible on white.** `screen` blend against `#ffffff`
returns `#ffffff`. A drop-shadow glow on a white ground is a grey smudge.

If this is built the obvious way it will be a beautiful screenshot in the
`nocturne` theme and a broken page on the screen he will actually open. §9 is the
rule set that prevents it, and it is not optional.

### The second finding

`three`, `@react-three/fiber`, `gsap` and `lenis` are in `package.json` and are
**imported by zero files** in `app/`, `components/` or `lib/`. Verified — the
same grep finds `leaflet` correctly in `components/LiveMap.tsx`. They are dead
weight from the abandoned WebGL landing era, the one he rejected because it
"looked cartoon". They are not a free head start. See §8.

---

## 1. The one-sentence design

**Two hemispheres: everything that ASKS on the left, everything that ANSWERS on
the right, the platform as the stem between them — and the line crossing the
middle is either solid because we measured it, or dashed because we modelled it.**

That is the whole page. It is brain-shaped because a brain is two hemispheres and
a stem, not because it has glowing balls on it.

---

## 2. Why hemispheres and not the obvious alternatives

**Not a top-down tree.** A tree of 1 → 3 → n is an org chart. He said it must not
be one, and he is right for a structural reason: a tree at depth 1 puts three
nodes in a row across 1634px and leaves the entire left and right thirds empty.
*"we have so much space wasted in right and left side"* is his most frequent
complaint, and a tree is a machine for generating it.

**Not free force-directed.** A physics sim settles differently on every load. He
will open this page every morning for a year. A layout that moves means "where is
NIRAI" is a search task every single time, and he can never build a mental map of
his own platform. Force-directed earns its keep when the structure is unknown;
here the structure is known, fixed and small. The sim would be computing an
answer we already have.

**Not a radial dartboard.** Equal angular spacing around a full circle is
mechanical and, worse, it is a lie: it says the five things on the ring are five
of a kind. They are not — three are restaurants, one is an anonymous crowd, one
is a ghost.

**Hemispheres, because the split is real.** Demand and supply are genuinely two
different kinds of thing, and the money page already draws that line: AI cost is
*measured*, share of the box is a *model*. Putting demand on the left and supply
on the right turns that distinction into the page's central visual event — the
band of lines crossing the midline. The topology carries the epistemology.

It also fills a 1634×950 letterbox natively. A wide container is exactly the
shape two hemispheres want.

### The skeleton

```
      ┌────────── RESTAURANTS ──────────┐        ┌──── AWS SERVICES ────┐

            ○ NIRAI Madras Kitchen                    ⬡ Cost Explorer $0.12
                                                      ⬡ EBS           $0.92
       ○ NIRAI.Reading                                ⬡ ECR           $1.53

   ○ NIRAI ───────────────────────┐          ┌─────── ⬡ VPC / IP      $1.79
     25 users · 21/33 on          │          │        ⬡ EC2 compute   $4.21
                                  ▼          ▼        ⬡ RDS           $6.43
                            ▣  D I N E A I  ▣
                                  ▲          ▲        ⬡ Bedrock       $0.61
   ▨ anonymous / public ──────────┘          └──────────┬── ◆ Sonnet 4.6
     1,566 req · 72%                                    └── ◆ Haiku 4.5

   ◌ (deleted restaurant) ╌╌╌ ·        ← edge stops short
     $0.05 · 6 calls

      └────────── NOT A TENANT ─────────┘        └────── MODELS ───────┘
```

Four faint arc labels — `RESTAURANTS`, `NOT A TENANT`, `AWS SERVICES`, `MODELS` —
sit on the ring paths in 10px mono uppercase `text-fg-faint`. They teach the
entire diagram in one glance, permanently, and cost four text elements. Half the
legend is done before the legend exists.

### Rings

| Ring | Left (demand) | Right (supply) |
|---|---|---|
| 0 | — the platform node, dead centre — | |
| 1 | 3 restaurants (upper-left arc) · anonymous + orphan (lower-left arc, own band) | 7 AWS services |
| 2 | *collapsed by default*: a restaurant's users / feature groups, bloomed on click | 2 models, hanging off Bedrock only |

**Default view: 13 nodes.** That is the honest number, and §12 is about making 13
nodes feel rich rather than sparse.

---

## 3. The anonymous node — problem 2

1,566 requests. 72% of everything. No parent.

It gets **its own band**, in the lower-left arc, separated from the restaurant
fan by a visible gap and a second arc label reading `NOT A TENANT`. It is outside
the restaurant fan, not a fourth member of it.

- Drawn in `--chart-8` (slate), the one deliberately non-identity colour.
- **Hatched fill** (a 4px 45° `<pattern>`), not solid — it is a crowd, not a
  customer. Distinguishable from every other node in greyscale.
- It is the **largest node on the page**, because it genuinely is the largest
  number, and shrinking it to be polite would be the lie this page exists not to
  tell.
- Label, always, on two lines:
  `anonymous · public traffic` / `1,566 requests · 72% of all`
- Its edge to the platform enters from **below**, on a different bearing to the
  restaurant edges, so it never reads as a sibling of them.

Clicking it opens the popup with the breakdown the money page never showed:
public landing pages, sign-in, diner QR menus, health checks. That sentence is
the answer to "what is this thing" and it currently exists nowhere in the
product.

### The severed node — and this is the best thing on the page

`ai_usage` keeps `hotel_id` after the hotel row is deleted. So there is real money
— **$0.05, 6 calls, 8,956 tokens, last fired 2026-08-04** — attached to a
restaurant that does not exist.

Do not hide it. Draw it in the `NOT A TENANT` band beside anonymous, and draw
what it is:

- **A broken membrane** — the outline ring is drawn with one ~40° gap, not a
  dash. A gap is not a dash; a viewer reads it as *severed* immediately.
- **An edge that stops short.** The line leaves the node toward the platform and
  ends ~30px away, its last segment fading to zero via a gradient stop. Nothing
  bridges the gap. Charge with nowhere to go.
- Its membrane holds its last-known colour at low chroma. It is not grey — grey
  means disabled, and this is not disabled, it is orphaned.
- Label: `(deleted restaurant) · id 7` / `$0.05 · 6 calls · last 4 Aug`
- Outline in `--tone-bad` mixed toward `--color-fg`. Colour is the *third* cue
  here; the gap and the broken edge carry it alone.

This is the single node that justifies the page's existence to anyone who asks
what it is for. It is a real fact about the platform that no existing screen
shows, and it is visible in the first five seconds without a click.

---

## 4. Dormant, and partial life — problem 1

The premise I was given was wrong and the truth is better: **NIRAI.Reading has 60
AI calls and zero HTTP requests.** It is alive on one axis and silent on another.
So aliveness is a property of a **channel**, not of a node.

### The channel ring

Every restaurant node's membrane is divided into **arc segments, one per
channel**. Today there are two:

```
    ┌ HTTP ┐  ┌── AI ──┐
    ╭──────────────────╮
    │  ░░░░░░  ▓▓▓▓▓▓  │   LIT   segment = this channel fired
    │        ●         │   TRACK segment = the channel exists, silent
    ╰──────────────────╯
```

| | HTTP arc | AI arc | Reads as |
|---|---|---|---|
| **NIRAI** | lit, pulsing | lit, pulsing | busy |
| **NIRAI.Reading** | **unlit track** | **lit, pulsing** | alive here, quiet there |
| **Madras Kitchen** | unlit track | unlit track | ready, never fired |
| **anonymous** | lit, pulsing | **no track at all** | the channel does not apply |

Three states, and they are genuinely different states:

- **lit** — fired in this window.
- **unlit track** — the channel exists and has not fired. Drawn at the same
  stroke width, in the node's colour at low chroma. **Present.**
- **absent** — no arc drawn at all. Only for channels that cannot apply.

The distinction between "unlit track" and "absent" is the whole trick. A dormant
node has *everything a busy node has*, dimmed. A broken component has *nothing*.
That is the difference between "quiet" and "failed to load", and it is structural
rather than a matter of taste.

### The four rules that stop dormant reading as broken

1. **Same silhouette.** A silent restaurant keeps its full ring, its full channel
   track, its full dendrite ring (§5) and a node radius no smaller than the
   floor. It is not a dot.
2. **Text never dims.** Labels, numbers and outlines stay at full opacity
   forever. Luminance carries activity; opacity carries nothing. Faded text is
   the single thing that reads as "broken" — it is what a disabled control looks
   like, and *a control that is disabled on arrival reads as broken*.
3. **Never grey.** Dormant is the node's own hue at low chroma, via
   `color-mix(in srgb, var(--kind) 22%, var(--color-shell) 78%)`. Grey means
   disabled. Low chroma means resting.
4. **Words, not a zero.** Under Madras Kitchen: **`ready · nothing yet`**. Not
   `0`, not blank. The money page already says *"no requests in this period"* and
   this is the same voice. A bare `0` invites "is it broken?"; `ready` answers it.

### Breathing

Every node breathes: `scale(1) → scale(1.018)` over 4.5s, `ease-in-out`,
alternating, phase-offset per node by `index × 370ms` so the graph never pulses in
unison like a string of Christmas lights.

**Dormant nodes breathe slower and shallower** — 7s, `scale(1.010)`. That is
resting respiration, and it is the one cue that says "alive" when nothing else on
the node is moving. It is the difference between a sleeping animal and a
photograph of one.

CSS `@keyframes` on a `transform` — compositor only, no main-thread cost, and it
is already how the house does motion (66 `prefers-reduced-motion` blocks in
`globals.css`; this respects it and stops dead).

---

## 5. The dendrite ring — what makes 13 nodes look like a brain

Around each restaurant node, outside its channel ring, sit **33 short radial
spines** — one per feature that can be toggled. Lit = on, unlit track = off.

```
        ╷╷╷╷ ╷ ╷╷╷╷
      ╷╷            ╷╷
     ╷    ╭──────╮    ╷      33 spines. Lit ones are the features
     ╷    │ ▓▓░░ │    ╷      this restaurant has on. Unlit ones are
     ╷    │  ●   │    ╷      the features it could have. Both drawn.
      ╷╷  ╰──────╯  ╷╷
        ╷╷╷ ╷ ╷ ╷╷╷╷
```

Why this and not 33 child nodes: 3 restaurants × 33 features = 99 nodes of pure
noise, and the answer to *"what using"* is not "which 33 things exist" but "how
many, and which". A spine ring answers it in peripheral vision — you can see at a
glance that one restaurant is denser than another — and the exact list is one
click away in the Features tab, where hovering a chip flashes its spine.

It is also the reason **a silent restaurant is not an empty node**. Madras Kitchen
has no traffic, but it has *configuration*, and configuration is real. Its spine
ring is fully drawn. That is honest, and it is the single biggest defence against
the day-one "why is that one empty" reaction.

Spines are 8px long, 1.5px wide, at radius `r + 12`. Below 34px node radius
(phone, ring 2) the ring degrades to a single arc with a count chip `21/33` —
never to 33 sub-pixel smears.

---

## 6. Measured vs modelled — problem 3

The house already has a rule, and it is on the live money page:

```tsx
// A DASHED UNDERLINE is the tell for "modelled".
// It survives greyscale and all 23 themes; colour alone would not.
<span className="underline decoration-dashed underline-offset-4">$7.58</span>
```

**Extend it. Do not invent a second vocabulary.**

| | Measured | Modelled |
|---|---|---|
| Line | **solid** | **dashed** (`6 4`) |
| Width | `∝ log₁₀(volume)`, 1→6px | **fixed 1.5px, always** |
| Motion | **pulses** — discrete packets | **drift** — `stroke-dashoffset` marching slowly |
| Label | plain | dashed underline, matching the money page |
| Routing | direct, node to node | **always via the platform node** |
| Click | shows the events | opens `<Source kind="estimate">`, existing copy verbatim |

### The three parts worth defending

**A pulse means "this happened." A drift means "this is apportioned."** Nothing we
did not measure is ever permitted to emit a discrete packet. A viewer learns that
in about three seconds without being told, and it makes dishonesty structurally
impossible rather than a matter of remembering to be careful.

**Modelled edges have fixed width.** Scaling a modelled line's thickness by its
modelled value implies a precision the model does not have. The money page already
says it: *"the box costs the same with one restaurant or fifty. A share of it is a
fair split of rent, not a claim about who caused spend."* A fat line would be a
claim about who caused spend. The number goes on the edge as a label with its
dashed underline; the geometry stays neutral.

**Routing is the argument.** This is the part I would defend hardest:

- **Measured AI edges go restaurant → model, directly**, bowing over or under the
  platform node so they visibly *avoid* it. NIRAI → Sonnet 4.6 is a thing that
  actually happened, logged, 343 times. Nothing mediated it.
- **Modelled cost edges never connect a restaurant to a service.** They go
  restaurant → platform (one dashed edge, the total share, `$7.58`), and then
  platform → each AWS service. Because that is what is true: the platform pays
  AWS; restaurants are apportioned a share of the platform.

The practical payoff is large. Restaurant→service would be 4 × 7 = **28 dashed
lines crossing the middle** — a hairball, and the page would be ugly *and* wrong.
Routing through the stem gives **5 in + 7 out = 12**, and the viewer can literally
watch the apportionment happen at the point where it happens. You can see the
model *being* a model.

### Latency — the finding nothing else shows

NIRAI averages 857ms. NIRAI.Reading averages **5,242ms**. Six times slower, and no
screen in the product says so.

**Pulse travel time = the call's latency. One second of animation per second of
call.**

```
duration_s = clamp(avg_latency_ms / 1000, 0.4, 6.0)
```

NIRAI's packets snap across in under a second. Reading's crawl. Same distance,
same edge length, visibly different speed — and you get it without a tooltip,
without a legend entry, without clicking. It is the most literal mapping available
and it is the reason this page earns its place rather than being a prettier
version of a table.

Pulse **rate** = volume:

```
emit_hz = clamp(calls / window_seconds × 900, 0.15, 3)
```

so a busy edge is a stream and a quiet one an occasional blip — and an edge with
60 calls still fires often enough to be *seen* within a few seconds of looking,
which matters more than proportional honesty at the low end. The proportional
truth lives in the width and the label.

A **failed** call (`ok = false`) is a pulse that travels ~60% of the way and
dissipates in `--tone-bad`. Zero failures today, so it will be invisible until the
first time it matters, which is exactly right.

---

## 7. Interaction — problem 5

House law: *tiles → popup*, *"click anything, do anything"*, and **he hates
scrolling**.

### Hover (desktop) — neighbour highlight, no click needed

Hovering any node:
- that node lifts (`scale(1.05)`, 140ms)
- **every edge it touches goes to full strength; every other edge drops to 12%**
- non-neighbour nodes drop to 35% chroma, keeping full-opacity outlines and text
- a 3-fact tooltip appears next to the cursor — never 900px from the thing it
  describes

Neighbour highlighting is the highest-value interaction in any node-link diagram
and it costs one class toggle. It answers "which one points to which one" by
pointing.

### Click → `SheetPopup`, and the popup is TABBED

`components/SheetPopup.tsx` already exists: centred on both axes, back-button
aware, stacking, locks the page behind it, sized to its content. Use it.

**Not a side panel.** A side panel steals ~380px of width from the graph — the
exact complaint. **Not in-place expansion** for detail — the node is 70px wide.

**Tabbed, not scrolled.** Each tab fits one screen. `Segmented` from
`components/ui.tsx` does it, and the app already uses this pattern via `SubNav`.

Restaurant popup:

| Tab | What it holds |
|---|---|
| **Overview** | plan, status, seats used / limit, owner email, created, last seen, a 30-day sparkline |
| **AI** | calls · cost · input/output tokens · avg **and p95** latency · per-model split (Sonnet vs Haiku) · per-kind (chat / vision / health) · failures · last used |
| **Features** | the 33 as chips, on/off. Hovering a chip **flashes its spine** on the node behind |
| **People** | users, roles, last active — from `audit_events` |
| **Cost** | the modelled share, the formula, and `<Source kind="estimate">` copy **verbatim** |

That table is the literal answer to *"what are all ther..what using..what aws bill
they consufe..what ai they using..hw muhc time..how many token"*. Every figure
carries its unit. Every modelled figure carries its dashed underline.

### Double-click / the `Focus` button → isolate

The graph re-lays-out with that node as the new centre: its neighbours become
ring 1, everything else recedes to 8% and stops pulsing. A breadcrumb chip appears
top-left — `DineAI › NIRAI` — and clicking it returns. 600ms
`cubic-bezier(0.22, 1, 0.36, 1)`, the house draw easing from `charts.tsx`.

This is the answer to *"which one is under whihc one"*: you do not read the
hierarchy, you stand in it.

### Keyboard

| Key | Does |
|---|---|
| `Tab` | into the graph, then between nodes in ring order |
| `←` `→` | previous / next sibling on the same ring |
| `↑` `↓` | toward the centre / away from it |
| `Enter` | open the popup |
| `F` | focus / isolate |
| `Esc` | close popup, then un-isolate, then blur |

The mapping matches the geometry, so it is learnable rather than memorised.

### Mobile

The hemispheres **rotate 90°**: demand on top, supply on the bottom. A phone is
tall, and two hemispheres want the long axis. Same structure, same code, one
rotation constant.

- ring 2 collapsed; spine rings degrade to a `21/33` chip
- labels become a fixed two-line caption under each node, never radial
- tap = popup · long-press = neighbour highlight · pinch = zoom · double-tap =
  reset
- 44px minimum hit target — enforced by an invisible `<circle>` behind every node,
  not by the visible radius

Measured budget at 390×844: header 57 + nav strip 55 + title 72 + legend 44 →
canvas **358 × ~600**. Ten visible nodes at 26–40px radius fit without
overlapping, which is why ring 2 is collapsed there.

---

## 8. The library decision — no new library

**Hand-rolled SVG for structure + one `<canvas>` for the pulses. Net new
dependency cost: 0 KB.**

### What each option would cost

| | Installed? | Added gzip | Verdict |
|---|---|---|---|
| `d3-force` (+ `d3-selection`, `d3-zoom`) | **no** | ~10 + ~8 + ~7 ≈ **25 KB** | buys a sim we do not want (§2) |
| `react-force-graph` | **no** | **~180 KB**, drags in three.js | no |
| `cytoscape` | **no** | **~120 KB** | no |
| `sigma.js` + `graphology` | **no** | ~60 + ~30 ≈ **90 KB** | built for 10k nodes; we have 13 |
| `three` / `@react-three/fiber` | in `package.json`, **imported nowhere** | **~150 KB+** | see below |
| hand-rolled | — | **0 KB** | ✅ |

### Why three.js is a trap, not a head start

It is listed as a dependency, so it looks free. It is not:

1. **It is imported by zero files.** Tree-shaken to nothing today. Importing it
   here adds ~150 KB gzip to this route that the app does not currently pay.
2. **He already rejected WebGL on aesthetics** — the landing journey was pivoted
   away from it because it *"looked cartoon"*. Walking back into it on the one
   page where he has asked to be impressed is a bad bet.
3. **Labels die.** In WebGL every label is either a texture (blurry, unselectable,
   invisible to screen readers) or a DOM overlay you sync by hand every frame.
   This page is ~40% labels, and *a number without its unit is worse than no
   number* — the text is the point.
4. **The theme system does not reach it.** `var(--color-brand-400)` resolves in
   SVG `fill` / `stroke` / `stop-color` — already verified in the house chart kit.
   It resolves in nothing WebGL touches.

### Why hand-rolled is right, not just cheap

`components/charts.tsx`, line 3: *"The DineAI chart kit — hand-rolled animated
SVG, no library."* Sparkline, AreaChart, Donut, Bars and Meter are all hand-rolled,
all theme-correct, all reduced-motion aware. This page should be a citizen of that
kit, not a foreign body inside it.

**And we do not need a solver.** The layout is deterministic (§2). The only thing
d3-force would buy is label de-overlap, and with ≤20 visible nodes that is a
30-iteration angular nudge in ~40 lines:

> for each ring, sort nodes by angle; while any two labels overlap and iterations
> remain, push the pair apart by half the overlap in radians, clamped to the
> band's arc. Converges in under 10 iterations at this size. Seeded, so the
> picture is identical on every load.

CSP does allow cdnjs and jsdelivr, so a CDN load is *possible*. It is still wrong:
a render-blocking third-party request on a core operator page that must work on
hotel wifi, for a layout algorithm we are not using.

### The two-layer architecture

```
┌─ SVG   (bottom)  edges · nodes · spines · channel arcs · band labels · text · focus rings
├─ CANVAS (mid)    pulses ONLY · pointer-events:none · one rAF · ≤40 sprites
└─ SVG   (top)     transparent hit circles, 44px min, tabindex, aria-label
```

SVG where you need text, theme `var()`, hit-testing and accessibility. Canvas
where you need many independently-moving things — 40 animating SVG circles means
40 style recalcs and a layout pass per frame; 40 `ctx.arc()` calls is nothing. No
WebGL, because 40 sprites does not need a GPU pipeline.

**The trap that will bite whoever builds this:** *canvas cannot read
`var(--color-brand-400)`.* Resolve the palette once with `getComputedStyle` on the
SVG root, cache it, and **re-resolve in an effect keyed on `useTheme().theme`**.
Miss it and the pulses silently keep the old theme's colours forever while the SVG
around them repaints correctly — the same class of bug as the `mise_theme` and
`data-mode` entries already in the traps table.

---

## 9. Theme — the rules that keep it alive on all 23

His Control Room is white today (§0). These are hard.

**1. No additive glow.** No `mix-blend-mode: screen`, no `filter: drop-shadow` for
halos. Both are black-ground tricks and both vanish on white.

**2. A halo is `color-mix`, not a shadow.** Three concentric rings of the node's
colour mixed toward `--color-shell` at falling alpha. Reads as a glow on black and
a bloom on white, because it is always moving toward whatever the ground is.
(Hex-alpha concatenation — `${c}26` — is invalid on a `var()`; already in the traps
table.)

**3. "Bright" is a direction, not a colour.** Everywhere this spec says *lit*,
implement it as *toward `--color-fg`, away from `--color-shell`*:

```css
--lit:     color-mix(in srgb, var(--kind) 82%, var(--color-fg)    18%);
--dormant: color-mix(in srgb, var(--kind) 22%, var(--color-shell) 78%);
--pulse:   color-mix(in srgb, var(--kind) 85%, var(--color-fg)    15%);
```

`--color-fg` is `#eef6f1` on dark themes and `#000000` on light ones, so one
expression goes brighter on black and deeper on white with no branching and no
`[data-mode="light"]` override. This single rule is what makes the page theme-proof
rather than theme-patched.

**4. Kind colours come from the chart ramp**, which is already known to resolve in
SVG presentation attributes:

| Kind | Token | Shape |
|---|---|---|
| Platform | `--color-brand-500` | rounded square — it is literally one box |
| Restaurant | `--chart-1` (follows the brand) | circle |
| Anonymous | `--chart-8` slate | circle, **hatched fill** |
| AWS service | `--chart-3` sky | hexagon |
| AI model | `--chart-7` violet | diamond |
| Orphan | last colour, low chroma | circle with a **gapped** ring |

`--chart-2..8` are fixed hexes by design (categorical, not theme-following).
`--chart-7` (`#a78bfa`) on white is fine as a large fill and **fails as a thin
stroke**. So every stroke and every small label derives from the kind mixed toward
`--color-fg` per rule 3 — never the raw token.

**5. Text never sits on a glow.** Labels are DOM text in `text-fg` / `text-fg-soft`
on the card ground, outside the halo radius. Contrast stays whatever the theme
already guarantees.

**6. The canvas is `mise-card-inset`**, like every other surface in this app. Not a
raised slab, not a black panel floating in a light page.

---

## 10. Loading, empty, error

**Never a spinner on an empty rectangle.** *An empty state that renders nothing
looks like a failure.*

**Loading — the skeleton IS the graph.** Draw the structure we already know: the
platform node, the four ring paths as hairlines, the four band labels in place. A
soft highlight travels around each ring path (a `<linearGradient>` sweeping its
`gradientTransform`, ~1.6s). Nodes then land as the payload arrives, staggered
40ms, each with `mise-pop`. It looks like a brain waking up; more usefully it is
*true* — those rings are exactly where the nodes will be, so nothing jumps when
the data lands.

**Empty (no tenants at all).** The platform node alone, labelled, four empty bands,
and one line of copy under the centre:

> One platform node, no tenants yet. The first restaurant to sign up appears here.

**Error.** Reuse `ErrorCard` from `app/control-room/page.tsx` — the status number in
mono, the copy from `errorCopy()`, a Retry button — floated **over** the skeleton,
not instead of it. The shape of the page survives its own failure.

**Partial.** If AI data loads and cost does not, draw the graph with the AI edges
live and the cost edges as hairline tracks carrying a chip reading
`cost unavailable`. Never silently draw a $0 edge; a modelled zero is an invention,
and the money page already refuses to do this.

---

## 11. Legend — learnable without a manual

Two devices, no popup, because *a legend you have to open is a legend nobody
reads*.

**1. The four band labels** (§2). Half the work, free.

**2. A live legend bar** pinned along the bottom of the canvas — ~44px, full width,
which also spends space he would otherwise call wasted. Every item is rendered as
**the actual thing**, not a swatch:

```
 ◯ size = volume     ── measured     ╌╌ modelled (a share, not a bill)
 ● pulse = one call · its speed = how long that call took
 ○ restaurant    ⬡ AWS service    ◆ model    ▨ not a tenant    ◌ deleted
```

**The legend is a query tool.** Hovering `╌╌ modelled` makes every modelled edge
flash and drops everything else to 10%. Hovering `⬡ AWS service` lights the seven
services. It teaches by demonstration in one second and doubles as a filter, which
is strictly more useful than a key.

**3. One sentence under the page title**, same voice as the money page:

> Size is volume. Solid lines were measured. Dashed lines are a model.

Three sentences, no jargon, permanent, never explained again.

---

## 12. The real risk: 13 nodes looking cheap

Not performance. At 13 nodes nothing is slow. The risk is that the page looks
*thin*, and thin reads as cheap — the same way *the same invitation on 13 cards*
reads as cheap.

Density is bought honestly, in this order:

1. **Big nodes.** With 13 nodes in 1634×951 each one can be 60–110px and carry a
   label, a figure, a unit and a channel ring. That is generous, not sparse.
2. **The spine ring** (§5) — 33 marks per restaurant, real information, no extra
   nodes.
3. **Edges are mass.** 13 nodes but ~26 edges, curved, crossing a lit midline.
4. **The band labels and the live legend** occupy the outer margins — exactly
   where a radial layout otherwise leaves a dead corner.
5. **Content drives height.** The canvas sizes to its container via
   `ResizeObserver`; it never pads itself to look busy. *Padding a thin thing to
   look busy always shows.*

**If it still looks thin in the build, the fix is bigger nodes and more per-node
detail — never more nodes.** Do not invent a node. Do not draw a decorative
"synapse field" of meaningless dots behind the graph; that is the
repeated-stock-photograph failure in a different medium.

### Fitting without scrolling

Available `main`: **1634 × 1111**. Title block 92px + legend bar 44px + gaps 24px
→ canvas **1634 × 951**. The page does not scroll at 1920×1080, which is the rule
for this area anyway — the overview page's own header comment says *"one screen,
no scroll"*.

A `7 / 30 / 90 days` `Segmented` sits in the title row, matching the money page
exactly. `ai_usage` holds 90 days, so the control is never disabled on arrival —
*a control that is disabled on arrival reads as broken*.

---

## 13. Performance budget

**Target 60fps. Floor 30fps. Hard cap 40 in-flight pulses across the whole graph**,
emitted from one rAF, drawn on one canvas, one `clearRect` per frame.

Degradation ladder, in the order it fires:

| Trigger | Degrade |
|---|---|
| `prefers-reduced-motion` | **all** motion off — no pulses, no drift, no breathing. Each edge gets a static count chip instead. Non-negotiable; 66 blocks in `globals.css` already do this. |
| `document.hidden` | cancel the rAF entirely. Zero cost in a background tab. Four lines, and the largest real-world saving on a page left open all day. |
| nodes > 60 | drop the `color-mix` halo rings |
| nodes > 120 | per-edge pulses off; each edge gets one marching dash instead |
| nodes > 200 | ring 2 collapsed by default; leaf labels become hover-only |
| frame time > 22ms for 30 consecutive frames | halve the pulse cap, then drop halos. **Latches** — measured once, never oscillates |

Today's graph is 13 nodes. Every ceiling above is a future guarantee, not present
work.

### Is continuous animation worth the frame cost? Honestly

**Yes — and only because the animation is the information.**

If the pulses were decoration I would cut them, and I would say so. They are not:
pulse rate is volume and **pulse speed is latency**, and latency is the one genuine
finding on this page. Reading being 6× slower than NIRAI is not visible on any
screen in the product today and cannot be shown by a static image.

The decoration is the breathing. I keep it because a graph that is perfectly still
reads as a screenshot, and the whole brief is that this thing is alive — but it is
capped at 1.8% scale, it is CSS on the compositor rather than rAF on the main
thread, and it is the first thing after motion-preference to go.

Measured cost at 13 nodes: ~26 edges × ~1.2 pulses in flight ≈ 30 sprites, 30
`arc()` calls per frame, one `clearRect`. Sub-millisecond. The SVG layer is static
between interactions and costs nothing per frame at all.

---

## 14. Requirements on the data payload

Not an API design — the fields this visual cannot be built without. The planner
owns the shape.

1. Per node: `kind`, `id`, `label`, **`magnitude` + its `unit`** (never a bare
   number), and **`source: "live" | "billed" | "estimate" | "entered_by_hand"`** —
   the existing `SourceKind` union in `components/controlroom/Source.tsx`. Reuse
   the type; do not mint a second one.
2. Per node, **per channel**: `{ channel, fired: boolean, volume, unit }`.
   `fired: false` draws an unlit track; a *missing* channel draws nothing. Those
   two must be distinguishable in the payload or §4 is unbuildable.
3. Per edge: `from`, `to`, `measured: boolean`, `volume`, `avg_latency_ms`,
   `p95_latency_ms`, `failures`, and the display `label` **with its unit**.
4. `avg_latency_ms` per **edge**, not only per node — the Sonnet edge and the Haiku
   edge have different latencies and §6 animates them separately.
5. The orphan must arrive as a **first-class node** with `orphan: true,
   parent: null`, not as a filtered-out row. If the API drops it, the best thing on
   this page does not exist.
6. Feature state as a stable-ordered `boolean[33]` with names — stable order
   matters, because a spine that moves between loads is noise.
7. **`response_model` silently drops undeclared fields — nine occurrences in this
   codebase.** Every field above must be declared on the Out schema. The failure
   mode here is specific and quiet: `fired` goes missing, every node renders as
   dormant, and the page looks broken rather than empty.

---

## 15. Accessibility floor

- **The List view is the accessible interface, and it is a real feature.** A
  visible `Graph / List` toggle, always in the tab order, renders the identical
  data as a `<table>` grouped by hemisphere. A node-link diagram has no good
  screen-reader representation, and pretending otherwise ships something worse than
  a table. It is also the `prefers-reduced-motion` fallback and the low-power
  fallback — built once, used three times.
- Each node is a focusable `<g tabindex="0" role="button">` whose `aria-label` is a
  full sentence: *"NIRAI.Reading, restaurant, 60 AI calls, 127,458 tokens, average
  latency 5.2 seconds, no HTTP requests in this period."*
- The SVG is `role="img"` with an `aria-label` summarising the whole graph in one
  sentence, and `aria-describedby` pointing at the legend.
- Focus ring: 2px `--color-brand-400` halo plus a 1px `--color-fg` offset ring, so
  it is visible on every one of the 23 grounds.
- **Never colour alone.** Shape (circle / hexagon / diamond / hatched / gapped),
  dash-vs-solid, and the text label all survive greyscale. **Acceptance test: a
  greyscale screenshot in which every node kind and every edge kind is still
  distinguishable.**
- Live regions off. A graph that announces every pulse is unusable.
- Motion: everything in §4, §6 and §11 stops under `prefers-reduced-motion`.

---

## 16. What would make this fail, ranked by what he sees first

1. **Built glow-on-black.** Opened on his white theme, it is a grey smudge. §9
   exists only to prevent this. **Verify on `chalk` AND `nocturne` before claiming
   it works.**
2. **Dormant rendered as grey, or as a smaller node, or as `0`.** Two of the three
   restaurants would read as broken components in the first second. §4 rules 1–4.
3. **The orphan filtered out** because it has no parent. The best fact on the page
   silently absent.
4. **28 dashed lines** restaurant→service. A hairball, and epistemically wrong.
   §6 routing.
5. **Canvas palette cached across a theme change.** Pulses keep the old theme's
   colour forever while everything around them repaints. §8.
6. **A number without its unit.** `857` instead of `857ms`, `6.43` instead of
   `$6.43` — which the money page is doing right now, ten times.
7. **A side panel** instead of the popup. 380px of width gone, and his most
   frequent complaint lands on the page built to impress him.
