"""Spend + abuse controls for every AI entry point.

Every call must answer three questions before it reaches Bedrock:

  1. who is this?          — hotel + user, always known (auth is upstream)
  2. are they in budget?   — per-hotel daily requests, per-hotel monthly tokens
  3. is the payload bounded? — max_tokens and upload size, enforced at the edge

Anything that fails gets a friendly 429 rather than a silent bill. The counters
read from `ai_usage`, so the ledger and the limiter can never drift apart.

Limits are settings, not constants: raising a hotel's allowance (or pulling the
global kill switch) is an env var and a restart, never a deploy.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant.models import AiUsage
from app.auth.models import User
from app.core.config import settings
from app.hotels.models import Hotel
from app.platform_admin import features as feat

log = logging.getLogger("mise.ai.guard")

# USD per 1M tokens. Matched by substring so inference-profile prefixes
# ("eu.", "global.") and version suffixes don't need a new entry each time.
_PRICES: list[tuple[str, Decimal, Decimal]] = [
    ("haiku", Decimal("0.80"), Decimal("4.00")),
    ("sonnet-5", Decimal("2.00"), Decimal("10.00")),
    ("sonnet", Decimal("3.00"), Decimal("15.00")),
    ("opus", Decimal("15.00"), Decimal("75.00")),
]
_FALLBACK = (Decimal("3.00"), Decimal("15.00"))


class AiDisabled(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status.HTTP_503_SERVICE_UNAVAILABLE, detail)


class AiQuotaExceeded(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status.HTTP_429_TOO_MANY_REQUESTS, detail)


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> Decimal:
    """Best-effort cost of one call. Stored per row so spend is attributable."""
    m = (model or "").lower()
    rates = next(((i, o) for key, i, o in _PRICES if key in m), _FALLBACK)
    million = Decimal(1_000_000)
    cost = (Decimal(input_tokens) * rates[0] + Decimal(output_tokens) * rates[1]) / million
    return cost.quantize(Decimal("0.000001"))


async def model_for(db: AsyncSession, user: User) -> str:
    """The Bedrock model this hotel's plan entitles it to."""
    hotel = await db.get(Hotel, user.hotel_id)
    return feat.plan_model(getattr(hotel, "plan", "") or feat.DEFAULT_PLAN)


async def _limits(db: AsyncSession, user: User) -> tuple[int, int, str]:
    """(daily requests, monthly tokens, plan label) for this hotel.

    The plan is the paywall: AI is the only metered feature, so its allowance is
    a property of what the hotel bought, not a global env var. The env settings
    remain as a ceiling — a plan can never grant more than the platform allows,
    which is what stops a Control Room mistake becoming a bill.
    """
    hotel = await db.get(Hotel, user.hotel_id)
    plan_key = getattr(hotel, "plan", "") or feat.DEFAULT_PLAN
    daily, monthly = feat.plan_ai_limits(plan_key)
    plan = feat.get_plan(plan_key)
    label = plan.label if plan else plan_key.title()
    return (
        min(daily, settings.ai_hotel_daily_requests) if settings.ai_hotel_daily_requests else daily,
        min(monthly, settings.ai_hotel_monthly_tokens)
        if settings.ai_hotel_monthly_tokens
        else monthly,
        label,
    )


# What each AI feature is worth saying when a plan doesn't include it. The
# assistant answers with these in-character, because a refusal that explains the
# upgrade is marketing; a bare 403 is just a dead end.
_UPSELL = {
    "ai_scan": (
        "I can't read photos on {plan} — bill and handwritten-recipe scanning "
        "comes with Service. Want to see what else it adds?"
    ),
    "ai_insights": (
        "Daily insights aren't part of {plan}. Service spots what changed "
        "overnight and tells you before it costs you."
    ),
    "ai_copilot": (
        "Chat isn't part of your {plan} plan yet — every paid plan includes it."
    ),
}


async def enforce(
    db: AsyncSession, user: User, kind: str, *, feature: str = "ai_copilot"
) -> None:
    """Gate a call. Raises before a single token is spent, never after.

    `feature` is the specific AI capability being used, because the plans slice
    AI finely: Kitchen has chat but not scanning, so "does this hotel have AI"
    is the wrong question to ask.
    """
    if not settings.ai_enabled:
        raise AiDisabled("The AI is switched off right now. Please try again later.")

    daily_cap, monthly_cap, plan_label = await _limits(db, user)

    hotel = await db.get(Hotel, user.hotel_id)
    if hotel is not None and not hotel.feature_on(feature):
        raise AiQuotaExceeded(_UPSELL.get(feature, "That's not part of your plan.").format(
            plan=plan_label
        ))

    if daily_cap <= 0 and monthly_cap <= 0:
        raise AiQuotaExceeded(
            f"AI isn't part of your {plan_label} plan. Upgrade to add the "
            "assistant and bill scanning."
        )

    now = datetime.now(UTC)

    # per-user rate limit — catches a stuck client or a retry storm first,
    # because it's the cheapest failure and the most likely accident
    if settings.ai_user_per_minute > 0:
        recent = await db.scalar(
            select(func.count())
            .select_from(AiUsage)
            .where(
                AiUsage.user_id == user.id,
                AiUsage.created_at >= now - timedelta(minutes=1),
            )
        )
        if (recent or 0) >= settings.ai_user_per_minute:
            raise AiQuotaExceeded("You're going a bit fast for me — give me a few seconds.")

    # per-hotel daily requests
    if daily_cap > 0:
        today = await db.scalar(
            select(func.count())
            .select_from(AiUsage)
            .where(
                AiUsage.hotel_id == user.hotel_id,
                AiUsage.created_at >= now - timedelta(days=1),
            )
        )
        if (today or 0) >= daily_cap:
            raise AiQuotaExceeded(
                f"You've used today's AI allowance ({daily_cap} on {plan_label}). "
                "It resets in a few hours — or upgrade for a bigger allowance."
            )

    # per-hotel monthly tokens — the one that actually tracks money
    if monthly_cap > 0:
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        used = await db.scalar(
            select(func.coalesce(func.sum(AiUsage.input_tokens + AiUsage.output_tokens), 0)).where(
                AiUsage.hotel_id == user.hotel_id,
                AiUsage.created_at >= month_start,
            )
        )
        if int(used or 0) >= monthly_cap:
            raise AiQuotaExceeded(
                f"This month's AI allowance is used up on {plan_label}. "
                "It resets on the 1st — or upgrade for a bigger allowance."
            )


async def record(
    db: AsyncSession,
    user: User,
    *,
    kind: str,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    latency_ms: int = 0,
    ok: bool = True,
) -> None:
    """Log one call. Never raises — a failed ledger write must not fail the
    user's request, but it IS logged loudly because it blinds the limiter."""
    try:
        db.add(
            AiUsage(
                hotel_id=user.hotel_id,
                user_id=user.id,
                user_email=user.email or "",
                kind=kind[:20],
                model=(model or "")[:80],
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost_usd=estimate_cost(model, input_tokens, output_tokens),
                latency_ms=latency_ms,
                ok=ok,
            )
        )
        await db.commit()
    except Exception:  # noqa: BLE001 — logging must never break the feature
        log.exception("could not record AI usage (hotel=%s kind=%s)", user.hotel_id, kind)
        await db.rollback()


async def summary(db: AsyncSession, user: User) -> dict:
    """What this hotel has spent — drives the Control Room view and the UI's
    'allowance left' hint."""
    now = datetime.now(UTC)
    daily_cap, monthly_cap, plan_label = await _limits(db, user)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    row = (
        await db.execute(
            select(
                func.count(),
                func.coalesce(func.sum(AiUsage.input_tokens + AiUsage.output_tokens), 0),
                func.coalesce(func.sum(AiUsage.cost_usd), 0),
            ).where(AiUsage.hotel_id == user.hotel_id, AiUsage.created_at >= month_start)
        )
    ).one()
    today = await db.scalar(
        select(func.count())
        .select_from(AiUsage)
        .where(AiUsage.hotel_id == user.hotel_id, AiUsage.created_at >= now - timedelta(days=1))
    )
    return {
        "enabled": settings.ai_enabled,
        "month_calls": int(row[0]),
        "month_tokens": int(row[1]),
        "month_cost_usd": str(row[2]),
        "today_calls": int(today or 0),
        "plan": plan_label,
        "model": await model_for(db, user),
        "daily_limit": daily_cap,
        "monthly_token_limit": monthly_cap,
        "included": daily_cap > 0 or monthly_cap > 0,
    }
