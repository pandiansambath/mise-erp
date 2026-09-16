"""`cloud_cost_daily` — what AWS says, cached (§43).

Cost Explorer restates the last few days as its data settles, so the model's
own docstring names the failure mode this file exists to catch: every fetch
must be an UPSERT that REPLACES the stored amount, never one that adds to it.
Get that backwards and the dashboard's own numbers climb every time the
collector runs, on a day nothing changed — "drift that looks like growth",
which is a specifically bad failure for a page whose entire job is telling him
what the bill will be.

DB FIXTURE REQUIRED for both tests below. NONE of this runs on this machine —
even a test with no `db` fixture would still fail to collect here, because
`conftest.py` provisions a Postgres database at import time for the whole
`tests/` package. Written for CI.

NO COLLECTOR EXISTS YET. Grepped `backend/app` for `CloudCostDaily`,
`cloud_cost`, `cost_explorer`, `GetCostAndUsage` — the model is the only hit.
§43.2 (design) and the AWS-fetch half of §43.4 (build) have not landed, so
there is nothing named to call directly. Two tests, deliberately different in
kind:

  · the first is REAL and runs today: it upserts through the table's own
    unique constraint exactly the way a collector must, and proves the
    constraint and column types can support the correct (replace) behaviour.
    It does NOT prove any real collector uses that behaviour, because there
    is no real collector yet.
  · the second FAILS LOUDLY on purpose, by construction, until one exists —
    per instruction, rather than a `skip` that would quietly report green
    while testing nothing. When the AWS-fetch collector is written, point it
    at the real function (rename below to match) and this second test starts
    doing real work; the first one should stay, since the constraint is worth
    pinning on its own.
"""
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from app.core import usage
from app.platform_admin.models import CloudCostDaily


def _upsert_stmt(day: date, amount: Decimal, as_of: datetime):
    """The shape a real collector must use: ON CONFLICT on the model's own
    named constraint, REPLACING amount_usd/as_of, never adding to them.
    """
    stmt = insert(CloudCostDaily).values(
        day=day,
        service="Amazon Elastic Compute Cloud - Compute",
        usage_type="BoxUsage:t3.micro",
        record_type="Usage",
        amount_usd=amount,
        quantity=Decimal("24"),
        source="ce",
        as_of=as_of,
        is_estimate=False,
    )
    return stmt.on_conflict_do_update(
        constraint="uq_cloud_cost_key",
        set_={
            "amount_usd": stmt.excluded.amount_usd,
            "quantity": stmt.excluded.quantity,
            "as_of": stmt.excluded.as_of,
            "fetched_at": func.now(),
            "is_estimate": stmt.excluded.is_estimate,
        },
    )


async def test_refetching_the_same_day_replaces_rather_than_doubles_the_amount(db) -> None:
    """Re-fetch with the SAME figure twice (the boring, common case — nothing
    changed since the last poll) and re-fetch again with a DIFFERENT figure
    (AWS restating the day, the case the model's docstring calls out by name).
    Neither may sum onto the stored row.
    """
    day = date(2026, 9, 10)
    t0 = datetime(2026, 9, 10, 6, 0, tzinfo=UTC)

    await db.execute(_upsert_stmt(day, Decimal("4.02"), t0))
    await db.execute(_upsert_stmt(day, Decimal("4.02"), t0))  # re-fetched, nothing changed
    await db.commit()

    rows = (await db.execute(select(CloudCostDaily).where(CloudCostDaily.day == day))).scalars().all()
    assert len(rows) == 1
    assert rows[0].amount_usd == Decimal("4.02"), "re-fetching the same day doubled the amount"

    t1 = datetime(2026, 9, 10, 18, 0, tzinfo=UTC)
    await db.execute(_upsert_stmt(day, Decimal("4.15"), t1))  # AWS restated the day
    await db.commit()

    # EXPIRE FIRST, or this test lies.
    #
    # The upsert above is CORE sql: it changes the row in the database and the
    # ORM session knows nothing about it. The select below would otherwise
    # return the SAME instance already in the identity map from the query
    # further up — still holding 4.02 — and the assertion would report "a
    # restated figure was added to the old one" when the database is in fact
    # perfectly correct. That is a false failure about the most important
    # property on this page, which is worse than no test.
    db.expire_all()

    row = (await db.execute(select(CloudCostDaily).where(CloudCostDaily.day == day))).scalar_one()
    assert row.amount_usd == Decimal("4.15"), "a restated figure was added to the old one instead of replacing it"
    assert row.as_of == t1


async def test_a_real_collector_upserting_cloud_cost_daily_exists() -> None:
    """FAILS LOUDLY, on purpose, until §43's AWS-fetch collector is written —
    see the module docstring. This is not a bug in the test; it is the
    "mark it clearly" instruction taken literally: a silent skip here would
    let this file report green while §43.9's collector does not exist at all.
    """
    fn = (
        getattr(usage, "flush_cloud_cost", None)
        or getattr(usage, "upsert_cloud_cost", None)
        or getattr(usage, "sync_cloud_cost", None)
    )
    assert fn is not None, (
        "no cloud-cost UPSERT function found on app.core.usage (checked "
        "flush_cloud_cost / upsert_cloud_cost / sync_cloud_cost). The §43 "
        "AWS-fetch collector has not been built yet. When it is, point this "
        "test at the real function instead of asserting its absence."
    )
