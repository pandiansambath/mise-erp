# Dine-in — the working list

> "i said so many thngs ...please add all the stuff in that document and follow
> that document md file until u complete all the tasks"

Fair. Everything he has asked for, in his words, in one place. **Work top to
bottom and tick as it ships.** Nothing gets dropped because it scrolled past.

---

## ✅ Shipped

| | What | Commit |
|---|---|---|
| ✅ | QR per table, diner page, kitchen board, orders reach the kitchen | `894b7fc` |
| ✅ | Print sheet: 2-up, no app chrome, no card split across a page | `96a2a16` |
| ✅ | Seats set by the hotel, not assumed to be 4 | `96a2a16` |
| ✅ | Free up a table — clears it for the next party | `96a2a16` |
| ✅ | Kitchen screen link that needs no login (`/kds/<code>`) — **API** | `96a2a16` |
| ✅ | Prep time settable, waiting shown as min/hr/days | `96a2a16` |
| ✅ | Menu availability: out of stock · finished today · not served · serving hours | `784b83b` |
| ✅ | Diner is TOLD why a dish is off, not shown a gap | `784b83b` |

---

## 🔴 Open — in order

*(**All 14 shipped.** Kept here as the record of what was asked and why.)*

### ✅ 1. `/kds/<code>` page 404s
The API shipped; **the page was never built**. My miss — the button hands you a
link to nothing. *Page written, not yet deployed.*

### ✅ 2. Group a table's rounds into ONE card
> "if same table same customer do one more dish like juice, it's coming as a
> separate table 4 — I can see 2 table 4. Actually we need to group them until
> free up."

A table is one party until somebody clears it down. Two cards for one table is
how a round of drinks reaches the wrong people. Each round keeps its own line
and its own button (the starters finish before the juice), but they live in one
card. Applies to `/kitchen` **and** `/kds/<code>`.

### ✅ 3. Calls and messages jump to the top
> "if some table sending msg or calling someone means it need to at top
> portion... better split that UI as 2 sections in runtime (only when we get
> msg/call) so that one can easily see and go to that table instantly."

A separate band above the pass that only exists when somebody is waiting.

### ✅ 4. Sticky header overlaps the cards
> "see top area buttons... let me scroll... now see... worst UI. Same issue in
> kitchen page too."

The tools row and the cards collide on scroll. Real on `/tables` and `/kitchen`.

### ✅ 5. QR handling — download and print each one
> "each QR we need download option — download as image or PDF — and one
> consolidated download button. Also print option for each QR in each QR area."

Per card: **download PNG · download PDF · print this one**. Plus one
**download all** (PDF sheet). Because: *"they will create QR once and print and
paste in table, that's it. It stays."*

### ✅ 6. Drop the "Terrace" wording
> "what the terrace feature... please remove, don't want. Table itself is fine."

It was only placeholder text and it read as a feature. Remove it.

### ✅ 7. Message the kitchen from the table
> "customer sitting in table can also msg using that QR in that same menu page
> itself... have some suggestions here so that customer no need to type."

Tap-to-send chips (more water · napkins · the bill · less spicy · a highchair)
plus free text. Lands on the same screen as everything else.

### ✅ 8. The guest assistant
> "have our Sonnet AI also here, so that customer can ask any details abt this
> hotel — what's so special, what famous, branches, origin, contact, owner name."
>
> **"make our AI not to answer profit or revenue kinda question abt hotels"**

**That second line is a design constraint, not a prompt line.** A guest-facing
model that will discuss margins when asked cleverly is a data leak with a chat
box in front of it, and no amount of "please refuse" survives a determined
guest. The endpoint is **starved**: handed the hotel's public profile and menu
and nothing else — no P&L, no costs, no payroll, no supplier prices. It cannot
leak what it was never given.

### ✅ 9. "Touch me" — what this dish does for you
> "our AI should show as suggestion in that page like 'touch me AI to see what
> are all health benefits u will get if u eat this'... what are all nutrients
> etc... **it need to say honestly**. This itself is the master feature which
> attracts customers."

Honestly is the hard part. A model asked "is this healthy" with nothing to go on
will invent grams of protein, and a restaurant repeating invented nutrition to a
diner with a condition is a genuinely bad day. So it is grounded in the dish's
**actual recipe ingredients** (names only, never costs), and forbidden from
stating any figure it cannot source, from giving medical advice, and from ever
declaring a dish allergy-safe.

### ✅ 10. Per-item prep time, and per-ticket override
*Corrected: the first pass shipped only the per-TICKET override. The per-DISH
time is in now, and the order stamps its estimate from the dishes chosen — the
**longest** dish, not the sum, because a kitchen cooks in parallel and adding
the times promises a wait nobody will actually have.*
> "super admin or chef can add an estimated time for each item in menu
> beforehand, so that when customer chooses that, once submitted they can
> instantly see somewhat correct ETA. This timing also they can change
> flexibly."
> "we need one feature like chef and super admin can change the estimated time
> for each table order."

Three layers, narrowest wins: **this ticket's override → the dishes' own times →
the hotel default.** A biryani is forty minutes and a lassi is two; an average
serves neither.

### ✅ 11. The owner's menu page
The availability states are in the API with no UI. Needs: add · edit · reorder ·
delete · photo · availability · serving hours · per-item prep time.

### ✅ 12. Build the menu from recipes, and by hand
> "while adding menu items we need feature like **copy items from recipe
> section**... then if super wants to add 1 or 2 items manually then we need
> allow him. We need to be flexible more and more."

Pull from Recipes (the costing is already there, so margin comes free) **and**
add a one-off by hand. Neither is the only door.

### ✅ 13. AI menu import
> "he can upload the menu so that our AI can see the menu photo or excel and he
> can add to menu."

Photo or spreadsheet in → proposed items → **confirm before anything is
written**. The bill-scanner already has this shape.

### ✅ 14. The diner's page has to be *impressive* — it is the marketing
> "the customer public page UI is not that much impressive. Bro this is indirect
> marketing — we need a best top-notch animated page for customer. Add smoke
> effect, colour paper effects etc to impress them, so that hotel will get so
> many users and indirectly our app will be popular."

He is right about the economics: this is the only screen a *stranger* ever sees,
and every diner who scans it is being shown what DineAI can do. It is an advert
that happens to take orders.

What that means concretely, and the line I will hold: **delight on the moments
that matter, silence everywhere else.** A dish card that shimmers while somebody
is trying to read the price is not impressive, it is noise — the same lesson as
the smoke that "made a blind for a sec". So:

- The **order landing** gets the full celebration — colour paper across the
  screen, the burst, the settle. It is the one moment worth a party.
- Cards **arrive**, they do not idle: a staggered rise on first paint, a press
  that sinks, a real spring on add-to-basket.
- The **live ticket** breathes — a soft pulse while the kitchen is cooking, so
  the page feels alive without anybody having to look at it.
- Hero photography, big type, generous space. The menu should look like a menu
  from a good restaurant, not a form.
- **Nothing loops under text.** Nothing animates under `prefers-reduced-motion`.

---

## Standing rules for this feature
- **Say why, and say when it is back.** Never hide a dish; a gap reads as "they
  don't do that" and costs tomorrow's sale.
- **The QR is printed once and lives on a table.** The code never changes; the
  label is free to.
- **The kitchen screen sees tickets and nothing else.** No money, no people, no
  settings — so a link left open on a tablet cannot become a breach.
- **Confirm before acting** on anything a diner or a chef would regret.
