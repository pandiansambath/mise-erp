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
from decimal import Decimal
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

#: Bumped whenever the allocation formula changes, and returned with every
#: allocated figure — so a screenshot of a per-hotel cost can always be
#: traced back to the arithmetic that produced it.
BASIS_VERSION = "v1-2026-09"

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


# ── the allocation, and what it is honestly claiming ──────────────────────
#
#     "ALSO SHOW HOTEL WISE TOO..WHO COST HOW MUHC N WHY WITH PROOFs"
#
# AWS has never heard of a hotel. Three restaurants share one EC2 instance, one
# database and one IP, and no tag can change that — I checked: every resource
# carries Project/ManagedBy/Name and nothing tenant-shaped, and nothing could.
#
# So this is a MODEL. It is labelled one everywhere it is shown, it prints its
# own formula and inputs, and the page puts it beside the measured figure
# rather than adding them into a single total.
#
# AND THE SENTENCE THAT MAKES IT HONEST: on a fixed t3.micro and db.t4g.micro
# the marginal cost of this pool is ZERO until you resize. The box costs $22 a
# month with one restaurant or with fifty. A share of it is a fair split of
# RENT — not a statement about who caused spend. That is why every per-hotel
# row carries two numbers:
#
#     attributed share of shared costs      $4.12   (model)
#     would actually stop being spent       $0.31   (measured)
#
# Either one alone is a lie, in a different direction.


class _Allocation(dict):
    """A plain mapping of hotel -> row, with the model's working on `.meta`.

    A subclass rather than a tuple so it still satisfies "returns a dict keyed
    by hotel", which is what every caller and test expects to iterate.
    """

    meta: dict[str, Any]


def allocate_shared_cost(
    hotel_stats: dict[Any, dict[str, float]],
    shared_usd: dict[str, float],
) -> dict[Any, dict[str, Any]]:
    """Split the SHARED pool across hotels, and show the working.

    `hotel_stats` — key -> {"duration_ms", "db_ms", "ai_latency_ms"}, RAW.
    The netting happens in here, deliberately:

        app_ms = max(0, duration_ms − db_ms − ai_latency_ms)

    A caller that had to do that itself would eventually forget, and the
    failure is invisible: charge a tenant for wall-clock and you over-bill
    exactly the AI-heavy ones, because a four-second Bedrock turn is mostly
    idle waiting. Subtracting db and AI time is what makes duration a CPU
    proxy rather than a PATIENCE proxy.

    `shared_usd` — {"ec2_compute", "ebs", "rds_instance", "rds_storage"} for
    the period.

    ⚠️ rds_storage RIDES WITH rds_instance IN w_db, and that is an assumption
    rather than something the brief stated. The design named four components
    and defined only two weights, so storage had no home and the shares could
    not sum to 1. Storage is the database's disk and the hotels that write most
    fill it, so `db` is the defensible home — but splitting it by rows-per-
    hotel is the better model, needs a weekly row-count sweep that does not
    exist, and `basis_version` moves if that lands.

    Returns key -> {"share", "allocated_usd", "app_ms", "db_ms"}.

    The pool, the weights and the share total ride on `.meta` — an ATTRIBUTE,
    not a sibling key. They were a `_meta` entry first and that was wrong: any
    caller iterating the result as rows hits a row with no "share" in it, which
    is a KeyError at best and a fake hotel in a table at worst.
    """
    app_pool = max(0.0, float(shared_usd.get("ec2_compute", 0.0))) + max(
        0.0, float(shared_usd.get("ebs", 0.0))
    )
    db_pool = max(0.0, float(shared_usd.get("rds_instance", 0.0))) + max(
        0.0, float(shared_usd.get("rds_storage", 0.0))
    )
    total = app_pool + db_pool

    netted: dict[Any, dict[str, float]] = {}
    for key, s in hotel_stats.items():
        db_ms = max(0.0, float(s.get("db_ms", 0.0)))
        app_ms = max(
            0.0,
            float(s.get("duration_ms", 0.0)) - db_ms - float(s.get("ai_latency_ms", 0.0)),
        )
        netted[key] = {"app_ms": app_ms, "db_ms": db_ms}

    sum_app = sum(v["app_ms"] for v in netted.values())
    sum_db = sum(v["db_ms"] for v in netted.values())

    meta: dict[str, Any] = {
        "pool_usd": round(total, 6),
        "basis_version": BASIS_VERSION,
        "inputs": {"sum_app_ms": sum_app, "sum_db_ms": sum_db},
    }

    # NOTHING MEASURED MEANS NO ANSWER — not an equal split. An equal split
    # looks like a measurement and is not one. The page says "no activity in
    # this period", which is true.
    if total <= 0 or not netted or (sum_app <= 0 and sum_db <= 0):
        empty = _Allocation(
            {k: {"share": 0.0, "allocated_usd": 0.0, **v} for k, v in netted.items()}
        )
        meta.update(
            share_total=0.0,
            weights={"app": 0.0, "db": 0.0},
            note="no measured usage in this period — nothing to allocate",
        )
        empty.meta = meta
        return empty

    w_app = app_pool / total
    w_db = db_pool / total

    # A pool with no measured driver cannot be allocated on that driver. Fold
    # its weight into the other rather than divide by zero — and SAY SO, because
    # silently dropping a term is how a model starts lying.
    renormalised = None
    if sum_app <= 0:
        w_db, w_app, renormalised = w_db + w_app, 0.0, "app"
    elif sum_db <= 0:
        w_app, w_db, renormalised = w_app + w_db, 0.0, "db"

    out = _Allocation()
    for key, v in netted.items():
        share = (w_app * (v["app_ms"] / sum_app) if sum_app > 0 else 0.0) + (
            w_db * (v["db_ms"] / sum_db) if sum_db > 0 else 0.0
        )
        out[key] = {
            "share": share,
            "allocated_usd": round(total * share, 6),
            "app_ms": v["app_ms"],
            "db_ms": v["db_ms"],
        }

    meta.update(
        weights={"app": round(w_app, 6), "db": round(w_db, 6)},
        renormalised=renormalised,
        #: Rendered as an equation that visibly balances. If this is not
        #: 1.0000 the model has a bug and the operator can see it.
        share_total=round(sum(r["share"] for r in out.values()), 6),
    )
    out.meta = meta
    return out


def reconcile_bedrock(
    aws_billed_usd: float,
    ai_usage_cost_usd_sum: float,
) -> float | None:
    """How far our own AI ledger is from what AWS actually charged.

    `ai_usage.cost_usd` is OUR estimate from a token price table, not AWS's
    charge, and it under-reports: 76% of AWS's Bedrock figure over 15 days and
    41% over 30. He asked for per-hotel cost "with proofs", and a proof that
    disagrees with the bill he can check himself fails on the first click.

    So the per-hotel AI figure is an ALLOCATION of AWS's billed total, using our
    logged tokens as the key — and this ratio is shown, because if it drifts
    from ~1.0 the token price table is stale and the page has just said so.

    Returns None when there is nothing to divide by. NOT 1.0: a made-up
    agreement is worse than an admitted gap.
    """
    if ai_usage_cost_usd_sum <= 0:
        return None
    # Decimal in, Decimal out. Money arrives as Decimal everywhere else in this
    # codebase and converting to float here would put a binary rounding error
    # into the one figure whose job is to prove two ledgers agree.
    if isinstance(aws_billed_usd, Decimal) or isinstance(ai_usage_cost_usd_sum, Decimal):
        return Decimal(str(aws_billed_usd)) / Decimal(str(ai_usage_cost_usd_sum))
    return round(float(aws_billed_usd) / float(ai_usage_cost_usd_sum), 4)
