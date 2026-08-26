# Voice round 4 — it started talking to itself

| # | What he said | State |
|---|---|---|
| 1 | **The chat box flickers, and the text inside flickers** | ✅ |
| 2 | "open money page" heard as "money pin" — it answers anyway, inaccurately | ✅ |
| 3 | The paperclip needs more: camera on mobile, photos | ✅ |
| 4 | The old chat had a **draggable window, a draggable bubble and a settings icon** — all missing | ✅ |
| 5 | The expanded view is still tight — put everything left or right and let the text take a whole side | ✅ |

## 1 and 2 are the same bug, and it is mine

Those repeated stubs in his screenshot — "money pin.", "my money thing.", "the
money thing.", "my." — are not mishearings of him. They are Amy, coming out of
his speakers and back in through his microphone, transcribed and answered.
Every reply started another one, which is the flicker: the panel was re-rendering
a new turn every second or so, forever.

The guard I wrote was `muted: () => drainingRef.current` — deaf only while a
chunk is actually PLAYING. It misses:

  * the gap between the reply arriving and the first audio chunk starting
  * the gaps BETWEEN queued sentences
  * the tail of the last word, still in the room after playback ends

Three holes, each wide enough for the loop to start. `echoCancellation: true`
was doing the rest of the work and it cannot cancel what it never played —
browser AEC works against the tab's own output, and a laptop speaker into a
laptop microphone defeats it routinely.


## What shipped

**1 + 2 — three holes closed.** It is now deaf while thinking, while speaking,
and for 900ms after the last word leaves the speaker — plus a second check when
the transcript arrives, because audio already in flight comes back a moment
later. Both ears use the same rule, since the browser's own speech API had the
identical hole.

A weak fragment filter sits behind that, and its limit is worth stating: "money
pin." is ten characters and two words, and so is "show sales". Nothing about
their shape separates them, so no length rule can reject one and keep the other.
It catches debris. The loop fix is the actual defence.

**2 also got better ears.** Partial-results stabilisation set to high, so
Transcribe holds a partial until it is reasonably sure rather than revising it
in public — and a custom vocabulary of every page name and the kitchen words a
general model has never met. It self-enables only once AWS reports it READY:
naming a PENDING vocabulary makes Transcribe refuse the whole connection, which
trades a mishearing for total silence.

**3 — the paperclip opens the library, the Files app or a document**, and a
second camera button appears on phones. One input cannot both offer the library
and open the lens; `capture` forces the camera and removes the choice, so there
are two.

**4 — dragging is back**, on the bubble and on the panel's header. The old
Copilot had it and I dropped it when the voice became the only assistant. Where
a floating thing lives is the user's decision — no corner we pick is free on
every page.

**5 — the centring was mine and it was wrong.** I had capped every row at 60rem
and centred it, which is precisely the pinched column he keeps pointing at.
Rows span the full width now and the bubbles pick a side.
