# Where each effect goes — the chaining plan

His ask: *"we need to check all and we need to put super master plan like where
to fit which one.. like a chaining.. so many things to make our site so much
impressive, jaw drop user exp."*

Source: **React Bits** (reactbits.dev) — 165 components, catalogue read in full
from `https://reactbits.dev/r/registry.json`.

---

## The rule that decides everything

**DineAI is a tool people use all day, in a hurry, during service.** That is
not the same job as a landing page, and the same effect can be brilliant in one
and awful in the other. A liquid shader behind a headline is impressive; the
same shader behind an order form is a thing that gets in your way at 7pm on a
Friday and never stops.

So the catalogue splits in two, and the split is the plan:

| | Where | What it may do |
|---|---|---|
| **WORK screens** | purchasing, inventory, kiosk, reports | Motion must MEAN something — confirm a tap, show a number changing, point at what needs attention. Under 300ms. Nothing decorative, nothing continuous, nothing that runs when you are not looking at it. |
| **SHOW screens** | landing, award, careers, public menu | Spectacle is the job. This is where the shaders, the scroll films and the cursor toys belong, and where "jaw drop" is the actual requirement. |

A working screen earns attention by being fast. A show screen earns it by being
beautiful. Confusing the two makes both worse.

## What we can use for free

Already installed: **gsap 3.15**, three, @react-three/fiber, lenis.
So these cost nothing to adopt:

- **Zero dependencies:** ClickSpark, GlareHover, Magnet, ElectricBorder,
  ScrollExpand, SpotlightCard, StarBorder, Stepper, ShinyText
- **GSAP (already here):** AnimatedContent, FadeContent, MagicBento

Deliberately **not** adopting `motion@12` (~30kb) for CountUp / AnimatedList /
BlurText. A rolling number is twenty lines of `requestAnimationFrame`, and this
app should not ship an animation library to every till and wall tablet for one
effect. Written locally instead.

---

## The chain — work screens

### Purchasing (the current focus)

| Effect | Where | Why it earns its place |
|---|---|---|
| **ClickSpark** | the pick tiles | His words: "picking will be a fun". A spark at the point of contact is the cheapest possible way to make a tap feel like it landed. |
| **CountUp** *(local)* | the order total | The plan already said "the total rolls up". Money changing is the one number on the page worth animating. |
| **GlareHover** | category tiles | A light sweeps across as you pass. Makes a grid of tiles feel like objects rather than rectangles. |
| **Magnet** | "Submit indent" | The primary action leans toward the cursor. One button on the page, and it is the one you came for. |
| **ElectricBorder** | low-stock alert | Reserved for things that genuinely need you. If everything glows, nothing does. |
| **Stepper** | indent → approved → PO → received | The pipeline already exists as four numbers; this makes it read as a journey. |

### Elsewhere

| Effect | Where |
|---|---|
| **CountUp** | dashboard KPIs, P&L headline, the price-comparison saving |
| **SpotlightCard** | dashboard cards — the cursor lights what it is over |
| **StarBorder** | the cheapest supplier in Price Comparison |
| **AnimatedContent** *(gsap)* | section reveals on long pages: reports, how-it-works |
| **ShinyText** | the saving figure, when there is money in it |

## The chain — show screens

| Effect | Where |
|---|---|
| **ScrollExpand** | landing hero — his specific ask. A rounded frame growing to full bleed as it scrolls is exactly the "smooth style" he pointed at |
| **ScrollStack** | landing feature cards, stacking as you descend |
| **ScrollReveal** | landing copy, unblurring as it arrives |
| **MagicBento** *(gsap)* | the feature grid |
| **LogoLoop** | supplier / integration logos |
| **Aurora / Silk / Threads** | section backgrounds, one per page, never two |
| **CardSwap** | testimonials or the product tour |

## Order of work

1. **Purchasing** — ClickSpark, CountUp, GlareHover, Magnet. The page in front
   of him, and every one of these is on the picking flow he is judging.
2. **Dashboard + Price Comparison** — CountUp, SpotlightCard, StarBorder.
3. **Landing** — ScrollExpand, ScrollStack, ScrollReveal.
4. Everything else, only if it earns a line in this table.

## Rules, so this does not become noise

- **One idea per screen.** A page with five effects has none.
- **Nothing continuous on a work screen.** No looping shader behind a form.
- **`prefers-reduced-motion` honoured everywhere**, no exceptions.
- **Transforms and opacity only**, never width/height/top.
- If an effect cannot be explained in one sentence of what it TELLS the user,
  it belongs on a show screen or nowhere.
