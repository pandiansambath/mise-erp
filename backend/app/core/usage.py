"""What each restaurant actually used — counted cheaply, kept honestly.

    "how many request..how many wrtie how many read to db...whats the cost for
     eadch request..whats the cpst for 1000 request"

WHY THIS IS NOT `pulse.py`, AND NOT A ROW PER REQUEST

`app/core/pulse.py` already counts requests, and it is deliberately wrong for
this: it is an in-process ring buffer that RESETS ON DEPLOY. That is exactly
what you want for "is the thing I just shipped healthy" and useless for a bill,
because deploys happen several times a day.

A row per request is the other obvious answer and it is worse. At this app's
traffic that is roughly 43.8 million rows and ~10.5 GB a year, on a 20 GB disk
that the whole company runs on — a billing dashboard whose own storage becomes
a visible line on the bill it reports. It also puts a database write on the hot
path of every read, for a screen one person opens.

So: counters in memory, flushed into `usage_daily` as ONE upsert every five
minutes and again on shutdown. ~370k rows and ~100 MB a year. What that loses
is sub-day resolution in storage and up to five minutes of counts if the
container is SIGKILLed rather than asked to stop. Both are handled:

  · LIVE-NESS comes from composing, not from storing. "Today" is the stored
    rows PLUS the un-flushed delta still in memory, so the page is current to
    the second and can say when the counters were last written.
  · A NORMAL DEPLOY LOSES NOTHING. `docker compose up -d` sends SIGTERM, the
    lifespan shutdown hook runs, and we flush there.
  · THE UPSERT ADDS, it does not replace. If uvicorn ever runs more than one
    worker, or two containers overlap during a swap, the counts still sum.
    `PULSE` does not have that property, which is the second reason not to
    extend it.

WHAT THESE NUMBERS ARE NOT

They include connection pool pre-ping `SELECT 1`s and health checks, and an
`executemany` counts once. The page says so. A number whose scope you cannot
see is worse than no number.
"""

from __future__ import annotations

import contextvars
import threading
import time
from datetime import UTC, date, datetime
from typing import Any

#: Per-request DB tallies. A ContextVar rather than `request.state` because the
#: SQLAlchemy events fire deep inside the session, on the sync side of the
#: asyncio bridge. Verified before relying on it: a ContextVar set in the
#: request DOES reach a handler running inside SQLAlchemy's `greenlet_spawn`.
_REQ: contextvars.ContextVar[dict[str, int] | None] = contextvars.ContextVar(
    "mise_usage_req", default=None
)

#: Work WE do — the flush itself, the AWS fetch, the reminder job. Without this
#: the collector counts its own writes and inflates itself every five minutes.
_INTERNAL: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "mise_usage_internal", default=False
)

ANON = "00000000-0000-0000-0000-000000000000"

#: Anything at or above this and a single request's DB time is suspicious
#: rather than merely slow. Only used for the docstring's sake today.
SLOW_DB_MS = 500


class _Counters:
    """(day, hotel, method, endpoint) -> tallies, plus when we last wrote."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rows: dict[tuple[date, str, str, str], dict[str, int]] = {}
        self.last_flush: float | None = None
        self.dropped = 0

    def add(
        self,
        *,
        hotel_id: str | None,
        method: str,
        endpoint: str,
        status: int,
        ms: int,
        db_selects: int = 0,
        db_writes: int = 0,
        db_ms: int = 0,
    ) -> None:
        key = (datetime.now(UTC).date(), hotel_id or ANON, method[:8], endpoint[:160])
        with self._lock:
            row = self._rows.get(key)
            if row is None:
                # Bounded: a runaway endpoint generator must not eat the heap.
                # 20k distinct keys is far more than this app can produce in
                # five minutes; past it we count the request but not its shape.
                if len(self._rows) >= 20_000:
                    self.dropped += 1
                    return
                row = self._rows[key] = {
                    "requests": 0, "errors_4xx": 0, "errors_5xx": 0,
                    "duration_ms": 0, "db_selects": 0, "db_writes": 0, "db_ms": 0,
                }
            row["requests"] += 1
            if 400 <= status < 500:
                row["errors_4xx"] += 1
            elif status >= 500:
                row["errors_5xx"] += 1
            row["duration_ms"] += max(0, ms)
            row["db_selects"] += db_selects
            row["db_writes"] += db_writes
            row["db_ms"] += db_ms

    def drain(self) -> dict[tuple[date, str, str, str], dict[str, int]]:
        """Take everything and reset. Called by the flush.

        Drain-then-write rather than write-then-clear: if the write fails, the
        counts are already out of memory and lost. That is the deliberate
        trade — losing five minutes of counts is better than double-counting
        them on a retry, because a bill that drifts upward looks like growth.
        """
        with self._lock:
            rows, self._rows = self._rows, {}
            return rows

    def snapshot(self) -> dict[tuple[date, str, str, str], dict[str, int]]:
        """Peek without draining — this is what makes "today" live."""
        with self._lock:
            return {k: dict(v) for k, v in self._rows.items()}


COUNTERS = _Counters()


# ── the per-request hooks ─────────────────────────────────────────────────


def begin_request() -> None:
    _REQ.set({"selects": 0, "writes": 0, "ms": 0})


def end_request(*, hotel_id: str | None, method: str, endpoint: str, status: int, ms: int) -> None:
    if _INTERNAL.get():
        return
    db = _REQ.get() or {"selects": 0, "writes": 0, "ms": 0}
    COUNTERS.add(
        hotel_id=hotel_id,
        method=method,
        endpoint=endpoint,
        status=status,
        ms=ms,
        db_selects=db["selects"],
        db_writes=db["writes"],
        db_ms=db["ms"],
    )


class internal:
    """`with internal():` — work we do to ourselves is not tenant usage."""

    def __enter__(self) -> None:
        self._token = _INTERNAL.set(True)

    def __exit__(self, *exc: object) -> None:
        _INTERNAL.reset(self._token)


# ── the SQLAlchemy side ───────────────────────────────────────────────────

_WRITE_VERBS = ("INSERT", "UPDATE", "DELETE", "MERGE")


def attach_db_counters(sync_engine: Any) -> None:
    """Count statements per request. Classify on the first keyword — cheap, and
    right often enough for a cost signal.

    Registered once at startup against the SYNC engine behind the async one.
    """
    from sqlalchemy import event

    @event.listens_for(sync_engine, "before_cursor_execute")
    def _before(conn, cursor, statement, params, context, executemany):  # noqa: ANN001, ARG001
        context._mise_t0 = time.perf_counter()

    @event.listens_for(sync_engine, "after_cursor_execute")
    def _after(conn, cursor, statement, params, context, executemany):  # noqa: ANN001, ARG001
        bucket = _REQ.get()
        if bucket is None:
            return
        t0 = getattr(context, "_mise_t0", None)
        if t0 is not None:
            bucket["ms"] += int((time.perf_counter() - t0) * 1000)
        head = statement.lstrip()[:6].upper()
        if head.startswith(_WRITE_VERBS):
            bucket["writes"] += 1
        else:
            bucket["selects"] += 1


# ── the flush ─────────────────────────────────────────────────────────────


async def flush(db: Any) -> int:
    """Write the counters into `usage_daily`. Returns rows written.

    ADDS on conflict — never replaces. That is what makes a five-minute flush,
    a second worker and an overlapping container swap all safe.
    """
    from sqlalchemy.dialects.postgresql import insert

    from app.platform_admin.models import UsageDaily

    rows = COUNTERS.drain()
    if not rows:
        COUNTERS.last_flush = time.time()
        return 0

    payload = [
        {
            "day": day,
            "hotel_id": hotel,
            "method": method,
            "endpoint": endpoint,
            **vals,
        }
        for (day, hotel, method, endpoint), vals in rows.items()
    ]

    with internal():
        stmt = insert(UsageDaily).values(payload)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_usage_daily_key",
            set_={
                c: UsageDaily.__table__.c[c] + stmt.excluded[c]
                for c in (
                    "requests", "errors_4xx", "errors_5xx",
                    "duration_ms", "db_selects", "db_writes", "db_ms",
                )
            },
        )
        await db.execute(stmt)
        await db.commit()

    COUNTERS.last_flush = time.time()
    return len(payload)
