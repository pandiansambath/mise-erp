# Voice control for DineAI — the research

> "I want this kind of voice model for our project, with this same aurora style
>  UI when we speak. Voice to voice, voice to ACTION... literally I can do
>  anything with the owner's permission... it can talk in any language, mainly
>  English, Tamil, Telugu, Hindi + European... it can make fun, humour...
>  whenever any serious action needs to be done the model needs to get
>  confirmation on screen."

---

## The decision: **Gemini Live API**

`gemini-2.5-flash-native-audio` (or `gemini-3.1-flash-live-preview`)

**Tamil and Telugu decided it.** That is not a preference, it is a filter, and it
removes the option I wanted to pick.

| | Tamil | Telugu | Hindi | Voices | Tools in-session | Notes |
|---|---|---|---|---|---|---|
| **Gemini Live** | ✅ `ta` | ✅ `te` | ✅ | **30** | ✅ | 97 languages, switches mid-sentence |
| Amazon Nova 2 Sonic | ❌ | ❌ | ✅ | 3–9 | ✅ | **Already on our AWS account** |
| OpenAI gpt-realtime-2 | ? | ? | ✅ | 9 | ✅ | 32+ languages; ta/te not listed |

**Nova Sonic is the one I would have chosen on every other axis.** We are already
on Bedrock, it is the same IAM role, the same bill, no second vendor. It has
Hindi. It does not have Tamil or Telugu, and a Madurai kitchen being told to
speak Hindi is not a feature. So it loses.

The cost of choosing Gemini is real and worth saying out loud: **a second AI
provider** — another key, another bill, another thing that can go down
independently of Bedrock. Claude stays as the brain of the written assistant;
Gemini becomes the ears and mouth.

### What it costs

About **£0.02 a minute** of conversation (~$0.005/min in, ~$0.018/min out at
$3/$12 per 1M audio tokens). An owner talking to it for 20 minutes a day is
roughly **£8/month**. That is an enterprise-tier feature comfortably.

### Voices

30 prebuilt. Plenty for his "3 male, 3 female" — Puck (friendly), Charon (deep),
Fenrir (warm), Kore (neutral), Aoede, Leda, and 24 more. Named and picked in
settings, previewable before choosing.

### The limits, stated before we build on them

- **15 minutes per audio session.** Longer needs session resumption — a
  reconnect that carries the context. Not a blocker, but it is real work.
- **Ephemeral tokens lock the model and the modality, NOT the system prompt or
  the tool list.** This is the important one, and it decides the architecture.

---

## The architecture, and the one rule that matters

> **The voice model never decides whether an action is allowed. It proposes;
> our server authorises.**

Because a browser holding an ephemeral token talks to Google directly, anything
the client "enforces" is a suggestion. If the confirmation lived in the prompt,
a determined person — or a confused model — could skip it. So:

```
  mic ──► browser ──ephemeral token──► Gemini Live (voice, language, humour)
                        │
                        │ tool call: "record_sale", { amount: 120, method: cash }
                        ▼
                   DineAI frontend
                        │  1. NAVIGATES to /sales   ← he watches it happen
                        │  2. FILLS the real form
                        │  3. asks for confirmation (unless configured otherwise)
                        ▼
                   DineAI API  ← the real permission check, as always
```

Three things fall out of that, all of them good:

1. **It is theatre that is also real.** He asked to *see* it navigate and type.
   The front-end drives the actual form, so what he watches is the same code
   path a finger would take — not a simulation that writes by a side door.
2. **Permissions come free.** A Cashier's voice session cannot touch payroll,
   because the write goes through the same endpoint with the same guard. All the
   Roles & Access work we just did governs the voice too, with no extra code.
3. **Confirmation cannot be talked out of.** The dialog is ours, on our page,
   fired by our code. The model can ask for an action; it cannot grant one.

### Confirmation modes (configurable, as he asked)

| Mode | Behaviour |
|---|---|
| **Ask every time** | Safest. Every write confirms. |
| **Ask for money and people** *(default)* | Sales, expenses, payroll, staff → confirm. Navigation, lookups, reading → just do it. |
| **Never ask** | Owner only, and the settings page says plainly what that means. |

Reading is never gated. "What did we take today?" should just answer.

---

## What gets built

**Phase 1 — it listens and it talks.** The corner bubble, aurora ring, mic in,
voice out, language switching, voice picker. It can ANSWER (read-only tools:
today's sales, what's low, who's in). No writes. This is most of the value and
none of the risk.

**Phase 2 — it acts.** `navigate`, `fill`, `submit` against a small registry of
known forms — sales, expenses, an order. Confirmation gating. Every action
audited with "by voice" so the log tells the truth about how it happened.

**Phase 3 — it is good at it.** More forms, better recovery when it mishears a
number, and the settings for modes and voices.

### Getting the key

1. **aistudio.google.com** → *Get API key* → new project (or an existing Google
   Cloud one). Free tier exists for trying it; Live API needs billing enabled.
2. Key goes in the backend env as `GEMINI_LIVE_API_KEY` — **never** in the
   frontend. The browser only ever receives a 1-minute ephemeral token minted by
   our server for a signed-in user.
3. It is a *second* Google key: [[nirai-copilot]] already has a Gemini key for
   the older assistant path. Same console, separate key, so one can be revoked
   without killing the other.

**This needs him to create it** — I cannot, and should not, mint a key against
his Google account.

---

## The honest risks

- **Numbers are where voice agents fail.** "One twenty" is £120 or £1.20
  depending on the day. The form is filled and shown but never submitted without
  him seeing the figure, in every mode except "never ask" — and the settings
  page will say so.
- **A restaurant is loud.** Expect a mis-hear rate that makes "read it back"
  worth building rather than optional.
- **Session cost is per minute, not per question.** An open mic left on a
  counter all day is a bill. The bubble should close itself when idle, and
  [[nirai-ai-cost-safeguards]] applies here more than anywhere.
