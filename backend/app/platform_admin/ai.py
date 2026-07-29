"""The Control Room's own assistant — the ONE that sees across hotels.

Every other AI surface in DineAI is deliberately confined to a single
restaurant: a hotel's Copilot must never learn that another hotel exists. This
one is the exception, and it is the exception precisely because it answers to
the platform operator rather than to a tenant.

Two things keep that safe:

* It is gated on `require_platform_owner`, the same flag that guards the rest of
  the Control Room. A hotel user cannot reach it at all.
* It sees AGGREGATES and metadata — plan, status, usage, counts — never a
  restaurant's actual recipes, prices, sales or staff records. The operator
  needs to know a hotel is struggling or overspending; they have no business
  reading its costings.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant import bedrock
from app.assistant.models import AiUsage
from app.auth.models import User
from app.hotels.models import Hotel
from app.platform_admin import features as feat

log = logging.getLogger("mise.platform.ai")

_SYSTEM = """You are the DineAI operator's assistant, inside the Control Room.

You work for the person who RUNS the DineAI platform, not for any one
restaurant. You see every hotel's plan, subscription state and AI usage.

What you must never do:
- Never reveal or speculate about a restaurant's own operational data — their
  recipes, prices, sales, staff or customers. You are not given it, and you must
  not guess at it. The operator's job is the platform, not their tenants' books.
- Never invent a number. Everything you say comes from the figures below.

How to be useful: lead with what needs attention — a lapsed subscription, a
hotel burning AI far above its plan, a trial about to end without converting,
somewhere quiet enough to be at risk of churning. Be brief and specific, and say
what you would do about it."""


async def _facts(db: AsyncSession) -> dict:
    """Platform-level aggregates only. Deliberately no tenant content."""
    hotels = (await db.execute(select(Hotel))).scalars().all()

    by_plan: dict[str, int] = {}
    by_status: dict[str, int] = {}
    comped = 0
    for h in hotels:
        plan = feat.canonical_plan(getattr(h, "plan", "") or "")
        by_plan[plan] = by_plan.get(plan, 0) + 1
        st = (getattr(h, "subscription_status", "") or "free").lower()
        by_status[st] = by_status.get(st, 0) + 1
        if getattr(h, "is_comp", False):
            comped += 1

    # AI spend per hotel this month — the operator's main cost signal.
    rows = (
        await db.execute(
            select(
                AiUsage.hotel_id,
                func.count(),
                func.coalesce(func.sum(AiUsage.input_tokens + AiUsage.output_tokens), 0),
                func.coalesce(func.sum(AiUsage.cost_usd), 0),
            ).group_by(AiUsage.hotel_id)
        )
    ).all()
    names = {h.id: h.name for h in hotels}
    usage = [
        {
            "hotel": names.get(r[0], "unknown"),
            "calls": int(r[1]),
            "tokens": int(r[2]),
            "cost_usd": float(r[3]),
        }
        for r in sorted(rows, key=lambda r: -float(r[3]))[:15]
    ]

    return {
        "hotel_count": len(hotels),
        "comped_hotels": comped,
        "by_plan": by_plan,
        "by_subscription_status": by_status,
        "top_ai_spend_this_period": usage,
        "plans": {
            p.key: {"price": p.price_hint, "ai_per_day": p.ai_daily_requests} for p in feat.PLANS
        },
    }


async def ask(db: AsyncSession, user: User, question: str) -> str:
    """Answer an operator question. Caller must already have checked the flag."""
    if not getattr(user, "is_platform_owner", False):
        # Defence in depth: the router guards this, but a cross-tenant assistant
        # is not something to leave protected by one check.
        raise PermissionError("Control Room AI is for platform operators only")

    facts = await _facts(db)
    return bedrock.ask(
        question,
        hotel_name="the DineAI platform",
        context=json.dumps(facts, default=str)[:12000],
        system_extra=_SYSTEM,
    ).strip()
