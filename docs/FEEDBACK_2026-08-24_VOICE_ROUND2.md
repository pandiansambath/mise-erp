# Voice + chat, round 2 — the batch he sent after using it

> "please continue from where u left... also bro i chceked the site now....
>  let me give feedback now itseld"

He used it on Brave, on his own data, and the list is mostly about SPEED and
about the chat looking nothing like the voice. Nothing here is cosmetic-only:
items 4 and 5 are the difference between a demo and a thing he would use.

| # | What he said | State |
|---|---|---|
| 1 | Two bubbles is awkward — combine them | ✅ |
| 2 | The chat interface is the worst UI; the voice is top-notch. Put the voice's UI on the WHOLE chat | ✅ |
| 3 | Aurora + bubble icon must obey the selected theme — without losing the aurora | ✅ |
| 4 | **Tapped the mic, said something, waited 2 minutes, nothing.** Then the suggestion chip worked, but text took 3s and voice much longer. Too slow | ✅ |
| 5 | It stops listening mid-sentence and answers early. It must listen in real time like Gemini | ✅ |
| 6 | Asked a question with an action in it and the AI got it wrong — needs tuning | ◐ |
| 7 | The expanded chat is very tight. Look at a modern chat UI. Use the voice UI here too | ✅ |
| 8 | *(Sales/Expenses — he said this one can go last)* cash card has a gap; previous closing should become today's opening automatically instead of needing the dead grey Save; Expenses filter should always come back to today | ✅ |

◐ = the prompt is tuned and the always-on rules are in; whether it actually
behaves on his phrasing is a thing to watch, not a thing to declare.

## What each one actually is

### 1 + 2 + 7 — one assistant, wearing the face he likes

Two floating launchers for one assistant was never a design, it was an
accident of building the voice second. And he is right about which one to
keep: he called the voice panel "best top notch" and the chat "worst" in the
same breath, so the answer is not to meet in the middle.

### 4 — where the seconds actually go

Two round trips, in series: `/voice/turn` returns text, and only THEN
`/voice/speak` starts Polly. The mouth cannot open until a second request has
crossed the Atlantic and a second model has run. That is the structural half.
The "nothing at all for two minutes" half is different and worse — see 5.

### 5 — `continuous = false` was the bug

The recogniser was set to stop at the first pause, which is why it answered
half a sentence. And when Brave blocks the speech endpoint it neither returns
nor errors, so the panel sat on "Listening…" forever with nothing to say. Both
are one fix: drive the turn-end ourselves from a silence timer, and put a
ceiling on how long we will wait in silence before admitting it is stuck.


## Item 8, since it turned out to be three different faults

**The gap above the cash strip.** `sticky top-0` parks the bar against the top
of the scroll area, but the page keeps its own top padding above that — so on
any scroll a band of page background showed above the bar and it read as
detached. A lid with daylight above it is not a lid. Filled without touching the
layout.

**The carry-forward was already working. Everything else was not.** The server
has offered yesterday's close as `suggested_opening` all along and it goes
straight into the field — that part he was right to expect and it was there. But
every total below it came from the SAVED record, where the opening is still
zero, so the page showed a float in the box and £0.00 expected at the same time.
The only way to make them agree was to press the one button that looked
disabled. Now the totals track the field, and the number is derived by adjusting
the server's own figure by the difference rather than recomputing it here —
`expected` also subtracts unbooked petty cash, which that panel never shows, and
a second copy of a money formula is a second thing to get wrong.

**The dead grey Save.** `bg-glass/10` with white text: a pale block that reads as
disabled. It is the only way to commit a count, so it now looks like the primary
action it is, and says "Saved" when there is nothing to save.

**Expenses always opens on today — and this REVERSES an earlier request.**
Remembering the range for the session was his own ask, and it still holds on
Reports, Attendance and Sales. Expenses is the exception he has now named, and
the reason is good: you widen it to chase one thing down, and every later glance
quietly answers a question you stopped asking. Worth knowing the two
instructions exist, in case he wants the same treatment elsewhere.
