"""Live information from outside the restaurant's own data.

You asked for an assistant that can also reach the internet for hospitality
things — ingredient prices, supplier news, food-safety rules, what competitors
charge — but explicitly NOT for medical questions and the like.

So this is deliberately two pieces, and the guard is the important one:

* `allowed()` decides whether a question is ours to answer at all.
* `search()` only runs afterwards.

**The guard is deny-first, then allow.** A blocked topic loses even if it is
phrased in food language ("is my chef's rash contagious" mentions a chef). Then
the query must show a hospitality signal to proceed. That ordering matters: an
allow-list alone would let "chef" smuggle a medical question through.

**It is intentionally conservative.** It will refuse some legitimate questions.
That is the right trade for a restaurant tool that must never be mistaken for a
doctor or a solicitor — a refusal costs a rephrase, a bad answer costs more. The
refusal text says which words to change rather than just saying no.

**It is a heuristic, not a classifier.** It reduces the blast radius; the system
prompt does the rest of the work. Anyone extending this should assume it can be
worded around and keep the model's own instructions strict too.

Off unless WEB_SEARCH_API_KEY is set, same as every other integration here. The
provider is Serper (a thin API over Google's results) rather than Brave, because
Brave's free tier demands a card and an integration nobody can switch on is not
an integration.
"""
from __future__ import annotations

import asyncio
import logging
import re

from app.core.config import settings

log = logging.getLogger("mise.assistant.web")

# Off-domain areas where a confident wrong answer does real harm. Checked FIRST,
# so no amount of restaurant vocabulary in the same sentence unblocks them.
BLOCKED: dict[str, tuple[str, ...]] = {
    "medical": (
        "symptom", "diagnos", "disease", "medicine", "medication", "dosage",
        "prescription", "treatment", "cancer", "diabetes", "pregnan", "covid",
        "infection", "antibiotic", "vaccine", "therapy", "mental health",
        "depress", "suicide", "doctor", "hospital", "rash", "fever",
    ),
    "legal advice": (
        "sue ", "lawsuit", "solicitor", "attorney", "court case", "prosecut",
        "criminal", "compensation claim", "tribunal", "legal advice",
    ),
    "financial advice": (
        "invest in", "stock market", "share price", "crypto", "bitcoin",
        "trading", "mortgage rate", "pension advice",
    ),
    "politics": ("election", "political party", "vote for", "referendum"),
    "adult or violent content": ("porn", "escort", "weapon", "firearm", "explosive"),
}

# Signals that a question really is about running a food business. One is enough
# — this is a floor, not a description of every valid query.
HOSPITALITY = (
    "restaurant", "hotel", "cafe", "café", "takeaway", "kitchen", "chef", "menu",
    "dish", "recipe", "ingredient", "food", "produce", "grocer", "supplier",
    "vendor", "wholesale", "price of", "cost of", "hospitality", "catering",
    "hygiene", "allergen", "food safety", "fsa", "haccp", "eho", "licens",
    "epos", "pos ", "delivery platform", "deliveroo", "uber eats", "just eat",
    "swiggy", "zomato", "footfall", "covers", "gross profit", "vat", "tips",
    "wage", "minimum wage", "staff", "rota", "shift", "stock", "inventory",
    "spice", "rice", "flour", "oil", "dairy", "meat", "seafood", "vegetable",
    "drink", "beverage", "wine", "beer", "coffee", "tea",
)


class Refused(Exception):
    """Carries a message meant to be shown to the user, not swallowed."""


def allowed(query: str) -> tuple[bool, str]:
    """(ok, reason). Reason is user-facing when ok is False."""
    q = (query or "").strip().lower()
    if len(q) < 3:
        return False, "That search was too short for me to know what to look up."

    for topic, needles in BLOCKED.items():
        for needle in needles:
            if needle in q:
                return False, (
                    f"I can't look up {topic} questions — I'm your restaurant "
                    "assistant, and being confidently wrong about that could hurt "
                    "someone. For anything about running the business, ask away."
                )

    # \b so "cost of" style phrases still match but "chef" does not fire inside
    # an unrelated longer word.
    if not any(re.search(rf"\b{re.escape(sig)}", q) for sig in HOSPITALITY):
        return False, (
            "I only search the web for restaurant and hospitality things — "
            "ingredient prices, suppliers, food-safety rules, what other places "
            "charge. Try naming the food, supplier or part of the business you "
            "mean and I'll look again."
        )
    return True, ""


def configured() -> bool:
    """Either provider is enough — one working index beats none."""
    return bool(
        getattr(settings, "web_search_api_key", "")
        or getattr(settings, "tavily_api_key", "")
    )


async def search(query: str, count: int = 5) -> dict:
    """Run a guarded web search. Never raises; returns a dict the model reads.

    The model is told the source and date of every result so it can attribute
    them, because an unattributed number that came off the internet is
    indistinguishable to the user from one that came out of their own books.
    """
    ok, reason = allowed(query)
    if not ok:
        log.info("web search refused: %s", query[:80], extra={"code": "DINE-A3010"})
        return {"refused": True, "message": reason}

    if not configured():
        return {
            "unavailable": True,
            "message": (
                "Live web search isn't switched on for this account yet. I can "
                "still answer from your own data."
            ),
        }

    results: list[dict] = []
    # Both providers at once. Sequential would double the wait for an assistant
    # that already feels slow; asyncio.gather makes two sources cost the time of
    # the slower one, not the sum. return_exceptions so one provider being down
    # degrades the answer instead of losing it.
    outcomes = await asyncio.gather(
        _serper(query, count),
        _tavily(query, count),
        return_exceptions=True,
    )
    for outcome in outcomes:
        if isinstance(outcome, Exception):
            log.warning("a search provider failed", exc_info=outcome, extra={"code": "DINE-A3011"})
            continue
        results.extend(outcome)

    if not results:
        return {"error": "I couldn't reach the web just now."}

    # Same page from both providers is one fact, not two. Dedupe on the URL and
    # keep the first — otherwise the model sees agreement where there is only
    # repetition, and weights it accordingly.
    seen: set[str] = set()
    merged = []
    for r in results:
        key = (r.get("url") or r.get("title") or "").rstrip("/").lower()
        if key and key in seen:
            continue
        seen.add(key)
        merged.append(r)

    return {
        "query": query,
        "results": merged[: count * 2],
        "note": (
            "These came from the public web, not from this restaurant's records. "
            "Say where a figure came from when you use one, and do not present it "
            "as their own data. Where two sources agree the figure is safer; "
            "where they disagree, say so rather than picking one."
        ),
    }


async def _serper(query: str, count: int) -> list[dict]:
    """Google's index, via serper.dev. Strongest for local and commercial
    queries — "paneer suppliers Birmingham" is a Google question."""
    if not settings.web_search_api_key:
        return []
    import httpx

    async with httpx.AsyncClient(timeout=8) as client:
        resp = await client.post(
            "https://google.serper.dev/search",
            json={"q": query, "num": max(1, min(count, 10)), "gl": "gb"},
            headers={
                "X-API-KEY": settings.web_search_api_key,
                "Content-Type": "application/json",
            },
        )
    if resp.status_code >= 300:
        log.warning("serper http=%s", resp.status_code, extra={"code": "DINE-A3011"})
        return []

    payload = resp.json()
    out: list[dict] = []
    # An answer box, when Google has one, is usually the best single result for
    # a factual question — first, not buried.
    box = payload.get("answerBox") or {}
    if box.get("answer") or box.get("snippet"):
        out.append({
            "title": box.get("title", "Direct answer"),
            "url": box.get("link", ""),
            "summary": (box.get("answer") or box.get("snippet") or "")[:400],
            "age": "",
            "source": "google",
        })
    for r in (payload.get("organic") or [])[:count]:
        out.append({
            "title": r.get("title", ""),
            "url": r.get("link", ""),
            "summary": (r.get("snippet") or "")[:400],
            "age": r.get("date") or "",
            "source": "google",
        })
    return out


async def _tavily(query: str, count: int) -> list[dict]:
    """Tavily — built for feeding models rather than humans, so it returns
    extracted page CONTENT instead of a search snippet. Better on rules and
    guidance ("what does the FSA require"), where the answer is a paragraph
    inside a page rather than the page's title."""
    key = getattr(settings, "tavily_api_key", "")
    if not key:
        return []
    import httpx

    async with httpx.AsyncClient(timeout=8) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            json={
                "api_key": key,
                "query": query,
                "max_results": max(1, min(count, 8)),
                "search_depth": "basic",
                "include_answer": True,
            },
        )
    if resp.status_code >= 300:
        log.warning("tavily http=%s", resp.status_code, extra={"code": "DINE-A3011"})
        return []

    payload = resp.json()
    out: list[dict] = []
    if payload.get("answer"):
        out.append({
            "title": "Summary",
            "url": "",
            "summary": str(payload["answer"])[:400],
            "age": "",
            "source": "tavily",
        })
    for r in (payload.get("results") or [])[:count]:
        out.append({
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "summary": (r.get("content") or "")[:400],
            "age": r.get("published_date") or "",
            "source": "tavily",
        })
    return out


