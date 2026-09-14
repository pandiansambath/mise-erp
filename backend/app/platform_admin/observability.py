"""What the platform is doing, and what each restaurant is doing on it.

    "we need observability feature too, like monitoring dashboard for entire
     project — I don't know how to say but yeah we need."
    "we can also see each hotel's logs too, literally everything that hotel is
     doing... literally each and every chat that hotel is making with hotel's
     AI, so that if any issue means we can easily check and solve."

None of this needed new collection. The data has been accumulating for months
and nothing has ever looked at it:

  · `ai_usage` — one row per AI call with cost, tokens, latency, model and an
    ok flag, indexed on hotel and date. Its only reader was the operator AI's
    own hidden prompt. Nobody could see who was spending the Bedrock budget.
  · `audit_events` — every consequential action in every tenant, with the
    actor's email. The operator could read `platform.%` and nothing else, so
    "who changed this price?" was unanswerable from the console.
  · `assistant_messages` — complete AI conversations, bodies and all.
  · `hotels.subscription_status` / `trial_ends_on` — who is on trial and whose
    trial ends on Friday. Never surfaced anywhere.

ON READING OTHER PEOPLE'S CONVERSATIONS
`assistant/query.py` deliberately excludes `assistant_messages` from what the
operator AI may read, and the system prompt tells it not to work around that.
That was the right default and this module does NOT change it — the AI still
cannot see them. What it adds is a deliberate, narrow, human path: an operator
who is handling a support case can open one hotel's transcripts, and the act of
doing so is written to the audit log under their name. The distinction that
matters is between a model trawling everybody's private messages to answer a
question, and a named person opening one conversation because a customer rang
up about it.

WHY THESE ARE READ-ONLY AGGREGATES
Every function here SELECTs. A monitoring surface that can also change things
is a monitoring surface people are afraid to click around in, and the whole
value of it is that somebody looks often.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import Integer, and_, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant.models import AiUsage, AssistantMessage, AssistantThread
from app.audit.models import AuditEvent
from app.auth.models import User
from app.hotels.models import Hotel


def _since(days: int) -> datetime:
    return datetime.now(UTC) - timedelta(days=days)


async def platform_pulse(db: AsyncSession, days: int = 30) -> dict:
    """The one screen an operator should be able to read in five seconds.

    Deliberately a small number of large facts. A dashboard that opens with
    forty tiles gets skimmed and then ignored; the job here is to answer "is
    anything wrong right now" before it answers anything else.
    """
    since = _since(days)
    yesterday = _since(1)

    # ── AI: the only line with no ceiling ────────────────────────────────
    ai = (
        await db.execute(
            select(
                func.count(AiUsage.id),
                func.coalesce(func.sum(AiUsage.cost_usd), 0),
                func.coalesce(func.sum(AiUsage.input_tokens + AiUsage.output_tokens), 0),
                func.coalesce(func.avg(AiUsage.latency_ms), 0),
                func.coalesce(
                    func.sum(cast(case((AiUsage.ok.is_(False), 1), else_=0), Integer)), 0
                ),
            ).where(AiUsage.created_at >= since)
        )
    ).one()
    ai_24h_cost = (
        await db.scalar(
            select(func.coalesce(func.sum(AiUsage.cost_usd), 0)).where(
                AiUsage.created_at >= yesterday
            )
        )
    ) or Decimal("0")

    # ── Tenants ──────────────────────────────────────────────────────────
    hotels = (
        await db.execute(
            select(
                func.count(Hotel.id),
                func.coalesce(
                    func.sum(cast(case((Hotel.is_active.is_(True), 1), else_=0), Integer)), 0
                ),
                func.coalesce(
                    func.sum(
                        cast(case((Hotel.subscription_status == "trialing", 1), else_=0), Integer)
                    ),
                    0,
                ),
                func.coalesce(
                    func.sum(
                        cast(case((Hotel.subscription_status == "past_due", 1), else_=0), Integer)
                    ),
                    0,
                ),
            )
        )
    ).one()

    # Trials about to lapse — the one time-critical thing on this screen.
    soon = date.today() + timedelta(days=7)
    ending = (
        await db.execute(
            select(Hotel.id, Hotel.name, Hotel.username, Hotel.trial_ends_on)
            .where(
                Hotel.trial_ends_on.is_not(None),
                Hotel.trial_ends_on <= soon,
                Hotel.is_active.is_(True),
            )
            .order_by(Hotel.trial_ends_on)
            .limit(10)
        )
    ).all()

    # ── Activity ─────────────────────────────────────────────────────────
    actions = await db.scalar(
        select(func.count(AuditEvent.id)).where(AuditEvent.created_at >= since)
    )
    logins = await db.scalar(
        select(func.count(User.id)).where(User.last_login >= since)
    )

    calls, cost, tokens, latency, failures = ai
    return {
        "window_days": days,
        "ai": {
            "calls": int(calls or 0),
            "cost_usd": float(cost or 0),
            "cost_usd_24h": float(ai_24h_cost or 0),
            "tokens": int(tokens or 0),
            "avg_latency_ms": int(latency or 0),
            "failures": int(failures or 0),
            # The number that decides whether anyone trusts the assistant.
            "failure_rate": round(float(failures or 0) / float(calls), 4) if calls else 0.0,
        },
        "tenants": {
            "total": int(hotels[0] or 0),
            "active": int(hotels[1] or 0),
            "trialing": int(hotels[2] or 0),
            "past_due": int(hotels[3] or 0),
            "trials_ending": [
                {
                    "id": str(h.id),
                    "name": h.name,
                    "handle": h.username,
                    "ends_on": h.trial_ends_on.isoformat() if h.trial_ends_on else None,
                }
                for h in ending
            ],
        },
        "activity": {
            "actions": int(actions or 0),
            "users_seen": int(logins or 0),
        },
    }


async def ai_by_hotel(db: AsyncSession, days: int = 30, limit: int = 50) -> list[dict]:
    """Who is spending the AI budget.

    The single most obviously-missing view: the table has been recording cost
    per hotel since the day Bedrock went live and there has never been a way to
    read it. Sorted by spend, because the question is always "who is at the
    top".
    """
    since = _since(days)
    rows = (
        await db.execute(
            select(
                AiUsage.hotel_id,
                Hotel.name,
                Hotel.username,
                func.count(AiUsage.id).label("calls"),
                func.coalesce(func.sum(AiUsage.cost_usd), 0).label("cost"),
                func.coalesce(func.sum(AiUsage.input_tokens + AiUsage.output_tokens), 0),
                func.coalesce(func.avg(AiUsage.latency_ms), 0),
                func.coalesce(
                    func.sum(cast(case((AiUsage.ok.is_(False), 1), else_=0), Integer)), 0
                ),
                func.max(AiUsage.created_at),
            )
            .join(Hotel, Hotel.id == AiUsage.hotel_id, isouter=True)
            .where(AiUsage.created_at >= since)
            .group_by(AiUsage.hotel_id, Hotel.name, Hotel.username)
            .order_by(func.coalesce(func.sum(AiUsage.cost_usd), 0).desc())
            .limit(limit)
        )
    ).all()
    return [
        {
            "hotel_id": str(r[0]),
            # A hotel that has since been deleted still has usage rows; say so
            # rather than rendering a blank name and looking broken.
            "name": r[1] or "(deleted restaurant)",
            "handle": r[2],
            "calls": int(r[3] or 0),
            "cost_usd": float(r[4] or 0),
            "tokens": int(r[5] or 0),
            "avg_latency_ms": int(r[6] or 0),
            "failures": int(r[7] or 0),
            "last_used": r[8].isoformat() if r[8] else None,
        }
        for r in rows
    ]


async def ai_daily(
    db: AsyncSession, days: int = 30, hotel_id: uuid.UUID | None = None
) -> list[dict]:
    """Spend per day, for the sparkline. Optionally one hotel."""
    since = _since(days)
    day = func.date_trunc("day", AiUsage.created_at).label("day")
    q = (
        select(
            day,
            func.count(AiUsage.id),
            func.coalesce(func.sum(AiUsage.cost_usd), 0),
        )
        .where(AiUsage.created_at >= since)
        .group_by(day)
        .order_by(day)
    )
    if hotel_id is not None:
        q = q.where(AiUsage.hotel_id == hotel_id)
    rows = (await db.execute(q)).all()
    return [
        {"day": r[0].date().isoformat(), "calls": int(r[1] or 0), "cost_usd": float(r[2] or 0)}
        for r in rows
    ]


async def hotel_activity(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    limit: int = 200,
    before: datetime | None = None,
) -> list[dict]:
    """One restaurant's actions, newest first.

        "we can also see each hotel's logs too, literally everything that hotel
         is doing."

    `audit_events` already records this for every tenant — it was simply
    unreadable from the operator side, which only ever queried `platform.%`.
    Paged by timestamp rather than OFFSET so a busy tenant's history stays
    cheap to walk.
    """
    q = (
        select(AuditEvent)
        .where(AuditEvent.hotel_id == hotel_id)
        .order_by(AuditEvent.created_at.desc())
        .limit(min(limit, 500))
    )
    if before is not None:
        q = q.where(AuditEvent.created_at < before)
    rows = (await db.execute(q)).scalars().all()
    return [
        {
            "id": str(e.id),
            "action": e.action,
            "summary": e.summary,
            "who": e.user_email or "—",
            "entity_type": e.entity_type,
            "entity_id": str(e.entity_id) if e.entity_id else None,
            "at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in rows
    ]


async def hotel_ai_threads(db: AsyncSession, hotel_id: uuid.UUID, limit: int = 50) -> list[dict]:
    """The AI conversations this restaurant has had — titles only.

    Deliberately two steps: a list of threads, then the messages of one. It
    keeps the expensive read explicit, and it means the audit line an operator
    generates says WHICH conversation they opened rather than "they looked at
    everything".
    """
    rows = (
        await db.execute(
            select(
                AssistantThread.id,
                AssistantThread.title,
                AssistantThread.created_at,
                AssistantThread.updated_at,
                func.count(AssistantMessage.id),
            )
            .join(AssistantMessage, AssistantMessage.thread_id == AssistantThread.id, isouter=True)
            .where(AssistantThread.hotel_id == hotel_id)
            .group_by(
                AssistantThread.id,
                AssistantThread.title,
                AssistantThread.created_at,
                AssistantThread.updated_at,
            )
            .order_by(AssistantThread.updated_at.desc().nullslast())
            .limit(min(limit, 200))
        )
    ).all()
    return [
        {
            "id": str(r[0]),
            "title": r[1] or "Untitled",
            "started": r[2].isoformat() if r[2] else None,
            "last": r[3].isoformat() if r[3] else None,
            "messages": int(r[4] or 0),
        }
        for r in rows
    ]


async def hotel_ai_messages(
    db: AsyncSession, hotel_id: uuid.UUID, thread_id: uuid.UUID
) -> list[dict]:
    """One conversation, in full.

        "literally each and every chat that hotel is making with hotel's AI, so
         that if any issue means we can easily check and solve."

    Scoped by hotel AND thread so an id from one tenant cannot be used to read
    another's. The caller writes the audit line — see the endpoint.
    """
    rows = (
        await db.execute(
            select(AssistantMessage)
            .where(
                and_(
                    AssistantMessage.hotel_id == hotel_id,
                    AssistantMessage.thread_id == thread_id,
                )
            )
            .order_by(AssistantMessage.created_at)
        )
    ).scalars().all()
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in rows
    ]


async def hotel_health(db: AsyncSession, hotel_id: uuid.UUID, days: int = 30) -> dict:
    """One restaurant's vital signs, for the top of its page."""
    since = _since(days)
    ai = (
        await db.execute(
            select(
                func.count(AiUsage.id),
                func.coalesce(func.sum(AiUsage.cost_usd), 0),
                func.coalesce(
                    func.sum(cast(case((AiUsage.ok.is_(False), 1), else_=0), Integer)), 0
                ),
            ).where(AiUsage.hotel_id == hotel_id, AiUsage.created_at >= since)
        )
    ).one()
    actions = await db.scalar(
        select(func.count(AuditEvent.id)).where(
            AuditEvent.hotel_id == hotel_id, AuditEvent.created_at >= since
        )
    )
    threads = await db.scalar(
        select(func.count(AssistantThread.id)).where(AssistantThread.hotel_id == hotel_id)
    )
    last_seen = await db.scalar(
        select(func.max(User.last_login)).where(User.hotel_id == hotel_id)
    )
    return {
        "window_days": days,
        "ai_calls": int(ai[0] or 0),
        "ai_cost_usd": float(ai[1] or 0),
        "ai_failures": int(ai[2] or 0),
        "actions": int(actions or 0),
        "ai_threads": int(threads or 0),
        "last_seen": last_seen.isoformat() if last_seen else None,
    }
