# Voice round 6

| # | What he said | State |
|---|---|---|
| 1 | The conversation area is still very tight | ☐ |
| 2 | **The aurora is static** — it must MOVE, like the Gemini UI | ✅ |
| 3 | **I can't move the bubble any more** | ✅ |
| 4 | The settings popup runs off the bottom of the screen | ✅ |
| 5 | In the expanded view the aurora clashes with the burgundy theme — keep aurora in the BUBBLE only | ✅ |
| 6 | On mobile the whole chat screen flickers while the voice replies | ✅ |
| 7 | It goes offline after a few seconds; I want a configurable "hey DineAI" wake word | ✅ |
| 8 | **It only hears the last two words** — "hey hi how was ur day" becomes "was ur day" | ✅ |

## 3 is a regression I caused this morning

Fixing "the drag blocks the X button" I made the handle ignore any pointer that
lands on a button. The launcher IS a button — so the guard that let him press
the close button stopped him dragging the bubble at all. One fix, one new
breakage, same day.

## 8 and 7 are the same underlying mistake

Transcribe streams a series of SEGMENTS, not one growing string. I was assigning
each segment over the last (`heardRef.current = text`), so "hey hi how" was
replaced by "was ur day" rather than added to it. It never heard less; it
overwrote what it had already heard.

And "goes offline after a few seconds" is the deafness working too well: while
muted I sent NO audio at all, and Transcribe closes a stream that has been
silent for fifteen seconds. Muting has to mean sending silence, not sending
nothing.


## The screenshot that explained three of them at once

> "You have reached your limit of concurrent streams, 25. Try again later."

Every restart of listening opened a NEW Transcribe socket and left the previous
one running. They piled up to the account limit — and until they did, every live
stream was delivering the same transcript, which is why one sentence came back
as three near-identical answers. The duplicates, the warning and part of the
flicker were one leak seen from three sides.

Fixed by closing the old listener before opening a new one, plus a guard that
refuses the same sentence twice within six seconds: he asked once.
