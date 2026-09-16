"""The read side of the money dashboard.

    "litrelly when i eneter i need ot know 'oh ths is the amount' fine"

EVERY FIGURE CARRIES ITS OWN FRESHNESS, because two very different kinds of
number sit on this page:

    MEASURED  what WE record — requests, DB reads and writes, AI calls with
              their real cost. Live to the second.
    BILLED    what AWS says. Hours behind, and expensive to ask for: Cost
              Explorer charges $0.01 per request. A page polling it every few
              seconds would cost about $170/month to watch a $35 bill.

He asked for "live", and half of it cannot be. The answer is not to refuse; it
is to mark each number with which half it came from, so a reader can see at a
glance rather than guess. A figure whose freshness you cannot see is worse than
no figure.

THE ONE DANGEROUS FAILURE of this page is rendering $0.00 where it means "we do
not know" — indistinguishable from success. So every "no data" path returns
None and a reason, never a zero.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import usage as usage_mod
from app.platform_admin.cost_map import DIRECT, PLATFORM, SHARED, classify, shared_kind
from app.platform_admin.models import CloudCostDaily, TelemetrySync, UsageDaily

MEASURED = "measured"
#: A reading taken from the source RIGHT NOW, as opposed to one we recorded
#: ourselves (MEASURED) or one AWS settled hours ago (BILLED). The credit
#: balance is the only one of these: free to read, current to the second, and
#: nobody's estimate. Must match `SourceKind` in `components/controlroom/
#: Source.tsx` — the chip is rendered straight from this string.
LIVE = "live"
BILLED = "billed"
ESTIMATE = "estimate"
ENTERED = "entered_by_hand"


def envelope(
    value: Any,
    kind: str,
    *,
    as_of: datetime | None = None,
    source: str = "",
    **extra: Any,
) -> dict:
    """Every number on the page ships in this shape.

    The UI renders the chip from `kind` generically — one component, not a
    label per tile that somebody has to keep in step.
    """
    out = {"value": value, "kind": kind, "source": source}
    if as_of is not None:
        out["as_of"] = as_of.isoformat()
        out["stale_seconds"] = int((datetime.now(UTC) - as_of).total_seconds())
    out.update(extra)
    return out


# ── the measured half ─────────────────────────────────────────────────────


async def measured(
    db: AsyncSession, *, start: date, end: date, include_live: bool = True
) -> dict:
    """Requests, DB reads/writes and time, per hotel and in total.

    `include_live` composes the un-flushed in-memory delta on top of the stored
    rows, which is what makes "today" current to the second rather than to the
    last five-minute flush.
    """
    rows = (
        await db.execute(
            select(
                UsageDaily.hotel_id,
                func.sum(UsageDaily.requests),
                func.sum(UsageDaily.errors_4xx),
                func.sum(UsageDaily.errors_5xx),
                func.sum(UsageDaily.duration_ms),
                func.sum(UsageDaily.db_selects),
                func.sum(UsageDaily.db_writes),
                func.sum(UsageDaily.db_ms),
            )
            .where(UsageDaily.day >= start, UsageDaily.day <= end)
            .group_by(UsageDaily.hotel_id)
        )
    ).all()

    per_hotel: dict[str, dict[str, float]] = {}
    for hid, req, e4, e5, dur, sel, wri, dbms in rows:
        per_hotel[str(hid)] = {
            "requests": int(req or 0),
            "errors_4xx": int(e4 or 0),
            "errors_5xx": int(e5 or 0),
            "duration_ms": int(dur or 0),
            "db_selects": int(sel or 0),
            "db_writes": int(wri or 0),
            "db_ms": int(dbms or 0),
        }

    live_rows = 0
    if include_live and end >= datetime.now(UTC).date():
        for (day, hotel, _m, _e), v in usage_mod.COUNTERS.snapshot().items():
            if not (start <= day <= end):
                continue
            live_rows += 1
            slot = per_hotel.setdefault(
                hotel,
                {"requests": 0, "errors_4xx": 0, "errors_5xx": 0,
                 "duration_ms": 0, "db_selects": 0, "db_writes": 0, "db_ms": 0},
            )
            for k in slot:
                slot[k] += v.get(k, 0)

    _FIELDS = (
        "requests", "errors_4xx", "errors_5xx", "duration_ms",
        "db_selects", "db_writes", "db_ms",
    )
    totals = {k: sum(h[k] for h in per_hotel.values()) for k in _FIELDS}

    last = usage_mod.COUNTERS.last_flush
    return {
        "per_hotel": per_hotel,
        "totals": totals,
        "live_keys_pending": live_rows,
        "counters_flushed_seconds_ago": int(datetime.now(UTC).timestamp() - last) if last else None,
        #: Said on the page, not hidden in a docstring. These include pool
        #: pre-ping SELECT 1s and health checks, and an executemany counts once.
        "caveat": "includes pool pre-ping and health checks; executemany counts once",
    }


# ── the billed half ───────────────────────────────────────────────────────


async def billed(db: AsyncSession, *, start: date, end: date) -> dict:
    """What AWS charged, from the cache. NEVER fetches — the fetch is a
    scheduled job and a deliberate button, because it costs a cent a call."""
    rows = (
        await db.execute(
            select(
                CloudCostDaily.service,
                CloudCostDaily.usage_type,
                CloudCostDaily.record_type,
                func.sum(CloudCostDaily.amount_usd),
                func.max(CloudCostDaily.as_of),
            )
            .where(CloudCostDaily.day >= start, CloudCostDaily.day <= end)
            .group_by(
                CloudCostDaily.service, CloudCostDaily.usage_type, CloudCostDaily.record_type
            )
        )
    ).all()

    if not rows:
        # NOT $0.00. Zero is a lie that reads as good news, and this page's
        # worst possible failure is a reassuring number where there is no data.
        return {
            "available": False,
            "reason": "AWS figures have never been fetched for this period.",
            "gross_usd": None,
            "credits_usd": None,
            "net_usd": None,
            "by_service": [],
            "pools": {},
            "as_of": None,
        }

    by_service: list[dict] = []
    pools: dict[str, Decimal] = {DIRECT: Decimal(0), SHARED: Decimal(0), PLATFORM: Decimal(0)}
    unclassified: list[dict] = []
    shared_split: dict[str, Decimal] = {"app": Decimal(0), "db": Decimal(0)}
    gross = Decimal(0)
    credits = Decimal(0)
    as_of = None

    for service, utype, rtype, amount, row_as_of in rows:
        amount = Decimal(amount or 0)
        as_of = max(as_of, row_as_of) if as_of and row_as_of else (row_as_of or as_of)
        if rtype in ("Credit", "Refund"):
            credits += amount
            continue
        gross += amount
        pool = classify(service, utype)
        by_service.append({
            "service": service, "usage_type": utype,
            "amount_usd": float(amount), "pool": pool,
        })
        if pool in pools:
            pools[pool] += amount
        else:
            unclassified.append({"service": service, "usage_type": utype,
                                 "amount_usd": float(amount)})
        if pool == SHARED:
            shared_split[shared_kind(service, utype)] += amount

    by_service.sort(key=lambda r: r["amount_usd"], reverse=True)
    return {
        "available": True,
        "gross_usd": float(gross),
        "credits_usd": float(credits),
        "net_usd": float(gross + credits),
        "by_service": by_service,
        "pools": {k: float(v) for k, v in pools.items()},
        "shared_split": {k: float(v) for k, v in shared_split.items()},
        #: Rendered as its own row, never folded into a pool. A new AWS service
        #: silently absorbed is exactly how a $10/month surprise hides.
        "unclassified": unclassified,
        "as_of": as_of.isoformat() if as_of else None,
    }


async def last_sync(db: AsyncSession, job: str) -> dict | None:
    row = (
        await db.execute(
            select(TelemetrySync).where(TelemetrySync.job == job)
            .order_by(TelemetrySync.started_at.desc()).limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    return {
        "job": row.job,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
        "ok": row.ok,
        "rows_written": row.rows_written,
        "api_calls": row.api_calls,
        "api_cost_usd": float(row.api_cost_usd or 0),
        "error": row.error,
    }


async def month_to_date_cost(db: AsyncSession) -> tuple[date, date]:
    today = datetime.now(UTC).date()
    return today.replace(day=1), today


# ── unit economics: three numbers, never one ──────────────────────────────


def unit_economics(*, gross_usd: float | None, marginal_usd: float | None, requests: int,
                   ai_calls: int, ai_usd: float | None) -> dict:
    """Cost per request, said three ways because one way would mislead.

    Dividing a fixed monthly box cost by request count is a real number that
    means something completely different from a marginal cost — and it FALLS AS
    TRAFFIC RISES, which is the opposite of what "cost per request" sounds
    like. The three are labelled with their own definitions so the label cannot
    drift from the arithmetic.
    """
    def per_k(total: float | None, n: int) -> float | None:
        if total is None or n <= 0:
            return None
        return round(total / n * 1000, 6)

    return {
        "fully_loaded_per_1k": {
            "value": per_k(gross_usd, requests),
            "definition": "the whole bill split across requests. It FALLS as traffic "
                          "rises. It is not what one more request costs.",
        },
        "marginal_per_1k": {
            "value": per_k(marginal_usd, requests),
            "definition": "what one more request adds. For a normal page load this is "
                          "effectively $0 — the box is already paid for.",
        },
        "ai_per_call": {
            "value": round(ai_usd / ai_calls, 6) if ai_usd and ai_calls > 0 else None,
            "definition": "the one request type where per-request cost is real.",
        },
        "requests": requests,
        "ai_calls": ai_calls,
    }


ANON = uuid.UUID(usage_mod.ANON)


def window(days: int) -> tuple[date, date]:
    end = datetime.now(UTC).date()
    return end - timedelta(days=max(1, days) - 1), end
