# Voice + chat — the checklist

His words, in one place, ticked as they ship.

## 1 · The voice model

| # | What he said | Status |
|---|---|---|
| V1 | Voice-to-voice, "aurora style UI when we speak" | ⬜ |
| V2 | Multilingual — English, **Tamil, Telugu**, Hindi, European; friendly, can joke | ⬜ |
| V3 | Voice → ACTION: read, write, navigate, "literally anything with the owner's permission" | ⬜ |
| V4 | Confirmation on screen before a serious action | ⬜ |
| V5 | Confirmation is **configurable** — always ask / give all access / never ask | ⬜ |
| V6 | **5–6 voices** — 3 male, 3 female | ⬜ |
| V1.1 | Opens as a **small bubble in the corner** so the dashboard stays visible | ⬜ |
| V1.1b | "Add this sale into sales page" → it navigates, types the value, submits. Hands-free | ⬜ |
| V1.1c | Enterprise-plan feature | ⬜ |
| V1.2 | Efficient, and the best UI we have | ⬜ |

## 2 · The written assistant

| # | What he said | Status |
|---|---|---|
| C1 | "our Sonnet model is not tuned" | ⬜ |
| C2 | The chat interface is "not impressive, not even nice to look at… very very tight" | ⬜ |
| C3 | Both the **bubble** and the **full page** need it | ⬜ |

---

**Decision and reasoning: `docs/VOICE_RESEARCH.md`.**
Short version: Gemini Live API, because Tamil and Telugu rule out Amazon Nova
Sonic — which is otherwise the better fit, since it is already on our Bedrock
account. Needs a key from aistudio.google.com that only he can create.
