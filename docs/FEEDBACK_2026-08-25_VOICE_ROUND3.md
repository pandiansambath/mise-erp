# Voice + chat, round 3 — after he used it on Brave

> "tried voice model..still its not listenig the voice...also getting some error"
> "one thing is i love this chat interface ui..keep it up"

| # | What he said | State |
|---|---|---|
| 1 | **The voice still does not listen.** Brave blocks the speech service | ☐ |
| 2 | It must OPEN the conversation like Gemini — greet him, suggest, offer | ☐ |
| 3 | Photo / file upload and the other Copilot features are missing from the new panel | ☐ |
| 4 | The expanded `/ai-scan` view is still tight and not nice — put the bubble's UI on it | ☐ |
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
