# The words of pandi-dev (25 Nov 2026)

Guidance (A), the cards (B), the award room (C), a first draft for the temple design (D), questions (E).
Checked against: copy.ts, profile.ts, skills.ts, the chain design's components, app/award/page.tsx, the
checklist (§100–107), and pictures of the live page at 1536×730 and 393×852.

## Read first (things the builder would trip over)

1. **The photo has exactly one button: a tap opens the album.** The rim button left in §101 ("the portrait
   has no button of its own"). So his "portrait hidden button" can only be that tap. No hint below points
   at the photo. Words for it are ready but EMPTY by default (`hintAlbum`), so nothing is shown until he
   says otherwise. (Already public, untouched: the shell's `album` chip and the hover word under the photo.)
2. **No words beside the coin.** He had "touch the coin" taken away (106.6: "this is making the view
   worse"). The coin is guided by what it does (A5), with an empty key (`coinHint`) if he changes his mind.
3. **Galaxy, skeleton and scatter do not answer everybody.** `touch()` and `strike()` (CrystalSpine) return
   at once with reduced motion; the scatter needs `canScatter()`. Their hints must ask the same question,
   or they promise something that never comes.
4. **No hint may live inside a card.** cardInk.ts reads a card's own page elements and paints them on the
   winding sheet (a watcher repaints on change): a hint in there is painted twice or left on the sheet.
   Hints are one fixed element over the page. The one exception is real text of the card: the line under
   the 17th rank (A2, no. 5), which is meant to wind up with it.
5. **`skill.*.label` is read by other designs and the shell** (Metro prints "{label} line"; the shell pads it).
   Longer headings need a new key, `skill.*.head`, read only by SkillClusters. `label` stays.
6. Many defaults live outside copy.ts: skill blurbs in skills.ts (`CLUSTERS`), the pitch and volunteering in
   profile.ts. Every design reads those, so each new one below was kept near its old length.

---

# A. GUIDANCE

## A0. One voice

The page has ONE hint element; two can never be in view. It speaks at most once at each stop, then is quiet.
(The chain design only. While the rank's own line, no. 5, is in the middle of the view, the voice is silent.)
Whoever walks straight through meets **six**: scroll, galaxy, months, skeleton, the rank, the chain. Four
more (A3) come only to a visitor who lingers.

- **It is:** `position: fixed`, z 38 (over cards, under the menu's 40 and every popup), `pointer-events:
  none`, `aria-hidden`; placed by a single measurement of its target when it is shown. No layout work in scroll.
- **It speaks when:** the opening is over; no popup, album, résumé or menu is open; nothing has been scrolled,
  pressed or dragged for 1 s; its target lies in the middle 80% of the view, can be touched now (card flat,
  canvas alive, rule 3 above), and is not done; 5 s since the last one left (1.5 s on the first screen).
- **It goes:** *done* (the thing happened, by whatever way): drawn back into its dot in 0.32 s, never again
  this visit. *Scrolled 24 px:* gone in 0.18 s, may be said later. *7 s unanswered:* drawn back; said once
  more at another stop; after two tellings it lets be.
- **Remembered for the visit:** sessionStorage `pandi-dev:said` = `{ id: 1 | 2 | "done" }`, in try/catch.
- **Done is told by the thing itself** (`window.dispatchEvent(new CustomEvent("dev-did", { detail: id }))`):
  CrystalSpine `touch` and `strike`; MonthChain `onBlockClick`; ResumeCard `onOpen`; an orbit drag past 6 px;
  a chip's click; the scatter's first cells; ChainRing's drag; AwardLink's `enterAward`; the first 60 px of scroll.
- **First screen, for somebody who stays:** music 1.8–5.8 s (today 4.2–12.2 s) → scroll → galaxy → months →
  hand → orbit. Any scroll ends the row; back at the top, it goes on with what has not been said.
- **An emptied hint is never shown** (the Template already allows empty words): his off switch, one by one.
- **The `·` rule:** what stands before a `·` is the invitation, on every screen; what stands after it is the
  promise, on a wide screen only (and on a phone where the place below says so).

## A1. How it looks

One line. Mono, 10 px, weight 500, tracking .2em, capitals by CSS (the words are written in sentence case);
phone 9.5 px, tracking .12em. Colour `--d-ink3` (about 10:1 on Chain, 8:1 on Daylight), its FIRST word
`--d-ink`. Shade: `.dev-navshade`'s own text-shadow, no box, no blur, no capsule. Pointer: a 1 px line of
28–40 px, from nothing at the words to `--d-a` at its tip, with a 5 px dot on the thing's edge.

- *In:* the dot lights; the line is drawn out of it (0.45 s); the words are uncovered from the line's end
  (clip-path, 0.7 s), as ink follows a pen. The dot breathes three times (2.2 s each), then rests.
- *Out, done:* the same, backwards, into the dot.
- Reduced motion: there at once, gone at once, no breathing.
- The music's line (`soundHint`, today 9.5 px lower case) takes the same look, so there is one hand on the page.

Widths used below: desktop 8 px a letter, phone 6.9 px.

## A2. The six

**1 · Scroll** (`hintScroll`, "At the foot of the first screen")
- Where: *desktop* centred on the right column (x 1082), 34 px above the bottom edge, its line standing under
  it, 26 px, down to the edge. *Phone* centred, 22 px + safe area above the bottom, over a 120 px shade
  (transparent to 80% of `--d-bg`), since the time card is under it.
- Words (both): **Scroll to see my skills and experience** (his own; 304 px / 262 px)
- Shows: 6.4 s after the opening if nothing has been scrolled. The dot slides down the line three times.
- Goes: at 60 px of scroll. Done.

**2 · Galaxy** (`hintGalaxy`, "Beside the galaxy")
- Where: *desktop* level with its heart (y 112), right-aligned, ending at x 654; line 36 px to the disc's left
  rim: the free ground over HELLO, I'M. *Phone* right of the disc, left-aligned from x 270, two lines
  ("Touch" / "the galaxy"), line 20 px.
- Words: **Touch the galaxy · and let it burst** (phone: Touch the galaxy)
- Shows: on the first screen after the scroll line; on a phone also whenever its heart rests between 25% and
  75% of the screen; on a desktop again when somebody comes back to the top. Not with reduced motion.
- Goes: at the burst. Done.

**3 · Months** (`hintMonths`, "Under the month blocks")
- Where: in the gap under the time card. *Desktop* left-aligned with the blocks, 18 px under the card. *Phone*
  right half of the gap (x 248–373: the skeleton stands in its middle). No line: a 1 px gold ring breathes
  round the newest LIT block, drawn on the hint's own layer.
- Words: **Touch a lit month · and see what happened** (phone: Touch a lit month)
- Shows: the time card at rest, 1 s of stillness. It speaks of opening only. Never of double clicking.
- Goes: when any month is opened. Done.

**4 · Skeleton** (`hintBones`, "Beside the skeleton")
- Where: *desktop* the free corner under the orbit, right-aligned, ending at x 676, y 692; line 34 px to the
  bones' left edge. *Phone* the right half of a gap between two skills cards (16–24 px, bones bare there).
- Words: **Touch the skeleton · it breaks, and comes back to life** (phone: Touch the skeleton, 124 px)
- Shows: the first stop after the résumé card, while the skills are being read. Not with reduced motion.
- Goes: when a bone is struck. Done.

**5 · The rank, the way to the chest** (`eduDoor`, "Under the gold line: what stands behind it")
- Where: real text of the Education card, the line right under the gold one (12 px, `--d-ink3`, indented under
  the medal; a 1 px gold hairline comes down from the medal and bends into it). It is the one hint that stays,
  because it is also the sentence the card was missing. Two lines on a desktop, three on a phone.
- Words (both): **Touch the rank. In an ancient temple stands a treasure chest no one can steal, even if they
  try. It is called education.**
- Shows: always. The first time the card rests in view, the hairline is drawn and a dot breathes three times
  under the rank.
- Goes: it does not go, it changes. Back from the room it says (`eduDoorAfter`, "…once they have been inside"):
  **The chest is still there. Nobody has managed to steal it.**
- The link's tooltip: "Open the award" → **Into the temple**.

**6 · The finale's chain** (`hintRing`, "Over the finale's chain")
- Where: between the small label and the ring, centred; a 22 px line down to the ring's top.
- Words: **Turn the chain with your hand · it keeps moving** (phone: first part)
- Shows: 2.5 s after the ring has closed and the slogan has arrived.
- Goes: at the first drag. Done.

## A3. Four more, only for a visitor who lingers (9 s still, nothing left to say from A2 in view)

| id and key | Where | Words (phone: up to the ·) | Goes | Template label |
|---|---|---|---|---|
| hand `hintHand` | desktop: centred under the orbit (x 437, y 692); phone: the 32 px between the place line and the orbit | Sweep your hand sideways · the page scatters, and comes home | first cells let go | About the hand that scatters the page |
| orbit `hintOrbit` | both: centred in the free band over the orbit (desktop y 378) | Turn my skills with your hand · touch one to read about it | first drag, or a chip opened | Over the skills that go round |
| chips `hintChips` | gap under the AWS card, right half; 14 px line up into its last chips | Touch any name · its official pages open | first chip opened | Under the first skills card |
| résumé `hintResume` | gap under the résumé card, left, under the cover; 14 px line up to it | Touch the pages · they open right here | résumé opened | Under the résumé card |

"Hand" and "sideways" are true on both: on a phone a finger that sets off sideways scatters, one that sets off
up or down scrolls (106.11). Only where `canScatter()`.

**Music** (`soundHint`, exists): keep **touch anywhere for music**; 1.8–5.8 s; under the sound control; goes at the
first touch, click or key; not when he has chosen "only by the music button".

## A4. No hint, and why

- **Recognition:** nothing there answers a touch. A hint that leads nowhere teaches people to ignore the others.
  If its entries are made to open their month's window (worth it: same list, same window), use `hintRec`
  = "Touch one · its month opens". Until then it stays empty.
- **DineAI:** the button is the invitation, so it is written as one (B: *See it at work*).
- **Volunteering:** nothing to touch; its aside, HOW I RECHARGE, is the right word.
- **Shell:** its aside already says TYPE OR TAP, for good. Make the starred words in `shellLine` real buttons
  that run themselves: today they look like something to touch and are not.
- **Photo and PS:** never.

## A5. The award room

**One voice again,** at the foot, where STRIKE THE CHEST stands (bottom 96 / 112 px). Cinzel 600, 12 px (today
11 px and hardly seen), tracking .26em (phone 10.5 px, .18em, two lines at most), `#f0d5a8`, shadow `0 0 10px #000`.
Words are uncovered from the middle outwards (0.8 s). Every blow takes the voice at once, whatever it was saying.

| # | Words | When | Goes | Key · Template label |
|---|---|---|---|---|
| R1 light | **You carry the light. Move it.** | 3.2 s after the doors (the light has made its own pass), if the pointer is still | moved 240 px, or 6 s | `awardLight` · At the foot, when the doors have opened |
| R2 lamps | **Bring it to the lamps** | after R1, none lit yet | one catches, or 7 s | `awardLamps` · …once the light has moved |
| R2b | **Three more**, **Two more**, **One more** | 3 s after each catches by the visitor's own light | by itself | `awardLampsLeft` · …as the lamps catch, commas between |
| R2c | **The stone is awake** | all four lit by hand, chest still shut | 4 s | `awardAwake` · …when all four are lit |
| R3 strike | **Strike the chest** · **Again** · **It is giving way…** | as today; after R2 or at once on a blow | as today | `awardStrike` `awardAgain` `awardBreaking` (exist) |

Once it is open the foot belongs to the citation and the voice is silent.

**The coin: no words** (106.6). After 6 s untouched it is nudged, as by a finger: one push, a turn and a half, slowing
down. That shows it can be turned, on a phone too. The hand cursor stays. Screen reader and tooltip (`coinSays`,
"What is said of the coin without showing it"): **Turn it with your hand. A touch opens Instagram.** `coinHint`
("Beside the coin (empty: nothing)") is empty.

**The Kural panels: touched because one wants to know.**
- *What draws the hand (no words):* until the leaves have been opened once, a light passes BEHIND the letters, left
  panel then right, 2.4 s, every 11 s of stillness, as if somebody walked behind the wall with a lamp: the letters'
  rims and floors glow from within (the wall shader already has the rim, `vRim`; one uniform). One sees that there
  is something behind the words. That is the invitation; the line only says it aloud.
- *The line,* in two halves, as the couplet itself is in two halves:
  `kuralHintOne` **A story is kept behind these words** · `kuralHintTwo` **Touch them, and it opens**
  - *Shut:* when the visitor's light has rested on a panel until it has turned to English (about 1.2 s), the voice
    at the foot says both, and stays while the light stays, and 2 s more. Then it goes back to what it was saying.
  - *Open, desktop:* the first half under the left panel, the second under the right, so the eye crosses the room:
    Cinzel 10 px, tracking .2em, `#e6bd7c`, on the dark plinth below the elephants (about 100 px under the frame),
    a 1 px gold line climbing from it to the frame. They appear 5 s after the chest opens, when the coin has come.
    Both can be touched. (Needs the panels' boxes on the screen: tell them as the coin's box is told.)
  - *Open, phone:* the coin hangs in front of the band, so both halves stand under the English verse at the top, in
    two lines, inside the same button; a hairline is drawn under the verse.
  - *After the leaves have been opened:* `kuralHintAfter` **The leaves are still here** (left panel, or under the
    verse), no light behind the letters, no line.
- Labels: "By the Kural, while its leaves are shut: the first half" / "…the second half" / "…once they have been opened".

**The leaves.**
- `kuralDown` **The last leaf is mine** ("The leaves: at the foot of a small screen, until they are read down"): only
  where the book is taller than the screen; 1.4 s after the last leaf has opened; gone at 40 px of scroll. It makes
  a stranger go down to his own proof, which is below the fold on a phone.
- `kuralShut` **Touch the dark to close the leaves** ("The leaves: how they close"): under the last leaf, 10 px, first
  opening only.

## A6. The new fields, ready for copy.ts

```ts
{
  title: "The quiet lines (what can be touched)",
  note: "One at a time, when a visitor is still; gone once the thing has been done. Empty: never shown. What stands after a · is for a wide screen.",
  fields: [
    { key: "hintScroll", label: "At the foot of the first screen", def: "Scroll to see my skills and experience" },
    { key: "hintGalaxy", label: "Beside the galaxy", def: "Touch the galaxy · and let it burst" },
    { key: "hintMonths", label: "Under the month blocks", def: "Touch a lit month · and see what happened" },
    { key: "hintBones", label: "Beside the skeleton", def: "Touch the skeleton · it breaks, and comes back to life" },
    { key: "hintRing", label: "Over the finale's chain", def: "Turn the chain with your hand · it keeps moving" },
    { key: "hintHand", label: "About the hand that scatters the page", def: "Sweep your hand sideways · the page scatters, and comes home" },
    { key: "hintOrbit", label: "Over the skills that go round", def: "Turn my skills with your hand · touch one to read about it" },
    { key: "hintChips", label: "Under the first skills card", def: "Touch any name · its official pages open" },
    { key: "hintResume", label: "Under the résumé card", def: "Touch the pages · they open right here" },
    { key: "hintRec", label: "Under the recognition card (empty: none)", def: "" },
    { key: "hintAlbum", label: "Beside the photo (empty: never shown)", def: "" },
  ],
},
// the education card
{ key: "eduDoor", label: "Under the gold line: what stands behind it", def: "Touch the rank. In an ancient temple stands a treasure chest no one can steal, even if they try. It is called education.", long: true },
{ key: "eduDoorAfter", label: "…once they have been inside", def: "The chest is still there. Nobody has managed to steal it.", long: true },
// the award room
{ key: "awardLight", label: "At the foot, when the doors have opened", def: "You carry the light. Move it." },
{ key: "awardLamps", label: "…once the light has moved", def: "Bring it to the lamps" },
{ key: "awardLampsLeft", label: "…as the lamps catch, commas between", def: "Three more, Two more, One more", list: true },
{ key: "awardAwake", label: "…when all four are lit", def: "The stone is awake" },
{ key: "kuralHintOne", label: "By the Kural, while its leaves are shut: the first half", def: "A story is kept behind these words" },
{ key: "kuralHintTwo", label: "…the second half", def: "Touch them, and it opens" },
{ key: "kuralHintAfter", label: "…once they have been opened", def: "The leaves are still here" },
{ key: "kuralDown", label: "The leaves: at the foot of a small screen, until they are read down", def: "The last leaf is mine" },
{ key: "kuralShut", label: "The leaves: how they close", def: "Touch the dark to close the leaves" },
{ key: "coinHint", label: "Beside the coin (empty: nothing)", def: "" },
{ key: "coinSays", label: "What is said of the coin without showing it", def: "Turn it with your hand. A touch opens Instagram." },
```

(If he says yes to the photo: `hintAlbum` = "Touch the photo · there are more behind it", under the orbit.)

---

# B. EVERY CARD

Room: a heading line takes 26 letters on his phone (9.25 px each), 44 on a desktop; text at 12–12.5 px takes about
54 letters a line on a phone, 83 on a desktop. "Keep" means: already right, leave it.

**The idea that ties the six skills cards together.** The page has a crystal skeleton with nerves and a heartbeat.
So the cards are one body of work: bones, mind, voice, nerves, pulse, face. The first word of each heading stays
the one a recruiter looks for.

### Who you are
| key | now | new | why |
|---|---|---|---|
| `name` `hello` `role` `at` `company` `place` `barLine` `careerStart` | as they are | keep | facts, and the greeting is warm |

### The time card
| key | now | new | why (room) |
|---|---|---|---|
| `timeTitle` | TIME IN THE CHAIN | AT WORK, LINK BY LINK | a stranger learns WHAT is being counted; "link by link" is answered by the finale (30 letters) |
| `timeUnit` | years | years so far | humble, and it moves |
| `timeYears` `timeMonths` `timeDays` `timeCounting` | YEARS, MONTHS, DAYS, AND COUNTING | keep | plain |
| `chainBlocks` | BLOCKS | MONTHS | "35 MONTHS": what a block is, said at last |
| `chainYears` | YEARS IN | YEARS COMPLETE IN | "3 YEARS IN 37D" reads as three years done already; it is a countdown. Whole line 44 letters, one line on a phone (295 of 313 px) |
| `kindRecognition` `kindPromotion` `kindMilestone` `kindNote` | Recognition, Promotion, Milestone, Note | keep | a legend should be dull |

The month's window has fixed words, two of them miners' slang. New keys, same card, "The month's window":
| key | now (fixed) | new | why |
|---|---|---|---|
| `monthHead` | BLOCK #{n} | MONTH {n} OF THE CHAIN | anyone understands it |
| `monthNow` | BEING MINED · DAY {d} OF {all} | BEING MADE · DAY {d} OF {all} | no crypto words |
| `monthNext` | NOT MINED YET · {n} DAYS AWAY | NOT MADE YET · {n} DAYS AWAY | same |
| `monthPast` | {all} DAYS · CHAIN DAYS {from}–{to} | {all} DAYS · DAYS {from} TO {to} OF MINE | speaks like the finale's DAY {n} OF MINE |
| `monthQuiet` | A steady month in the chain. Nothing recorded. | Nothing is written on this link. The next one holds on to it all the same. | the quiet months carry the others: his slogan, in a small place |
| `monthFuture` | This month hasn’t happened yet. | Not here yet. I am on my way to it. | warm, and it moves |

### The résumé card
| key | now | new | why (room) |
|---|---|---|---|
| `resumeTitle` `resumePage` `resumePages` `resumeName` `resumeUpdated` `resumePdf` `resumeWord` | as they are | keep | the words people look for |
| `resumeLine` | System Engineer · Python, AWS and Generative AI | The same story, set for paper: Python, AWS and Generative AI. | the role is said three times on the page already; this says what a résumé is for (2 phone lines) |
| `resumeView` | View résumé | Read it here | it opens in place; an invitation, not a label |

### The six skills cards
New key `skill.*.head` ("Its heading on the card"); `skill.*.label` becomes "Its short name (the shell, the other designs)". At 360 px wide, headings' tracking .24em → .2em.

| key | now | new | why (room) |
|---|---|---|---|
| `skill.aws.head` | AWS | AWS · the bones | what holds the rest up (26) |
| `skill.aws.blurb` | Compute, containers, messaging and storage — plus the network, the identity and the eyes on it all. | These six cards are one body of work. This one is its bones: a place to run, a network to live in, keys only it may hold, and eyes that stay open at night. | opens the idea; says what he does with them (2 desktop lines, 3 phone) |
| `skill.python.head` | PYTHON & BACKEND | Python · the mind | where it thinks |
| `skill.python.blurb` | The languages, the frameworks he builds services in, and the architecture underneath. | Where it thinks. I write the rule in Python first, then the service around it, then a clear door for others to knock on. Small parts, each easy to understand. | first person; door = API, small parts = services |
| `skill.ai.head` | GENERATIVE AI | Generative AI · the voice | what speaks (25) |
| `skill.ai.blurb` | Models, agents and the guardrails around them, built on Amazon Bedrock and Claude. | Where it speaks. I build agents on Amazon Bedrock and Claude, and the fence with them: what they may read, what they may spend, and when they must ask a person. | guardrails, cost control and human-in-the-loop, as things he decides |
| `skill.integration.head` | MESSAGING & DATA | Messaging · the nerves | how one part feels another; the skeleton has them too |
| `skill.integration.blurb` | The pipes between systems — queues, streams, sockets, a mainframe — and where the data rests. | How one part feels what another did. I carry the word between old systems and new ones, by queue, stream, socket or mainframe, and give the data a place to rest. | what the pipes are FOR |
| `skill.tools.head` | DEVOPS & TESTING | DevOps · the pulse | the steady beat |
| `skill.tools.blurb` | How the code ships, what keeps it honest on the way, and how it is tested. | The steady beat. Each thing is built the same way every time, read by tools that do not flatter, tested, and only then let go. Hope is not a test. | one idea a tester will remember |
| `skill.frontend.head` | FRONTEND & AI TOOLS | Frontend · the face | what is seen |
| `skill.frontend.blurb` | The web side, built AI-assisted — and the AI tools he builds with every day. | What you see and touch. I build it AI-assisted, with these tools every day, and I say so. The decisions stay mine. | the honesty kept, in his own voice |
| `skill.*.items` `skill.*.label` | as they are | keep | the record; searched for by name |

### The education card
| key | now | new | why (room) |
|---|---|---|---|
| `eduTitle` | EDUCATION | EDUCATION · WHAT STAYS | the Kural's idea in two words (30) |
| `eduHonour` | 17th University Rank · Gold Medalist | keep | the headline. ("Medallist" is the British spelling, but the coin is struck MEDALIST: one spelling everywhere) |
| `eduDoor` `eduDoorAfter` | (none) | A2, no. 5 | his own words: the chest no one can steal |
| `eduDegree` `eduYear` `eduPercent` `eduSchool` `eduSchoolLink` `eduAffiliation` `eduVerifyLabel` `eduVerifyLink` `eduOfficial` `eduOfficialLink` `eduExam` `eduHint` | as they are | keep | facts, exact |
| `eduVerify` | verify | proof | says what it is, not what to do; one letter shorter, so the pill still fits a phone |

### The recognition card
| key | now | new | why (room) |
|---|---|---|---|
| `recTitle` | Recognition | Recognition · on the way | not an arrival; no boast (24, beside its count) |
| `recPill` | (empty: counted) | keep empty | "PROMOTED TWICE IN TWO YEARS" is counted from his own entries |
| `recPromoted` | PROMOTED | keep | |

Its entries are his (the month blocks), already plain facts: keep. One question: E3.

### What you build
| key | now | new | why (room) |
|---|---|---|---|
| `sideTitle` | Built outside work | keep | clear, and it must not be taken for his employer's |
| `sideLive` `sideName` `sideSiteLabel` `sideSite` `sideSlogan` `sideInUse` `sideInUseLink` `sideStack` `sideHonesty` `sideCode` `sideCodeLink` `sideSince` | as they are | keep | the question is the best line on the page; the honesty is his rule |
| `sidePitch` | A live web app for UK restaurants: purchases, stock, supplier prices and recipe costs, joined up into a live profit and loss, with an AI assistant built in. | DineAI answers it for UK restaurants: purchases, stock, supplier prices and recipe costs joined into one live profit and loss, with an AI assistant built in. | the question stands right above it, in every design: now it is answered (2 desktop lines, 3 phone) |
| `sideInUseWord` | In use at | Answering today at | goes on from the answer; same fact |
| `sideVisit` | Visit dineai.cloud | See it at work | an invitation; the address is already beside the name |

### Volunteering
| key | now | new | why |
|---|---|---|---|
| `volTitle` `volAside` | Volunteering · HOW I RECHARGE | keep | the aside says why he does it |
| `vol1Org` `vol2Org` `vol3Org`, and `vol4Org` to `vol6What` | as they are (4 to 6 empty) | keep | |
| `vol1What` | Birthdays with children at an orphanage, donor-funded meals every day, and evenings feeding stray dogs at Marina Beach. | Birthdays kept with children at an orphanage. Donor-funded meals, every day. Evenings at Marina Beach, feeding stray dogs. | three pictures instead of a list |
| `vol2What` | Volunteered at the kids’ carnival games: chess, archery, dance and more. | At the kids’ carnival games: chess, archery, dance and more. | the heading has said it |
| `vol3What` | Every Diwali at an orphanage, bursting crackers and enjoying the day with the children. | Every Diwali at an orphanage: the crackers and the day, shared with the children. | warmer, same fact |

### The shell
| key | now | new | why |
|---|---|---|---|
| `shellTitle` | Shell | Ask the chain | anyone knows what to do (with its aside, 247 of 321 px) |
| `shellAside` | TYPE OR TAP | keep | |
| `shellLine` | Ask the chain anything it knows — try *awards* or *resume*. | It knows this page by heart. Write one word and it answers: *awards*, *skills* or *contact*. | says what it is; the starred words should be buttons |

(Fixed in the shell: the bar's TALK TO THE CHAIN now repeats the heading: change to IT LISTENS.)

### Top menu, door, finale
| key | now | new | why |
|---|---|---|---|
| `navMail` `navLinkedin` `navGithub` `navInstagram` `navResume` `navThemes` `soundHint` `email` `linkLinkedin` `linkGithub` `linkInstagram` | as they are | keep | a menu should be found, not read |
| `bootLines` `bootVerified` `bootOpen` | as they are | keep | the door is a developer's joke, told quietly |
| `bootWait` | PLEASE WAIT… | ONE MOMENT… | a person says it, not a machine |
| `finaleLabel` `slogan1` `slogan2` `statement` `finaleNote` `finaleDay` `finaleCounting` `finaleHello` `finaleLinkedin` `finaleProject` `footName` `footPlace` `footMade` | as they are | keep | his own lines; "Say hello" is right; the last line is the honest one |
| `finaleResume` | View résumé | Read my résumé | the same voice as the card |

Album (fixed words, if he wants them in the Template): "DECRYPTED" → OPENED; "{n} blocks" → "{n} photographs".

---

# C. THE AWARD ROOM

He loves these ("I'm melted with your words"), so almost all stay.

| key | now | new | why |
|---|---|---|---|
| `coinLink` `awardTop` `awardTitle` `awardStrike` `awardAgain` `awardProof` `awardProofLink` | as they are | keep | exact |
| `awardBreaking` | IT IS BREAKING… | IT IS GIVING WAY… | a chest of learning gives way; it is not destroyed |
| `awardCitation` | Presented to *Pandian Sambath* in recognition of placing *17th in the university* — B.Tech Information Technology, 92% — and for work done with care, patience and a refusal to leave things half finished. | Presented to *Pandian Sambath*, placed *17th in the university*: B.Tech Information Technology, 92%. Four years of learning, one gram of gold. The gold stays in this chest. The learning walked out with him. | the second half praised itself, and no university said it. Now only facts, and the Kural's meaning in his own life. As long as before (5 phone lines) |
| `awardVerse` `awardVerseBy` | as they are | keep | the same words the stone says |
| `kuralHead` `kuralOne` `kuralTwo` `kuralSaid` `kuralMeans` `kuralOwn` `kuralMine` | as they are | keep | checked: the couplet is right, letter for letter (Project Madurai's text) |
| `kuralWords` | …மாடு அல்ல = are not wealth; … | கேடு இல் = never ruined; விழுச்செல்வம் = the highest wealth; கல்வி = learning; ஒருவற்கு = for a person; மாடு அல்ல = are not wealth (the old word for wealth is the word for cattle); மற்றை யவை = the other things | a small true thing for whoever reads that closely |

New: A5's keys. Fixed on the doors, fine as they are: THE ROOM IS ON ITS WAY… / Show the medal instead.

---

# D. THE TEMPLE DESIGN: FIRST DRAFT OF ITS WORDS

## D1. Its name in the Themes window (theme.ts `DESIGNS`)
Name **Mandapam** (மண்டபம், the pillared hall: the architecture, not the worship; "kovil" is the place of prayer).
Slogan **Cut in stone. Read by your own light.**
Blurb **An old Tamil stone hall at night. You carry the light; the walls tell you the rest.**
While it loads: **The doors are heavy. One moment.**

## D2. The places, in the order one walks them
| Tamil | said | English | What is there | Its line | Couplet |
|---|---|---|---|---|---|
| வாயில் | vaayil | The gate | greeting, name, role, company, place, clock | Come in. The hall is dark, and the light is in your hand. | 972, on the lintel |
| விதானம் | vidhaanam | The ceiling | the skills that go round: a stone lotus overhead, a skill on each petal | Look up. Every petal is something I work with. | none: a hall needs quiet walls too |
| சித்திரக்கூடம் | sithirak koodam | The painted wall | the photos, changing like fresco | The picture changes now and then. The man in it is still learning. | 786 |
| நந்தா விளக்கு | nandaa vilakku | The lamp that is never put out | time since it began, the running clock | Lit on my first day at work. I have kept oil in it since. | 611 |
| படித்துறை | padithurai | The steps to the water | the months, a step each, down to the tank | One step for every month. Where something happened, a lamp was left. | 595 |
| செப்பேடு | seppedu | The copper plates | the résumé: plates strung on one ring, as old grants were | What I have done, written down to be checked. | 664 |
| இசைத்தூண்கள் | isai thoongal | The pillars that sing | the six skills (D3); each rings its own note when touched | Six pillars, each with a note of its own. Touch one, and it answers. | one each (D3) |
| கல்வெட்டு | kalvettu | The inscription | recognition | Old walls keep a list of what was given, and when. This is mine. | 505 |
| சிற்பக்கூடம் | sirpak koodam | The workshop | DineAI | Where I cut a stone of my own. | 478 |
| நந்தவனம் | nandavanam | The garden | volunteering | Where I put the tools down, and fill up again. | 322 |
| ஓலைச்சுவடி | olai chuvadi | The leaves that answer | the shell: a stylus, a leaf, an answer on the next leaf | Write one word. The next leaf answers. | 645 |
| கருவூலம் | karuvoolam | The treasury | education; the 17th rank is its door (/award) | Every other room can be robbed. Not this one. | 400 |
| கற்சங்கிலி | kar sangili | The chain of one stone | the finale | One stone, no joint, and every link moves. | 396 |
| மணி | mani | The bell | say hello, LinkedIn, résumé, DineAI | Ring it, and a letter to me opens. | 783 |

Why these: singing pillars and chains cut from one stone are real marvels of Tamil halls, and the second is his
slogan, cut a thousand times before he wrote it. Copper plates really were strung on a ring. Nothing here is an altar.

## D3. The six pillars: parts of a building instead of a body
| Skill | Part | Its line | Couplet |
|---|---|---|---|
| AWS | அதிட்டானம் · the plinth | Everything stands on it. Nobody looks at it until it moves. | 484 |
| Python & backend | தூண் · the pillar | It carries the weight, and keeps its shape. | 392 |
| Generative AI | விளக்கு · the lamp | Bright, and never left alone. | 423 |
| Messaging & data | வாய்க்கால் · the channel | What is poured in here must arrive there. | 687 |
| DevOps & testing | தூக்குநூல் · the plumb line | The eye is easily pleased. The line is not. | 948 |
| Frontend & AI tools | வண்ணம் · the paint | What you see first. I mix it AI-assisted, and say so. | 471 |

## D4. The couplets (Tamil in the stone, English under the visitor's light; a touch opens the leaves)
Every line compared with Project Madurai's text. Its slip in 392 ("இவ்விரண் டும்") is written right here. English:
ours. None names a god. **He must read all of them before one is carved.**

| Kural | Tamil | What the stone says in English | Why here |
|---|---|---|---|
| 972 | பிறப்பொக்கும் எல்லா உயிர்க்கும் சிறப்பொவ்வா / செய்தொழில் வேற்றுமை யான் | All are born alike. What sets them apart is the work they do. | the right thing to read at the gate of a profile |
| 786 | முகநக நட்பது நட்பன்று நெஞ்சத்து / அகநக நட்பது நட்பு | A smile on the face is not friendship. Friendship is the heart smiling within. | beside his face |
| 611 | அருமை உடைத்தென்று அசாவாமை வேண்டும் / பெருமை முயற்சி தரும் | Never lose heart and call it too hard. Effort brings greatness. | the years |
| 595 | வெள்ளத் தனைய மலர்நீட்டம் மாந்தர்தம் / உள்ளத் தனையது உயர்வு | The lotus stands as tall as its water; a person, as tall as their heart. | steps, water, lotus, promotions |
| 664 | சொல்லுதல் யார்க்கும் எளிய அரியவாம் / சொல்லிய வண்ணம் செயல் | To say it is easy for anyone. To do it as it was said is hard. | a résumé that knows it |
| 484 | ஞாலம் கருதினுங் கைகூடுங் காலம் / கருதி இடத்தாற் செயின் | At the right time, in the right place, even the world comes within reach. | AWS |
| 392 | எண்ணென்ப ஏனை எழுத்தென்ப இவ்விரண்டும் / கண்ணென்ப வாழும் உயிர்க்கு | Numbers and letters: these two are the eyes of the living. | Python |
| 423 | எப்பொருள் யார்யார்வாய்க் கேட்பினும் அப்பொருள் / மெய்ப்பொருள் காண்ப தறிவு | Whoever says it, to find what is true in it: that is wisdom. | Generative AI, and a person who checks it |
| 687 | கடனறிந்து காலங் கருதி இடனறிந்து / எண்ணி உரைப்பான் தலை | The best messenger knows the duty, the time and the place, and thinks before speaking. | Messaging |
| 948 | நோய்நாடி நோய்முதல் நாடி அதுதணிக்கும் / வாய்நாடி வாய்ப்பச் செயல் | Find what is wrong, find its root, find its cure; then cure it well. | every engineer who has hunted a fault |
| 471 | வினைவலியும் தன்வலியும் மாற்றான் வலியும் / துணைவலியும் தூக்கிச் செயல் | Weigh the task, your own strength, what is against you, and your helpers; then begin. | AI as a helper, weighed |
| 505 | பெருமைக்கும் ஏனைச் சிறுமைக்கும் தத்தம் / கருமமே கட்டளைக் கல் | For the great and the small alike, their own work is the touchstone. | recognition; gold is tested on that stone |
| 478 | ஆகாறு அளவிட்டி தாயினுங் கேடில்லை / போகாறு அகலாக் கடை | Little may come in, and no harm done, if no more goes out. | "Where does your money go?" |
| 322 | பகுத்துண்டு பல்லுயிர் ஓம்புதல் நூலோர் / தொகுத்தவற்றுள் எல்லாந் தலை | Share your food and care for every life: of all that books have gathered, this is first. | the meals, and the stray dogs |
| 645 | சொல்லுக சொல்லைப் பிறிதோர்சொல் அச்சொல்லை / வெல்லுஞ்சொல் இன்மை அறிந்து | Say a word when you know no other word can better it. | one word to the shell |
| 400 | கேடில் விழுச்செல்வம் கல்வி யொருவற்கு / மாடல்ல மற்றை யவை | Learning is the wealth that never perishes; nothing else is wealth. | the treasury |
| 396 | தொட்டனைத் தூறும் மணற்கேணி மாந்தர்க்குக் / கற்றனைத் தூறும் அறிவு | Dig deeper in sand and more water comes; learn more and more is known. | his own "Just keep learning" |
| 783 | நவில்தொறும் நூல்நயம் போலும் பயில்தொறும் / பண்புடை யாளர் தொடர்பு | A good book gives more each time it is read; so do good people, each time one meets them. | saying hello |
| 411 | செல்வத்துட் செல்வஞ் செவிச்செல்வம் அச்செல்வம் / செல்வத்து ளெல்லாந் தலை | Of all wealth, the wealth that comes in by the ear is the first. | in the music's menu, smallest letters |

Each opens leaves as 400 does: the couplet, its words, its meaning, and one leaf in his own words tied to what
stands there. Only 400 has that last leaf today. Draft for two more, facts already on the site:
478: "*DineAI began from this question.* Purchases, stock, supplier prices and recipe costs, joined into one
profit and loss, so that what goes out can be seen." 322: "*I try to.* Birthdays at an orphanage, meals every day,
and evenings at Marina Beach with the stray dogs." (He should say whether the first is how it began: E5.)

## D5. Its guidance (one voice, as in A0; whoever walks straight through meets the six in bold)
| Place | Words |
|---|---|
| gate | **You carry the light. Move it.** |
| gate, after | **Scroll, and walk in** |
| ceiling | Turn the lotus with your hand |
| steps | **Touch a step that has a lamp** |
| plates | Touch the plates · they lift |
| pillars | **Touch a pillar, and listen** |
| inscription | Bring the light close, and read |
| any couplet, once told in English | There is more behind these words · touch them |
| frieze | One of the elephants has noticed you |
| garden | Something lives in this tree |
| treasury | **Touch the rank, and the doors open** · and after: The chest is still there. Nobody has managed to steal it. |
| chain | **Set it swinging** |
| bell | Ring it, and a letter to me opens |

Look: Cinzel 600, 11 px, tracking .24em, lamp-gold, uncovered from the middle outwards; the pointer is a hairline of
light with a grain at its end. Nothing on the painted wall. Nothing at PS.

## D6. Its finale
- Label: **கற்சங்கிலி · THE CHAIN KEEPS MOVING**
- Slogan (unchanged): **Life doesn’t stop. / It moves like a chain.**
- Statement (unchanged, his own), with Kural 396 in the stone under it.
- Note: **In the old halls a mason cut a chain out of one stone, link within link, until it hung and moved. I am still cutting mine.**
- Count: **DAY {n} OF MINE · AND COUNTING** (and the number again in Tamil numerals, ௦–௯, in the smallest letters)
- Buttons: **Say hello** (the bell) · LinkedIn · Read my résumé · DineAI
- Last line: © {year} PANDIAN SAMBATH · CHENNAI, INDIA / **THIS HALL WAS BUILT WITH AI-ASSISTED DEVELOPMENT**

## D7. Small words
- Greeting: **வணக்கம். I am** Pandian Sambath. (His name in Tamil under it: E4.)
- Clock: "5:32 PM IST", and in the smallest letters the old count: **நாழிகை {n}** (24 minutes each, sixty to a day, from six in the morning).
- The count of years: **2.9 years so far**, and ௨.௯ beneath, tiny.
- Month's window: the same words as in B. A step with no lamp: **No lamp was left on this step. The next one still rests on it.**
- Menu: the same six English words; a stranger must find them.
- Keys: `temple.<place>.ta`, `.en`, `.line`, `.one`, `.two`, `.told`, `.own`, and `temple.hint.<place>`; one Template group for each place.

---

# E. QUESTIONS FOR HIM
1. Is the tap on the photo (the album) the "hidden button"? If not, `hintAlbum` can be filled.
2. The coin: nothing written beside it, as in 106.6. Still right?
3. Star of the Month (Nov 2025) says "with 1.6 years of experience"; by this page's own clock it was 1.8. Which?
4. His name in Tamil for the gate: பாண்டியன் சம்பத்?
5. Did DineAI begin from its question, or is that only how it is told? (D4)
6. He reads the nineteen couplets and the fourteen place names once, as a Tamil reader.
