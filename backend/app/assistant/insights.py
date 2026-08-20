"""Daily insights — "here's how to make today better".

The `ai_insights` feature was priced into Pro and Enterprise before it existed.
This is it.

Two things shape the design:

* **Cost.** A dashboard that called the AI on every page load would be the most
  expensive screen in the product. Insights are generated at most ONCE PER DAY
  per hotel and cached; every other view of the dashboard is free.
* **Trust.** The model is given real figures and told never to invent one. An
  insight that quotes a number the owner can't reconcile destroys confidence in
  every other number we show.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import bedrock, guard, tools
from app.auth.models import User

log = logging.getLogger("mise.assistant.insights")

# hotel_id -> (date generated, payload). One box, one container, so a process
# cache is genuinely enough here; it just means a restart re-generates once.
_CACHE: dict[str, tuple[date, list[dict]]] = {}

#: What symbol to write, per supported currency. The briefing used to be handed
#: bare numbers with no currency named at all, so the model picked its own - a
#: UK restaurant was told on its own dashboard that it was "losing roughly 15x
#: every dirham earned". Every figure on that card was right; the word was not,
#: and one wrong word costs the whole card its credibility.
_SYMBOLS = {"GBP": "GBP (write it as £)", "EUR": "EUR (write it as €)",
            "USD": "USD (write it as $)", "INR": "INR (write it as ₹)",
            "AED": "AED (write it as AED)"}


def _symbol(hotel) -> str:
    code = (getattr(hotel, "base_currency", None) or "GBP").upper()
    return _SYMBOLS.get(code, code)


_SYSTEM = """You are the daily briefing inside a restaurant's management system.

You are given TODAY'S REAL FIGURES for one restaurant. Write at most three short
observations that would actually change what the owner does today.

Rules:
- NEVER invent a number. Use only figures you were given. If the data is thin,
  say so and give fewer observations - one honest line beats three padded ones.
- Lead with money or risk. "Six items are below their reorder level, including
  two you use daily" beats "consider reviewing stock".
- Be specific and short. One sentence of observation, one of what to do.
- Do not greet, sign off, or explain that you are an AI.
- MONEY IS IN THE CURRENCY YOU ARE TOLD AT THE TOP, and no other. The
  figures arrive as bare numbers; write them with that symbol. Never name a
  different currency - a British restaurant told it is losing dirhams stops
  trusting every other number on the page, and it is right to.

Reply with JSON only:
{"insights":[{"title": string, "detail": string, "severity": "info"|"watch"|"act",
"href": string|null}]}

`href` is an in-app link when there is an obvious next screen (/inventory,
/purchasing, /price-comparison, /reports, /waste), otherwise null."""


async def _facts(db: AsyncSession, user: User) -> dict[str, Any]:
    """Everything the briefing is allowed to reason about, scoped to this hotel
    and to what this user may see."""
    facts: dict[str, Any] = {}
    for name, fn in (
        ("overview", tools.business_overview),
        ("low_stock", tools.low_stock),
        ("money", tools.money_snapshot),
    ):
        try:
            facts[name] = await fn(db, user, {})
        except Exception:  # noqa: BLE001 — a missing section must not kill the briefing
            log.warning("insights: %s unavailable", name, exc_info=True)
    return facts


async def daily(db: AsyncSession, user: User, *, force: bool = False) -> dict:
    """Today's briefing. Cached per hotel per day, so opening the dashboard
    repeatedly costs nothing."""
    key = str(user.hotel_id)
    from app.core.timezones import hotel_today
    from app.hotels.models import Hotel as _Hotel

    # Cached per hotel per LOCAL day, so the briefing refreshes at the
    # restaurant's midnight rather than the server's.
    hotel = await db.get(_Hotel, user.hotel_id)
    today = hotel_today(hotel)
    if not force:
        hit = _CACHE.get(key)
        if hit and hit[0] == today:
            return {"date": str(today), "insights": hit[1], "cached": True}

    facts = await _facts(db, user)
    # Nothing to say is a valid answer — don't spend a call proving it.
    if not facts.get("overview") and not facts.get("low_stock"):
        return {"date": str(today), "insights": [], "cached": False}

    await guard.enforce(db, user, "insights", feature="ai_insights")

    meter: dict = {}
    try:
        raw = bedrock._invoke(
            {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 700,
                "system": bedrock._cached_system(_SYSTEM),
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": (
                                    f"CURRENCY: {_symbol(hotel)} "
                                    "- every figure below is in it.\n\n"
                                    "TODAY'S FIGURES:\n"
                                    + json.dumps(facts, default=str)
                                ),
                            }
                        ],
                    }
                ],
            },
            meter,
            await guard.model_for(db, user),
        )
        data = bedrock._json_from(raw)
    except bedrock.BedrockUnavailable as exc:
        log.info("insights unavailable: %s", exc)
        return {"date": str(today), "insights": [], "unavailable": True}

    await guard.record(
        db, user, kind="insights",
        model=meter.get("model", ""),
        input_tokens=meter.get("input_tokens", 0),
        output_tokens=meter.get("output_tokens", 0),
    )

    insights = [
        {
            "title": str(i.get("title", ""))[:120],
            "detail": str(i.get("detail", ""))[:400],
            "severity": (
                i.get("severity") if i.get("severity") in ("info", "watch", "act") else "info"
            ),
            "href": i.get("href") or None,
        }
        for i in (data.get("insights") or [])[:3]
        if i.get("title")
    ]
    _CACHE[key] = (today, insights)
    return {"date": str(today), "insights": insights, "cached": False}
