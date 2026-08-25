# Voice + chat, round 3 — after he used it on Brave

> "tried voice model..still its not listenig the voice...also getting some error"
> "one thing is i love this chat interface ui..keep it up"

| # | What he said | State |
|---|---|---|
| 1 | **The voice still does not listen.** Brave blocks the speech service | ✅ |
| 2 | It must OPEN the conversation like Gemini — greet him, suggest, offer | ✅ |
| 3 | Photo / file upload and the other Copilot features are missing from the new panel | ✅ |
| 4 | The expanded `/ai-scan` view is still tight and not nice — put the bubble's UI on it | ✅ |
| 5 | *(praise, and a constraint)* he loves the bubble chat UI — do not lose it | ✅ keep |

## 1 is the one that matters, and my fallback was a dead end

The panel is showing the right message — "This browser blocks the speech service
(Brave and some privacy browsers do)" — and that message is useless to him,
because Brave is the browser he uses. Naming the obstacle honestly is not the
same as removing it, and I treated it as though it were.

The Web Speech API is a Chrome feature that ships the audio to Google. Brave
strips it. There is no flag we can set from our side, so the ears have to move
to our own stack.

## 2 — silence is not a personality

He is right that a voice assistant which waits to be spoken to first is
strange. Gemini opens its mouth. Ours sits there with an orb and three chips.


## What shipped

**1 — we grew our own ears.** The browser now streams audio straight to Amazon
Transcribe over a WebSocket our server signs. Our box never sees a byte of it:
an always-on microphone proxied through a t3.micro would be a permanent audio
stream per user, and a socket to re-establish on every deploy. The credential
stays on the server; the browser gets a signature good for five minutes that
permits nothing but transcription.

It is the FALLBACK, not the replacement — where the browser's own speech works
it is free and instant, so it is still tried first. The switch happens on the
network error Brave produces, once per session, and it does not ask that
browser again.

The fiddly part is that Transcribe speaks AWS's binary event-stream framing
rather than JSON: every message is a length-prefixed envelope with its own
CRC32 checksums. That is most of `lib/transcribe.ts`.

**2 — it speaks first**, with one of five openers rather than one fixed line,
because the same sentence every morning is how you learn to stop listening.
Deliberately not a model call: it must be instant and free, and spending a
Bedrock turn on "hello" would put two seconds on opening a panel.

**3 — the paperclip is back.** Combining the two launchers must not quietly
delete bill scanning from every screen. The file rides across in memory and
/ai-scan reads it, rather than a second copy of the extract-confirm-save path
living in a corner bubble — that is the path where a wrong number reaches his
books, and it should exist once.

**4 — the composer matches the bubble**, and the thread is a column rather than
the full width of a desk.
