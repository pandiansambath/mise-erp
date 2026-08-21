# Batch 3 — Roles & Access, 21 Aug evening

> "so what else pending???"

Everything below, in his order. Ticked only when it is verified on the deployed
site, not when the code is written.

---

## The style he wants kept

> "I love this popup view — seriously loving this style. The cards, the shadow
>  inside the cards, the colours, the view. The shadow inside the card gives a
>  3D feel. Please note down this style in your memory; we will use it in future
>  whenever I say I don't like the UI of another page. It's clear, crisp and
>  clean with a stylish look."

**This is now the house reference.** `components/AccessModal.tsx` — centred
modal, master rail on the left, `mise-well` cards inset on `bg-paper`, the
inner shadow doing the depth rather than a drop shadow underneath. When he says
a page's UI is wrong, this is the one to copy.

---

## The list

| # | What he said | Status |
|---|---|---|
| 1 | Keep this popup style as the house style | ✅ `nirai-way-of-working` memory |
| 2 | "Create a role" should be the FIRST card, not last | ✅ lifted to the top of the board |
| 3 | Confirm before changing access — ok/cancel, everywhere | ✅ bulk, all 3 saves, assign, remove |
| 4.1 | The "unusual" chip is blurry / unreadable on this theme | ✅ `.mise-chip-warn`, real contrast + border |
| 4.2 | "unusual" should be a button → why, the right way, the impact | ✅ "unusual — why?" opens its own popup |
| 4.3 | By job / By person: after shrinking it looks tight and clumsy — move them right, smoothly | ✅ right-aligned exactly via `100cqw` |
| 4.4 | Bottom-left of the popup, "Their own" is under a white overlay and cannot be clicked | ✅ panes bounded; it was overflow, not an overlay |
| 5a | All **33 pages** individually configurable — not bundled under 17 | ✅ per-page ticks; sidebar honours them |
| 5b | "People in this role" should open the list of who they are | ✅ the count is a button → names + emails |
| 5c | The name field needs a confirmation too — touching it must not silently edit | ✅ says "renaming from …", and save asks |
| 6 | **Act as a manual tester**: make a staff login, grant a page, sign in AS them, prove it appears; revoke, prove it goes | ✅ done on his tenant, 3 sign-ins, screenshots |
| 7 | Use the popup's card style on the Roles & Access board cards | ✅ `.mise-card-inset` — trial on this page |

---

## Notes on the harder ones

### 3 + 5c · Confirm before it changes
> "let's say someone changing the role read to write, or giving full access, or
>  using the consolidated button — we need to ask for confirmation, else it will
>  create confusion."

And a standing rule, in his words: *"note this in your memory and keep it safe
and implement everywhere when you add a new feature hereafter, or any missing
areas in later updates."*

The bulk buttons are the sharp edge — one tap moves 17 switches — but the point
is broader: nothing that changes what a person can reach should happen because
a finger brushed a control.

### 4.2 · "Unusual" has to explain itself
Right now it is a word with no argument behind it. It should open its own popup
saying **why** it is unusual for this job, **what the normal arrangement is**,
and **what it lets them do** — then get out of the way and let him decide. He is
the owner; the job is to make the consequence visible, not to argue.

### 5a · The real one
> "under Inventory you gave 3 things — but what if super admin wants to give
>  only the Inventory page alone, not Stock-take and Waste? We need to be
>  flexible. Don't suppress under 17."

This is the piece I flagged as needing ~15 new permissions and per-page gating.
It is the biggest item here and it is what he has now asked for twice.

### 6 · Prove it end to end
> "not only this role page... once we give permission to someone, in their
>  account it needs to reflect. That is what a real functionality check is."

Make a login, grant one page, sign in as that account, confirm the page is
reachable and the others are not, revoke it, confirm it is gone. Playwright,
his tenant, real screenshots.


---

## How 5a actually works, and its one honest limit

Each of the 17 switches still decides what someone may **read or change** — that
is a permission, and it cannot be split per page, because Inventory, Stock-take
and Waste are all reading the same stock. Splitting it would need a separate
permission behind every screen and a separate guard on every route.

What IS now per-page is **which of those screens they are handed.** Every row
lists its pages as ticks; untick Waste and Waste leaves their sidebar, while
Inventory stays. Stored as `page:<slug>` grants, and the rule is deliberately
quiet: an area nobody has narrowed shows all its pages, so nothing changes for a
hotel that never opens this.

**The limit, said plainly:** this takes screens away, it never adds them, and it
is a menu rather than a lock. Somebody who is handed Inventory but not Waste
cannot reach the Waste screen — but the stock permission behind it is still what
guards the data itself. For "give him Inventory, not Waste" that is exactly
right. If you ever want Waste to be genuinely sealed off from a person who can
otherwise touch stock, that needs its own permission and its own guard, and I
will say so rather than pretending a hidden menu did it.


---

## 6 · What the end-to-end run actually proved

Run against the live site as a throwaway `probe*@dineai.cloud` login, signing in
as that person three times:

| Step | Their own sidebar |
|---|---|
| Fresh STAFF account | Dashboard · My Space · How it works. **No Stock at all.** |
| Granted `inventory:read` + `page:inventory` only | **STOCK → Inventory.** No Stock-take. No Waste. |
| `/inventory` opened directly | Loads. No 403, no "you don't have access". |
| Revoked | The whole STOCK section gone again. |

That is 5a proven from the other side of the account, which is the only side
that counts. The account was deleted afterwards — this runs against his real
restaurant.

**All twelve items are now ticked.**


---

## The regression I shipped, and what it cost

Twenty minutes after 5a went live, a screenshot showed the OWNER's sidebar
collapsed to Dashboard, How it works and Your plan.

`canOpenPage` asked `levelOf(area, held)` before anything else. `levelOf` looks
for an area's own permission strings; the owner holds the wildcard `*` and none
of those, so every area came back "none" and the filter hid all of it.

**The end-to-end test I had just written sailed straight past it.** It signs in
as a probe account holding real permissions and real page grants — the one
account it broke was the one I was signed in as. So the rule he gave me needs
one more clause: being the manual tester is not enough if you only ever test as
one kind of user. There is now a test asserting the owner keeps Inventory,
Purchasing, Vendors, Recipes, Employees and Payroll in their own sidebar.

Verified on the live build afterwards, by looking:

- the sidebar is whole again
- **Create a role** is the first card
- board cards carry `.mise-card-inset`, no `.mise-card3d` left on the page
- Stock-take and Waste are their own clickable ticks under Inventory
- **People with this job → 2** opens onto manager@gmail.com and manager2@gmail.com
