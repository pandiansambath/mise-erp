# KAL · கல் — the temple design of the main page: master checklist

His ask (25 Nov 2026, §107.2): "we need one more new design like we have in [the] chest page… that
ancient style, temple detailings… that Thirukkural… explanation… it's overwhelming… we need this as a
separate design in our main page… this is going to be [a] huge task… create a super cool master
checklist for this special task… assign as much as agents… put major effort on this design please."

**The idea.** In Tamil one word, **கல்**, says *stone*; said to somebody, it says *learn*. The page is a
temple cut from one rock, from the top down, as Vettuvan Koil was: scrolling is carving. You carry a lamp.
What you pass is finished; below you is rock, with the masons' red lines on it, and it lets go as your
light comes. Kural 396 (dig deeper, more water; learn more, more is known) begins under his face at the
top and ends at the water's edge at the bottom.

- The whole blueprint (concept, 11 scenes with wireframes for desktop and phone, light, materials, type,
  motion, components, art list, acceptance): **docs/temple/ART.md** (the art director's, 25 Nov)
- Its words, place names and couplets (checked against Project Madurai): **docs/temple/WORDS.md**, D
- Shown as `?design=kal` only, until it is ready for the Themes window.

## A. Ground
- [x] A1 (26 Nov) the design registered, hidden (`DesignId` "kal"), lazily loaded, its own door lines
- [x] A2 (25–26 Nov) the sculptor's library (dev/art/sculpt.py): shapes, bands, frames, petals, beads, creepers,
      pilasters, kudus; writes sheets (slopes, openness, worn, height, masks) and their map
- [x] A3 (26 Nov; as pieces, not one sheet: wall, rock, side, eave, band, four frames, wheel, great kudu, roof, finials, railing) sheet A: raw rock, break cells, eave, trims, creeper, slab frames, wheel, great kudu, roof,
      finials, pilaster, bracket, railing, clay lamp
- [x] A4 (26 Nov; 7 ms a frame for the first screen on his laptop's graphics, drawn in tiles so each pays only for the light that reaches it) the stone renderer: one canvas that rides with the page, instances of modules, relief lit by the
      torch and the lamps, self-shadow, parallax; 60 fps on the phone, ≤ 11 ms on his laptop
- [x] A5 (26 Nov) cut letters: real text drawn by the browser, cut into the stone and FILLED with gold; the page's
      own text under it, selectable; never drawn twice
- [ ] A6 reading rules: text only on polished black granite, leaf, copper or sand; ≥ 5.6:1 in any light
- [ ] A7 the static twin (no WebGL, reduced motion): lit pictures of the same carvings
- [ ] A8 the meter (exposure rules measured on pictures), the fling test, the bench

## B. The scenes (each: composition · words · picture · what answers the hand · what one finds slowly)
- [x] B1 (26 Nov; desktop and phone) கலசம் · who he is: the horseshoe window with his face, the stone wheel of skills, the name
- [ ] B2 சங்கிலி · time and the months: chains of loose links cut from one stone
- [ ] B3 செப்பேடு · the résumé: copper plates on a sealed ring
- [ ] B4 மண்டபம் | கோலம் · AWS | Python & backend (pillars that sing; one line through every dot)
- [ ] B5 தோரணம் | வாய்க்கால் · Generative AI | Messaging & data (makara arch; water channel)
- [ ] B6 தேர் | பலகணி · DevOps & testing | Frontend (the chariot; pierced windows and their light)
- [ ] B7 கருவூலம் · education: the treasury's doors, the 17th rank, the way to the chest
- [ ] B8 பொற்றாமரை · recognition: the golden lotus pond
- [ ] B9 துலாக்கோல் · DineAI: the balance
- [ ] B10 அகல் | மணல் · volunteering | the shell (clay lamps; the sand tray)
- [ ] B11 கேணி · the finale: the last uncut block, கல், the water, the lamps set afloat

## C. What makes it unforgettable
- [ ] C1 the rock lets go (cells, shards, dust, fresh granite), scene by scene
- [ ] C2 the first six seconds: a flame, the drawing on the rock, the carving, molten gold into the name
- [ ] C3 the torch; lamps one lights stay lit; gold wakes
- [ ] C4 the Kurals: Tamil in the stone, English under the light, palm leaves with his own words
- [ ] C5 stone under a fast hand: honeycomb, in granite
- [ ] C6 sound, all synthesised: stone, bronze, chain, pillars that sing, water, oil flame; calm
- [ ] C7 guidance: one leaf at a time; no hint at PS or at the photo, ever
- [ ] C8 the water, the two fish, the finale that gathers what the visitor lit
- [ ] C9 the slow looks (one in every scene) and three secrets

## D. Proof
- [ ] D1 day themes; theme tints
- [ ] D2 phone: every scene at 393×852 and 393×740, by finger, tilt lamp, one context
- [ ] D3 keyboard, screen reader, zoom 200 %, reduced motion, no WebGL
- [ ] D4 performance on his laptop and a phone (GPU timer, fling film, memory, bytes)
- [ ] D5 twenty-two pictures through the meter; film of the opening
- [ ] D6 he reads the couplets and place names once, as a Tamil reader
- [ ] D7 in the Themes window, live; QA desktop and phone; mirror synced

## Where it stands (26 Nov, morning)
Every hall is built and can be walked, by `?design=kal` (desktop and phone): the gate (S1) whole; the halls S2–S11 in
their first form, each with its own carving: the chain of months in stone (links of gold, verdigris, black, copper by
what happened), the copper plates, the hall of 21 pillars, the kolam of one line, the arch of pearls with the two
parrots, the water steps, the elephants pulling the chariot, the eight pierced windows lit from behind, the treasury's
five thresholds and bronze doors with light in the crack, the golden lotuses and their pond, the balance your light
weighs on, the last boulder with கல், the steps. Still to come: C1 the rock that lets go, the water of S11, the leaves
behind the couplets, the singing pillar, sound, the static twin, and the proof (D).

## Order
A1–A6 with B1 → look at it on his laptop and phone → B2, B7, B11 (the three to remember) → C1–C4 → B3, B8,
B9 → B4–B6 → B10 → C5–C9 → A7, D.

## Agents
- [x] words, guidance, place names, couplets (25 Nov) → docs/temple/WORDS.md
- [x] art direction and storyboard (25 Nov) → docs/temple/ART.md
- [ ] research: ornament geometry, sound of musical pillars, a second source for every couplet
- [ ] experience: the fourteen best things, their sound and physics
- [ ] QA: a tester of its own for this design (desktop, phone)

## Questions for him (none of them holds the building up)
1. His name in Tamil for the stone: பாண்டியன் சம்பத்?
2. Did DineAI begin from its question ("Where does your money go?"), or is that how it is told?
3. Star of the Month (Nov 2025) says 1.6 years; by the page's clock it was 1.8. Which?
