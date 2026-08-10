# Purchasing — the master plan

His brief: *"we need a complete re code of purchase UI... we need a jaw drop
kinda style ui, ux, friendly etc, smooth transition, smooth ui... also think
urself and have a different kinda ui."*

Written before any code, so the changes are made against a plan rather than
invented one screen at a time.

---

## 1. What this page is actually for

A chef or manager already knows what the kitchen needs. They are not browsing.
They want to turn "we're low on onions and out of paneer" into orders sitting
with the right suppliers, and then get back to service.

**Ordering is not shopping — it is writing a list.**

That single sentence is the whole design. Every consumer food app in the
research is built for someone who does not yet know what they want: big
photography, discovery, browse-then-decide. This page is the opposite. The user
knows. The app's job is to get out of the way of a person writing a list, and
to be cleverer than paper about who to send it to.

The current page is built like a catalogue: search, category chips, a grid of
item cards to hunt through. That is why it feels like work.

## 2. What is wrong now, specifically

| | |
|---|---|
| **It opens on a form, not an answer** | You arrive knowing you need to order. The page opens with an empty search box and asks you to go and find things. It already knows what is low — 8 items — and makes you click to hear it. |
| **Choosing and saying-how-much are separated** | Tick items, then go to a tray, then type quantities. Two passes over the same list. On paper you write "onions 20kg" in one motion. |
| **The catalogue is a wall** | Sixty items as rows to scroll and scan, when you probably want six of them and you already know their names. |
| **The order is invisible while you build it** | Until the pocket was added there was nothing; now there is a count, but not the shape of what you are about to send, or to whom, or for how much. |
| **No keyboard path** | This is a daily, repeated task done by someone in a hurry. Everything needs the mouse. |

## 3. The design — "the order pad"

One screen. No stage-swapping, no "next". Three zones that are all true at once:

```
┌──────────────────────────────────────────────────────────────────┐
│  Purchasing            2 waiting · 13 open · £1,856 committed    │  rail
├───────────────────────────────┬──────────────────────────────────┤
│  NEEDS YOU                    │  THE ORDER                       │
│  ┌─────────────────────────┐  │  ┌────────────────────────────┐  │
│  │ ⚠ 8 items low   Add all │  │  │ Farm2Land         £142.60  │  │
│  └─────────────────────────┘  │  │   Onion (red)  25 kg       │  │
│                               │  │   Lemon        2 case      │  │
│  ┌─────────────────────────┐  │  ├────────────────────────────┤  │
│  │ ✎  onion 25            │  │  │ SK                 £38.10  │  │
│  │    ↳ Onion (red) · 25kg │  │  │   Paneer       6 kg        │  │
│  │       Farm2Land £0.90   │  │  └────────────────────────────┘  │
│  └─────────────────────────┘  │                                  │
│      the pad — type a name,   │  £180.70   2 suppliers           │
│      then a number, Enter     │  ┌────────────────────────────┐  │
│                               │  │      Send both orders  →   │  │
│  recently ordered · low       │  └────────────────────────────┘  │
└───────────────────────────────┴──────────────────────────────────┘
```

**The pad (left).** One input. Type a few letters, the best match resolves
underneath with its chosen supplier and price. Type a number, press Enter, and
the line flies across into the order. The caret stays put, ready for the next
line. This is the paper list, made cleverer.

- `onion 25` — name and quantity in one go, as anyone would write it
- `onion 25 packets` — the pack chain is already built, so a size is just a
  third word
- Arrow keys pick between matches; Enter commits; Escape clears
- Never a dead end: no match offers "add a new item" inline

**Needs you (top left).** The answer, before the question. What is low, what is
out, what a supplier has raised the price on. One tap loads them all into the
order at par-topping quantities — the reorder logic already exists.

**The order (right).** Grouped by supplier as it builds, because that is the
shape it will actually be sent in, with each supplier's subtotal and the grand
total live. You can see what you are about to commit without opening anything.

**On mobile** the two columns become one, the order collapses to the pocket,
and tapping it opens the popup that already exists. The pocket earns its place
on a phone — on a desktop the order is simply visible, which is better.


## 3b. Picking without scrolling — and making it fun

His constraint, and it is the sharpest one: *"i should not feel the scroll...
without scroll how we can allow user to pick item.. grp items... just think...
picking will be a fun."*

**The realisation: you never need to SEE sixty items to pick six.** Scrolling a
catalogue is not how you find something you already know the name of — it is
how you find something when the app has given you no better way. Two better
ways, and neither scrolls:

### Way one — summon it (type)

The pad. Three letters and the thing appears. You never meet the other
fifty-seven items because you were never looking for them. For someone who
knows what they want — which is everyone doing this job — this is the fastest
route that exists, and there is nothing to scroll because there is no list.

### Way two — drill one level (tap)

Thirteen categories fit on one screen easily. Tap **Vegetables** and its items
replace the panel as a grid of tiles, sized so the whole category fits — no
scrollbar, ever. Tap the tile, it flies to the order. Tap **← all** to go back.

    ┌───────────────────────────────────────────┐
    │  🥬 Veg   🥛 Dairy   🐟 Fish   🍗 Meat  … │   one tap in
    ├───────────────────────────────────────────┤
    │   🍋       🧅        🍆        🥕         │
    │  Lemon    Onion   Aubergine  Carrot       │   the whole
    │  18 pc    12 kg     17 kg    23 kg        │   category,
    │                                           │   one screen
    │   🌶️       🥦        🍅        🥔         │
    │  Chilli  Broccoli  Tomato   Potato        │
    └───────────────────────────────────────────┘

This is how a POS works, and every chef already knows a POS. Big targets, one
level deep, no hunting.

**When a category will not fit**, the tiles do not scroll — they get smaller,
down to a floor. Below that floor it pages, with dots, like a phone home
screen. Paging is a decision you make; scrolling is a thing that happens to
you, and the difference is exactly what he is describing.

### Why this is the fun part

Fun here is not decoration, it is **tactility**. Picking should feel like
putting something in a basket, because that is what it is:

- Tiles are **large and pressable**, with a real press (scale down, spring
  back). Fingers and mice both like a big target that responds.
- The tile **throws a copy** of itself to the order, on an arc — the item
  visibly leaves your hand and lands.
- The order **catches it** — the supplier group opens, the total rolls up.
- Categories **stagger in** when you drill, a few milliseconds apart, so the
  set arrives as a group rather than a flash.
- Picking an item you already have **pulls it back out** with the same arc
  reversed. Undo should feel as good as do.

A screen that never scrolls, targets you cannot miss, and something physical
happening every time you touch it. That is the whole trick — there is no
cleverness in it beyond refusing to make somebody hunt.

## 4. Why this is different, and why it should land

- It is **keyboard-first for a repeated daily task**, which is what
  professional tools do and what consumer shopping UIs never do. The research
  calls this a "quick order pad" and it is the single strongest B2B pattern
  found.
- It **collapses two passes into one**. Choosing and quantifying happen in the
  same keystroke sequence.
- It **shows the money while you spend it**, live, grouped the way it will be
  sent — the research's "real-time total" pattern, applied to the thing that
  actually decides whether you press send.
- It **opens with the answer**, so the common case ("order what's low") is one
  tap, not a search.

## 5. Motion — the "jaw drop", with rules

Motion here is feedback, not decoration. Rules, taken from the research and
already proven in this codebase:

- **Spring easing** `cubic-bezier(0.34, 1.56, 0.64, 1)` — a slight overshoot
  reads as physical. Already used by the pocket's catch.
- **Under 300ms** for anything you trigger; the fly-to-order arc is 620ms
  because it crosses the screen and needs to be followed by the eye.
- **Transforms and opacity only** — never width/height/top, which force layout
  and stutter.
- **`prefers-reduced-motion` respected everywhere**, no exceptions.

The moments worth animating, and nothing else:

1. **A line lands in the order.** It arcs across, the supplier group opens to
   receive it, and the total rolls up to its new value. One movement, three
   parts — the throw, the catch and the consequence.
2. **A new supplier group appears.** Springs down from nothing rather than
   snapping in; it is a real event, you have just involved another supplier.
3. **The pad resolves a match.** The suggestion rises a few pixels as it
   settles, so you feel the app agreeing with you.
4. **Send.** The groups fly off as separate orders, because that is literally
   what happens.

## 6. Order of work

1. **The pad** — parser, matcher, keyboard handling. The heart; useless if
   wrong, so it gets tests: `onion 25`, `onion 25 packets`, ambiguity, no match.
2. **The live order panel** — supplier grouping, subtotals, the rolling total.
3. **Needs you** — the low/out/price-rise strip on the reorder logic that
   already exists.
4. **Motion** — the four moments above, once the structure is right. Animating
   a layout still in flux is how you end up with the dev page shaking.
5. **Mobile** — one column, order collapses to the pocket.
6. **Retire** what this replaces: the scrolling catalogue, the category chip
   strip, the two-stage tray, the separate quantity pass.

Steps 1 and 2 are independent of 3-6 and ship on their own, so the page
improves in usable pieces rather than in one risky swap.

## 7. What is deliberately kept

- The **pocket** — his idea, and correct on mobile.
- The **indent → PO model** underneath. This is a new face on the same
  workflow; no data model changes, no migrations.
- **Every click meaning something**, and **click anything, do anything**.
- The pack chain: sizes appear in the pad as a third word rather than a
  separate control.

## 8. How it gets judged

Not "does it look modern". These:

- Can someone order six low items in **under fifteen seconds**, without a mouse?
- Can they see what they are about to spend, and with whom, **without opening
  anything**?
- Does the first screen answer "what do I need to order?" **before** it asks
  anything?
- **Is there a scrollbar anywhere in the picking flow?** If yes, it has failed
  his clearest instruction. Type, or drill one level, or page — never scroll.
