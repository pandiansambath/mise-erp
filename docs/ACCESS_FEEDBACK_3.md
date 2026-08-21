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
| 5a | All **33 pages** individually configurable — not bundled under 17 | ⬜ |
| 5b | "People in this role" should open the list of who they are | ✅ the count is a button → names + emails |
| 5c | The name field needs a confirmation too — touching it must not silently edit | ✅ says "renaming from …", and save asks |
| 6 | **Act as a manual tester**: make a staff login, grant a page, sign in AS them, prove it appears; revoke, prove it goes | ⬜ |
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
