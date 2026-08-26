# Voice round 4 — it started talking to itself

| # | What he said | State |
|---|---|---|
| 1 | **The chat box flickers, and the text inside flickers** | ☐ |
| 2 | "open money page" heard as "money pin" — it answers anyway, inaccurately | ☐ |
| 3 | The paperclip needs more: camera on mobile, photos | ☐ |
| 4 | The old chat had a **draggable window, a draggable bubble and a settings icon** — all missing | ☐ |
| 5 | The expanded view is still tight — put everything left or right and let the text take a whole side | ☐ |

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
