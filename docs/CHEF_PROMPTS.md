# 🧑‍🍳 THE MISE CHEF — Nano Banana Pro prompt pack

Generate these with **Nano Banana Pro** (Gemini image). Workflow for perfect
consistency: generate **Pose 1 first**, then for every other pose **attach
Pose 1 as the reference image** and say *"same exact character, same style,
same lighting, same background, new pose: …"*. Nano Banana is excellent at
character consistency from a reference — use it.

**Specs for every image (important):**
- Square **1:1**, biggest size it gives (we downscale)
- **PNG**
- Background must be the SAME on all: *dark emerald-black gradient studio
  backdrop* (it must blend into our dark UI)
- Bust/waist-up framing, character centered, nothing cropped at the sides

**Delivery:** drop the files into `frontend/public/chef/` with EXACTLY these
filenames (lowercase) and tell me — they go live with zero code changes:

| # | Filename | Used for | Pose prompt (append to the identity block) |
|---|----------|----------|--------------------------------------------|
| 1 | `watch.png` | login/signup — watching you type | gentle warm smile, eyes open, looking slightly downward and to the side as if kindly reading something on a desk below him |
| 2 | `cover.png` | password typing | playing peek-a-boo: BOTH hands pressed flat over his own eyes, palms completely covering both eyes so he cannot see anything, elbows out, playful expression |
| 3 | `peek.png` | "show password" pressed | both hands over his face but fingers spread apart, ONE eye clearly visible peeking through the gap between fingers, mischievous grin |
| 4 | `happy.png` | signing you in | eyes closed in delight, big joyful laugh, hands clasped together in front of his chest |
| 5 | `welcome.png` | onboarding welcome | both arms open wide in a warm welcoming gesture, big proud smile, as if welcoming a guest into his restaurant |
| 6 | `shrug.png` | empty states ("no data yet") | holding an empty white plate in one hand and shrugging with the other, friendly apologetic smile |
| 7 | `serve.png` | success moments | proudly lifting a silver cloche off a serving plate with steam rising, delighted expression |
| 8 | `point.png` | punch clock / attendance | tapping the face of a classic wristwatch on his left wrist with his right index finger, friendly "it's time" expression |
| 9 | `think.png` | Ask Mise / Copilot | one hand stroking his chin thoughtfully, eyes looking up and to the side, thinking hard |
| 10 | `books.png` | reports / how-it-works | wearing thin reading glasses, holding an open ledger book in one arm, pointing at it with the other hand, teacherly smile |

## THE IDENTITY BLOCK (start EVERY prompt with this, word for word)

```
Premium 3D character render in the style of a high-end animated feature film
(Pixar/Dreamworks quality), a distinguished Indian head chef in his mid-40s,
warm brown skin, neat black moustache, kind expressive eyes, wearing a
pristine white double-breasted chef jacket with an emerald green neckerchief
and a tall white chef's toque, bust framing (head and shoulders to waist),
centered composition, facing the viewer, soft candlelit rim lighting,
cinematic dark emerald-black gradient studio background, ultra detailed,
smooth subsurface-scattering skin, cozy premium mood, octane render quality.
Pose: <POSE PROMPT FROM THE TABLE>
```

## Notes
- Interim (lower-res) versions of 1–4 are already wired and live — your 4K
  files simply overwrite them.
- If Nano Banana offers "consistent character / use reference", ALWAYS feed
  pose 1's image as the reference for 2–10.
- Poses 5–10 unlock the "living chef everywhere" pass (empty states, punch
  clock, copilot, onboarding) — I wire each as it lands.
