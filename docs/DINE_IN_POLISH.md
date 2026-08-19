# Dine-in polish — the checklist

Working top to bottom. Ticked as each one ships.

---

## ✅ 1. The assistant answers nothing — **not a code bug**

> "i asked how much calories i may get + how much fat is there... this is what i
> asked. Simple question also it can't answer me."

Production says exactly why:

```
app.assistant.bedrock.BedrockUnavailable:
Claude isn't switched on for this AWS account yet —
enable model access for Anthropic in the Bedrock console (one-time).
```

**This needs one click from you and cannot be done from code.** AWS Console →
Bedrock (eu-west-2) → *Model access* → enable **Anthropic Claude**. Every AI
feature in DineAI is waiting on that same switch.

What I *can* fix, and am:
- The message is honest instead of vague, and says who to tell.
- **The nutrition rule was too strict.** I forbade every figure to stop the model
  inventing numbers — but a blanket refusal makes the feature useless, which is
  what he hit. The honest middle: a **clearly-labelled rough estimate** built
  from the dish's real ingredients, never a precise claim, never for allergies.
  A waiter who knows food would say "roughly 600–700, it's a rich one" — that is
  useful and honest; "I cannot tell you" is neither.

## ✅ 2. Scroll-to-shrink is gone on Tables and Kitchen
> "here also that scroll down to shrink and up to grow is removed... I said to
> make it enhancement and bug free."

My fault, and a bad trade: I stopped tall toolbars tucking because they were
overlapping the cards. That fixed the overlap by deleting the feature. The
toolbar should **condense** — controls shrink, labels drop away — so it still
tucks without ever hanging over the page.

## ✅ 3. The Tables creator reads as two competing forms
> "this area is still confusing the laymans... instead of showing as separate
> thing, show as single itself, in a unique way."

`10 · Table · 4 seats · Create` sitting beside `Bar 1 · 4 · Add` is two forms
answering one question. One control: say how many, or name one.

## ✅ 4. Kitchen page — no alignment, clumsy
> "there is no alignment, nothing is there, worth UI."

Cards of different heights, the ETA box floating, the alert band unaligned.

## ✅ 5. The dish assistant popup is not impressive
> "this UI also not that much impressive... think in different way instead of
> making the UI screen clumsy — use popup styles if you feel more data makes UI
> clumsy."

## ✅ 6. The kitchen screen can be better
> "this page is for focusing on SEEING — seeing from distance even, so need to
> show data highlighted so they no need to touch the screen. This is fine, but
> still we can enhance the UI."

Right, and it changes the rules for that page only: bigger, higher contrast,
status by colour block rather than a small dot, and nothing that needs a tap to
reveal.


---

## ✅ 7. Nutrition comes from a SEARCH, not from memory

> "for this kinda question — how much calories i may get + how much fat — please
> use our search api, let ai use our search api and get the real datas instead
> of hallucination."

Right, and it is the difference between a number and a guess wearing a number's
clothes. A model asked for calories will always produce something plausible;
only a source makes it true.

So when the question is about nutrition **and** we know what is in the dish, the
existing `websearch` module runs first and the findings are handed over as facts
to reason from. The model is told to say where the figure came from — *typical
published values for this dish*, never *this kitchen measured it*. If the lookup
returns nothing it falls back to a clearly-labelled estimate rather than
inventing precision.

Searching **only** for this, not for every question: a web lookup on "what are
you known for" would drown the hotel's own words in whatever the internet says
about a restaurant with a similar name.

**Needs a key to actually run:** `web_search_api_key` (Serper) or
`tavily_api_key`. Without one it degrades to the labelled estimate, which is the
honest behaviour rather than a broken one.
