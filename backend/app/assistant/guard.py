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


async def enforce(db: AsyncSession, user: User, kind: str) -> None:
    """Gate a call. Raises before a single token is spent, never after."""
    if not settings.ai_enabled:
        raise AiDisabled("The AI is switched off right now. Please try again later.")

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
    if settings.ai_hotel_daily_requests > 0:
        today = await db.scalar(
            select(func.count())
            .select_from(AiUsage)
            .where(
                AiUsage.hotel_id == user.hotel_id,
                AiUsage.created_at >= now - timedelta(days=1),
            )
        )
        if (today or 0) >= settings.ai_hotel_daily_requests:
            raise AiQuotaExceeded(
                "You've used today's AI allowance. It resets in a few hours — "
                "or ask your manager to raise the limit."
            )

    # per-hotel monthly tokens — the one that actually tracks money
    if settings.ai_hotel_monthly_tokens > 0:
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        used = await db.scalar(
            select(func.coalesce(func.sum(AiUsage.input_tokens + AiUsage.output_tokens), 0)).where(
                AiUsage.hotel_id == user.hotel_id,
                AiUsage.created_at >= month_start,
            )
        )
        if int(used or 0) >= settings.ai_hotel_monthly_tokens:
            raise AiQuotaExceeded(
                "This month's AI allowance is used up. It resets on the 1st."
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


async def summary(db: AsyncSession, hotel_id) -> dict:
    """What this hotel has spent — drives the Control Room view and the UI's
    'allowance left' hint."""
    now = datetime.now(UTC)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    row = (
        await db.execute(
            select(
                func.count(),
                func.coalesce(func.sum(AiUsage.input_tokens + AiUsage.output_tokens), 0),
                func.coalesce(func.sum(AiUsage.cost_usd), 0),
            ).where(AiUsage.hotel_id == hotel_id, AiUsage.created_at >= month_start)
        )
    ).one()
    today = await db.scalar(
        select(func.count())
        .select_from(AiUsage)
        .where(AiUsage.hotel_id == hotel_id, AiUsage.created_at >= now - timedelta(days=1))
    )
    return {
        "enabled": settings.ai_enabled,
        "month_calls": int(row[0]),
        "month_tokens": int(row[1]),
        "month_cost_usd": str(row[2]),
        "today_calls": int(today or 0),
        "daily_limit": settings.ai_hotel_daily_requests,
        "monthly_token_limit": settings.ai_hotel_monthly_tokens,
    }
