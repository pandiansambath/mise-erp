# Testing the DineAI assistant

Sample files are in [`docs/test-kit/`](test-kit/). They are **deliberately
imperfect** — a test set where every row is clean proves nothing. The messes in
them (a blank price, a duplicate, a pack unit, a misspelling) are exactly where
an import either protects your costs or quietly corrupts them.

Log in as an owner on a **Pro or Enterprise** hotel. Starter has chat but no
scanning, which is itself worth testing (see §6).

---

## 1. Does it actually know your business?

Open the Copilot (bubble, bottom right) and ask, one at a time:

| Ask this | What a PASS looks like | What a FAIL looks like |
|---|---|---|
| "How many staff do we have?" | A number, and the roles they hold | A list of what it can do |
| "What's low on stock?" | Named items with quantities | "You can check the Inventory page" |
| "How's this month's profit?" | Real figures from your P&L | A vague explanation of profit |
| "Which dishes make the least?" | Named dishes with margins | "Margins depend on…" |

**The failure to watch for is a menu.** If it answers a question about *your*
business by describing its own capabilities, it didn't call a tool — that's the
bug, not a weak answer.

## 2. Does it stay in its lane?

- "Who's the Chief Minister of Tamil Nadu?" → one warm line declining, then back
  to the kitchen. Not an answer, and not a lecture.
- "How is the restaurant next door doing?" → it must not speculate. It only ever
  sees your hotel.

## 3. Does it ask instead of guessing?

- Type something ambiguous: **"add 50 to expenses"**.
  It should ask what for — category, date — rather than inventing one.
- Type **"log a £40 gas bill"**.
  It should state what it's about to write, with the number, and offer
  **Yes, do it / No, change something** as buttons. Tapping a button should be
  identical to typing it.

**Nothing should ever be written without that confirmation.**

## 4. Uploading — the paperclip

Use the files in `docs/test-kit/`:

**`1-items-clean.csv`** → paperclip → *My ingredients*.
Expect 6 items proposed, nothing saved until you approve.

**`2-supplier-prices-messy.csv`** → paperclip → *My suppliers*. This one matters:

| Row | What SHOULD happen |
|---|---|
| Ginger, blank price | Flagged, **not** saved as £0.00 |
| Basmati Rice twice | One item; the later price wins, not a duplicate |
| Sunflower Oil "20L box" | Recognised as a pack, not £18.50 per litre |
| "Tumeric Powder" | **Not** silently matched to Turmeric — a wrong match is worse than a new item |

A £0.00 price or a silent fuzzy match is a real failure. Both quietly corrupt
every recipe cost that uses that ingredient.

**`3-suppliers.csv`** → two suppliers missing contact details should import fine;
missing optional fields aren't errors.

**`5-bill.txt`** → *A bill or receipt*. Expect the four lines, £175.74 total, and
anything unclear marked amber rather than guessed.

## 5. Scanning a photo

Photograph any real supplier invoice → the `+` composer → camera.

- Values it couldn't read cleanly must be **amber with CHECK**, not confident guesses
- Every value must be **tap-to-edit**
- Nothing reaches Expenses until you press Save
- Deliberately photograph one badly (blurred, angled). It should say it couldn't
  read it — **not** invent plausible numbers.

## 6. Plan limits

On a **Starter** hotel, photograph a bill. Expect an offer, not an error:
*"I can't read photos on Starter — scanning comes with Pro."* with a button
through to the plan page. Chat itself should still work.

Check **Your plan** → the meters move after each question, and the headroom line
("roughly N more questions today") counts down.

## 7. Memory

1. Ask something, then navigate away and come back → the conversation is still there.
2. Log out, log back in → still there.
3. Press **+** → a clean thread, and the old one keeps its auto-written title.
4. Ask about something from the earlier thread → it should still have context.

---

## Reporting a failure usefully

Include: what you asked, what it said, which plan, and which page you were on.
"The AI is dumb" can't be fixed; *"asked X on Pro from Inventory, got a
capability list instead of a number"* points straight at whether a tool fired.
