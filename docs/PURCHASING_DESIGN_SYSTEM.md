# The purchasing page — a design system, not a pile of tweaks

> "pleaseeeeeeee i want best ui design animation styles in this entire purchase
> page… think, put a master plan please and do that plan"

Fair. The page has been improved a piece at a time and it shows: each part is
defensible and the whole is not one thing. This is the plan, and the rules it
has to obey.

---

## The problem, stated honestly

Three separate complaints keep coming back, and they are all the same
complaint:

1. **"the cards are not nice, I want 3D feel"** — the cards had a shadow. A
   shadow is not depth. Real objects show their **side**; a rectangle with a
   blur under it reads as a sticker no matter how good the blur is.
2. **"the colour should have a meaning instead of random"** — it DID have a
   meaning and the meaning was **broken**: `/ice/` matched **R·ice** and
   **Sp·ices**, so Rice, Spices, Grains & Rice and Rice & Flour were all
   labelled *frozen*. He was right that it looked random. It was.
3. **"the flip is not realistic"** — it rotated, but nothing else about it
   behaved like an object turning: no weight, no shadow swing, no dip.

---

## The four rules

**1. One material.** Everything on this page is cut from the same block. The
same face, the same light from the top-left, the same thickness. A page reads
as designed when its parts look like they were made by the same machine.

**2. Depth is a SIDE, not a shadow.** The tile has a visible edge — a hard
3px band in a darker tone below the face. That band IS the object's thickness.
Pressing collapses it: the face travels down by exactly the thickness and the
band disappears, which is what a physical key does. This is the whole
difference between "flat with a shadow" and "a thing on a surface".

**3. Colour is information or it is absent.** The stripe says how the item is
STORED — fresh produce, raw, chilled, frozen, dry store, drinks, not-food —
because that decides where a delivery goes and how fast it must be used. The
tile spells the word out, so the colour teaches itself and can be checked. No
decorative colour anywhere on this page.

**4. Motion shows cause and effect.** Every animation answers "what just
happened to what". Nothing loops, nothing decorates, nothing runs while
somebody is trying to read.

---

## What that means, concretely

| Surface | Treatment |
|---|---|
| Category tile, item tile, basket line, indent row, PO row | `.mise-tile` — one material, storage-colour stripe, press collapses the side |
| Primary action | `.mise-btn-key` — the same block in brand colour, light runs its edge once on hover |
| Secondary action | `.mise-btn` — the same block, page colour |
| Basket line | turns over; the whole face is the control |
| Popups | arrive from the centre on a spring, contents cascade, one pass of light |

## Motion budget

| Moment | What it says | Length |
|---|---|---|
| press | this is a physical control | 90ms |
| card turn | the detail was always on the back | 620ms |
| add to basket | THAT went in THERE | 820ms |
| submit | the order left, the stack unbuilds | ~1.4s total |
| popup open | this arrived over the page | 420ms |

Nothing else moves. If an effect cannot be explained in one sentence of what it
TELLS the user, it does not ship.

## The flip, made physical

A turn is not a rotation. Four things happen together:

- the tile **dips** (`scale .96`) at the halfway point — weight
- its **shadow swings** the opposite way — a light source that stays put
- the **side band fades** as the face turns edge-on — you cannot see the side
  of a thing you are looking at edge-on
- a **wave of light** crosses at the moment the faces swap

## The basket

Wider, and multi-column at every size that can hold it — a column of one is
what made twenty items a long scroll. The panel grows with what is in it up to
a cap, then scrolls; groups fold so one supplier never buries the next.

## What this plan does NOT do

- No looping ambient motion on a working screen.
- No colour without meaning.
- No effect that delays an action to show itself.
