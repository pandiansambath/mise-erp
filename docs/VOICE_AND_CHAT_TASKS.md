# 🎙️ The voice, and the chat that needed fixing

> "voice to voice, voice to action... literally I can do anything with the
>  owner's permission."
> "for now we can use bedrock... anyway action done by claude."
> "I'm ok with English, for now English alone is fine. It needs to be friendly,
>  with humour, very very friendly voice tone."
> "I don't want read-only as phase 1. I want all phases in 1 phase — write
>  actions, navigation actions, etc, with super cool UI."
> "target more on UI please."
> "our sonnet model in our DineAI is not tuned, and that chat interface is not
>  very much impressive. Currently it's very very tight — I mean both bubble and
>  full page, both are not nice."

---

## What was built

### V — the voice

- [x] **V1 · Decide the model.** Bedrock + Polly, not Gemini Live. English-only
      removed the one thing that ruled Bedrock out. See `VOICE_RESEARCH.md`.
- [x] **V2 · Polly permission.** `polly:SynthesizeSpeech` on the `mise-ec2` role,
      in `infra/iam.tf` *and* applied live so the running box has it now.
- [x] **V3 · The backend.** `app/assistant/voice.py` + three endpoints:
      `GET /voice/voices`, `POST /voice/turn`, `POST /voice/speak`.
- [x] **V4 · Six voices, three of each.** Amy, Danielle, Kajal / Arthur,
      Matthew, Stephen. Remembered per browser; previewed when picked.
- [x] **V5 · The friendly tone.** `PERSONA` — warm, funny, two or three
      sentences, never a list, says numbers the way a person says them.
- [x] **V6 · Speech, not documents.** `spoken_form()` strips markdown, emoji and
      table pipes, and turns `£1,240` into `1240 pounds` — said literally that is
      "pound one comma two four zero".
- [x] **V7 · The corner bubble.** `components/VoiceBubble.tsx`. Small, in the
      corner, the dashboard stays visible behind it — as he asked.
- [x] **V8 · The aurora.** Four blurred blobs behind frosted glass, quiet when
      idle, awake when listening, pulsing with the voice when speaking. It
      answers "is it hearing me" without a word of text.
- [x] **V9 · Navigation actions.** "take me to sales" → the page opens.
- [x] **V10 · Write actions.** "put a 120 pound cash sale in" → it opens Sales,
      finds the field by what a person calls it, and types — the real input on
      the real page, lit up so he can watch it happen.
- [x] **V11 · Confirmation, configurable.** Ask every time / ask about money and
      people (default) / just do it. In the bubble's own settings.
- [x] **V12 · The gate was a lie, and is fixed.** `enforce(feature="ai_assistant")`
      named a flag that does not exist, and unknown flags default to **on** — so
      that check passed everything. Now `ai_copilot`, the real one.

### C — the chat

- [x] **C1 · The bubble was too small.** 400×600 → 480×700. It was sized to stay
      out of the way; the complaint is that staying out of the way made it
      unusable.
- [x] **C2 · Air.** Messages `space-y-3 → space-y-5`, padding `px-4 py-4 →
      px-5 py-5`, bubbles `80% → 86%`.
- [x] **C3 · The full page was a corridor.** `/ai-scan` was `max-w-3xl` — 48rem
      on a 27-inch screen. Now `max-w-5xl`, `p-6 sm:p-8`, `space-y-6`.
- [x] **C4 · One product, heard or read.** The same aurora now sits behind both
      chat headers as behind the voice bubble.
- [x] **C5 · The starters look like an offer.** The inset card style he asked
      for, instead of hairline outlines.

---

## The rule this all hangs on

> **The voice never decides whether an action is allowed. It proposes; the
> server authorises.**

`voice.py` hands the model exactly two UI tools — `go_to` and `fill_form` — and
strips every write tool out of its kit. There is no `create_sale`. To record a
sale it navigates to Sales and fills the form, and the *form* saves it, through
the same endpoint, the same permission check and the same confirm that a finger
would have gone through.

Three things fall out of that, all of them good:

1. **It is theatre that is also real.** He asked to watch it navigate and type.
   It does — down the same code path his own hand would take.
2. **Permissions come free.** A Cashier's voice cannot touch payroll, because
   every Roles & Access decision already governs the write.
3. **Confirmation cannot be talked out of.** The dialog is ours, on our page,
   fired by our code. The model can ask for an action; it cannot grant one.

## Still open

- [ ] Tamil / Telugu / Hindi. English-only was his call *for now* — and it is
      the thing that would send us back to Gemini Live, because Polly has no
      Tamil and no Telugu.
- [ ] Barge-in (talking over it while it is speaking).
- [ ] "By voice" in the audit log, so the record says how a thing happened.
