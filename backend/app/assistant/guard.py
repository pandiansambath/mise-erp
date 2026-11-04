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
    # POLLY IS PRICED PER MILLION CHARACTERS, NOT PER TOKEN — which is why it
    # fits this table at all: the arithmetic is the same shape, the unit is
    # different, and `input_tokens` carries characters for these rows. Output is
    # zero because Polly returns audio, and audio is not billed.
    #
    # Generative $30/M, neural $16/M, standard $4/M (eu-west-2, 2026).
    # Longest key first so "polly-generative" cannot be caught by "polly".
    ("polly-generative", Decimal("30.00"), Decimal("0")),
    ("polly-neural", Decimal("16.00"), Decimal("0")),
    ("polly", Decimal("4.00"), Decimal("0")),
]
_FALLBACK = (Decimal("3.00"), Decimal("15.00"))


class AiDisabled(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status.HTTP_503_SERVICE_UNAVAILABLE, detail)


class AiQuotaExceeded(HTTPException):
    def __init__(self, detail: str) -> None:
        super().__init__(status.HTTP_429_TOO_MANY_REQUESTS, detail)


#: PROMPT-CACHE PRICES, as multiples of the model's own input rate. These are
#: the figures `bedrock._cached_system` already states for the 5-minute
#: ("ephemeral") cache we ask for: a WRITE costs 1.25x normal input, a READ
#: 0.1x. Multipliers rather than a second price column, because they hold for
#: every Claude model in `_PRICES` and a per-model table would be one more
#: thing to keep in step when the model changes.
#:
#: Until §43.8 nothing priced these at all — not "priced as plain input", as
#: the checklist guessed, but absent: the meter captured them and `record()`
#: never received them. Polly has no cache, so its rows carry zeros here.
CACHE_WRITE_MULTIPLIER = Decimal("1.25")
CACHE_READ_MULTIPLIER = Decimal("0.10")


def rates_for(model: str) -> tuple[Decimal, Decimal]:
    """(input, output) USD per million tokens for this model string."""
    m = (model or "").lower()
    # LONGEST MATCH WINS. `next()` over declaration order meant the first
    # substring hit won, so "polly-neural" would be priced by whichever of
    # "polly" or "polly-neural" happened to be listed first — a four-times
    # difference decided by line order.
    hits = sorted(
        ((key, i, o) for key, i, o in _PRICES if key in m),
        key=lambda r: -len(r[0]),
    )
    return (hits[0][1], hits[0][2]) if hits else _FALLBACK


def token_weight(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> Decimal:
    """What these tokens cost by OUR price table, unrounded.

    This is the allocation KEY on the money page (§43.8): AWS's billed total is
    split across restaurants in proportion to it. Unrounded on purpose — the
    stored per-row figure is quantised to a millionth of a dollar, which is
    fine for one call and is not fine as the denominator of a split.
    """
    rate_in, rate_out = rates_for(model)
    weighted_in = (
        Decimal(input_tokens or 0)
        + Decimal(cache_write_tokens or 0) * CACHE_WRITE_MULTIPLIER
        + Decimal(cache_read_tokens or 0) * CACHE_READ_MULTIPLIER
    )
    return (weighted_in * rate_in + Decimal(output_tokens or 0) * rate_out) / Decimal(1_000_000)


def estimate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
) -> Decimal:
    """Best-effort cost of one call. Stored per row so spend is attributable.

    An ESTIMATE, and the money page labels it one: it is our price table times
    our token counts, not what AWS charged. The charge is allocated from the
    bill itself — see `platform_admin.costs.ai_cost_by_hotel`.
    """
    return token_weight(
        model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
    ).quantize(Decimal("0.000001"))


def tokens_from(meter: dict | None) -> dict[str, int]:
    """The four token counts a meter carries, as `record()` keyword arguments.

    One helper rather than four `meter.get(...)` lines at every call site,
    because the cache counts were dropped at EVERY call site — they were on
    the meter and nobody passed them on. A new field added here reaches every
    caller at once.
    """
    m = meter or {}
    return {
        "input_tokens": int(m.get("input_tokens") or 0),
        "output_tokens": int(m.get("output_tokens") or 0),
        "cache_read_tokens": int(m.get("cache_read_tokens") or 0),
        "cache_write_tokens": int(m.get("cache_write_tokens") or 0),
    }


async def effective_ai(db: AsyncSession, user: User) -> dict:
    """What the AI may do for THIS person: their own settings over their job's.

    Two layers, and the order is the same one permissions already use, because
    people expect a setting on a person to beat a setting on their job — that is
    what makes an exception an exception.

    Neither layer can widen anything. The plan is the ceiling and it is checked
    where the model is chosen; these settings only ever choose from inside it.
    Storage that nothing reads is not a setting, it is a note — which is what
    these were until now: saved on the person, shown in the UI, and ignored by
    the assistant.
    """
    from app.auth.models import RoleDefault  # local: avoids an import cycle

    # `getattr` rather than `user.role`, because this is reached from the token
    # path AND from the metering path, and the latter is called with whatever
    # stands in for a user at the time. A spend guard that raises is a guard
    # that stops the product working, so it degrades to "no job defaults"
    # instead of to an exception.
    role = getattr(user, "role", None)
    job = (
        (
            await db.execute(
                select(RoleDefault).where(
                    RoleDefault.hotel_id == user.hotel_id,
                    RoleDefault.base_role == role,
                )
            )
        ).scalar_one_or_none()
        if role
        else None
    )

    # Three layers, narrowest last: the built-in job, then the role the hotel
    # invented and assigned, then the person. Each is an exception to the one
    # before it, which is the same order permissions already resolve in.
    out: dict = dict((job.ai_settings or {}) if job else {})

    role_id = getattr(user, "custom_role_id", None)
    if role_id:
        from app.auth.models import CustomRole

        cr = await db.get(CustomRole, role_id)
        if cr is not None:
            out.update(dict(cr.ai_settings or {}))

    out.update(dict(getattr(user, "ai_settings", None) or {}))
    return out


async def model_for(db: AsyncSession, user: User) -> str:
    """The Bedrock model this person gets.

    The PLAN decides what is available; the job or the person may choose
    something cheaper inside that. A hotel on the entry tier asking for Sonnet
    still gets Haiku — a setting must never be a way to buy an upgrade — but a
    hotel on the top tier can put its kitchen porters on Haiku and keep Sonnet
    for the people costing the menu.
    """
    hotel = await db.get(Hotel, user.hotel_id)
    plan = getattr(hotel, "plan", "") or feat.DEFAULT_PLAN
    allowed = feat.plan_model(plan)

    want = (await effective_ai(db, user)).get("model")
    if want == "haiku" and "haiku" not in allowed:
        # Downgrading is always permitted: it can only ever cost less.
        return feat.plan_model("kitchen")
    return allowed


# Roughly four characters per token for English. Crude, but the alternative was
# recording ZERO for every chat turn, which left the monthly meter reading
# "0 of 5,000,000" forever. A limit that can never be reached is worse than an
# approximate one, because nobody can see the wall coming.
CHARS_PER_TOKEN = 4
# The system prompt (persona + knowledge + role context) rides along on every
# call and dwarfs a short question, so ignoring it would under-count badly.
SYSTEM_PROMPT_TOKENS = 900
# A typical question + answer, used to turn "tokens left" into "messages left".
_TYPICAL_TURN_TOKENS = 1400


def estimate_tokens(text: str) -> int:
    return max(1, len(text or "") // CHARS_PER_TOKEN)


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
    # An operator can lift one hotel above its plan (a pilot, a complaint, our
    # own test accounts) without inventing a new plan for them.
    daily = getattr(hotel, "ai_daily_override", None) or daily
    monthly = getattr(hotel, "ai_monthly_override", None) or monthly
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
        "comes with Pro. Want to see what else it adds?"
    ),
    "ai_insights": (
        "Daily insights aren't part of {plan}. Pro spots what changed "
        "overnight and tells you before it costs you."
    ),
    "ai_copilot": (
        "Chat isn't part of your {plan} plan yet — every paid plan includes it."
    ),
}


#: Rows in the ledger that are not somebody on the team using their allowance.
#: A diner's question and the speech half of a voice turn are recorded so the
#: bill can be split honestly, but neither ever counted against a limit, and
#: writing them down must not start to (43.8 review).
_NOT_AN_ALLOWANCE = ("guest", "speech")


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
                AiUsage.kind.notin_(_NOT_AN_ALLOWANCE),
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
                AiUsage.kind.notin_(_NOT_AN_ALLOWANCE),
            )
        )
        if int(used or 0) >= monthly_cap:
            raise AiQuotaExceeded(
                f"This month's AI allowance is used up on {plan_label}. "
                "It resets on the 1st — or upgrade for a bigger allowance."
            )


async def record(
    db: AsyncSession,
    user: User | None,
    *,
    kind: str,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    cache_read_tokens: int = 0,
    cache_write_tokens: int = 0,
    latency_ms: int = 0,
    ok: bool = True,
    hotel_id=None,
) -> None:
    """Log one call. Never raises — a failed ledger write must not fail the
    user's request, but it IS logged loudly because it blinds the limiter.

    `hotel_id` overrides whose row this is. Only the Control Room uses it: an
    operator is always signed in as a user of SOME hotel, and the operator's AI
    landing on that hotel is the same mistake as its page loads landing there
    (PROJECT_MAP §4, "An operator is a user of some hotel").

    `user` is None for a DINER asking about a dish on the table page — nobody
    is signed in, and the row is charged to `hotel_id`. Unrecorded, those calls
    were spread over every restaurant by the reconciliation (43.8 review)."""
    owner = hotel_id or (user.hotel_id if user else None)
    if owner is None:
        log.error("AI usage with no owner (kind=%s) — not recorded", kind)
        return
    try:
        db.add(
            AiUsage(
                hotel_id=owner,
                user_id=user.id if user else None,
                user_email=(user.email or "") if user else "",
                kind=kind[:20],
                model=(model or "")[:80],
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cache_read_tokens=cache_read_tokens,
                cache_write_tokens=cache_write_tokens,
                cost_usd=estimate_cost(
                    model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
                ),
                latency_ms=latency_ms,
                ok=ok,
            )
        )
        await db.commit()
    except Exception:  # noqa: BLE001 — logging must never break the feature
        log.exception("could not record AI usage (hotel=%s kind=%s)", owner, kind)
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
        # What's LEFT, and what that actually buys. A token count means nothing
        # to a restaurant owner; "about 190 more questions" does.
        "calls_left": max(0, daily_cap - int(today or 0)) if daily_cap else None,
        "tokens_left": max(0, monthly_cap - int(row[1])) if monthly_cap else None,
        "est_messages_left": (
            min(
                (max(0, daily_cap - int(today or 0)) if daily_cap else 10**9),
                (
                    max(0, monthly_cap - int(row[1])) // _TYPICAL_TURN_TOKENS
                    if monthly_cap
                    else 10**9
                ),
            )
            if (daily_cap or monthly_cap)
            else None
        ),
        "model": await model_for(db, user),
        "daily_limit": daily_cap,
        "monthly_token_limit": monthly_cap,
        "included": daily_cap > 0 or monthly_cap > 0,
    }
