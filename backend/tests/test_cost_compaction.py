"""Rolling closed months down must never lose a penny.

`compact_closed_months` deletes rows. That is the only thing in this codebase
that deletes billing history, so it gets tested against the cases that would
destroy it quietly rather than loudly.

THE BUG THESE WERE WRITTEN FOR, found by reading the SQL before it ever ran:

    HAVING COUNT(*) > 1

looked like a free optimisation — a month with one row has nothing to sum. It
would have destroyed that month. The rollup is skipped, so no row is written on
the 1st; the DELETE then removes the single row anyway, because it is neither on
the 1st nor tagged `ce-rollup`. A month whose only activity was the 15th would
lose its entire bill, with no error anywhere and nothing on screen except a
smaller number.

Every test here is really one assertion in different clothes: THE TOTAL BEFORE
EQUALS THE TOTAL AFTER. A compaction that changes a total is not a compaction,
it is data loss with a tidy name.
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select

from app.platform_admin.aws_bill import compact_closed_months
from app.platform_admin.models import CloudCostDaily


def _row(day: date, service: str, amount: str, usage_type: str = "u1") -> CloudCostDaily:
    return CloudCostDaily(
        day=day,
        service=service,
        usage_type=usage_type,
        record_type="Usage",
        amount_usd=Decimal(amount),
        quantity=Decimal("1"),
        source="ce",
        as_of=datetime.now(UTC),
        is_estimate=False,
    )


async def _total(db, **where) -> Decimal:
    q = select(func.coalesce(func.sum(CloudCostDaily.amount_usd), 0))
    if "service" in where:
        q = q.where(CloudCostDaily.service == where["service"])
    return Decimal((await db.execute(q)).scalar() or 0)


async def _count(db) -> int:
    return int((await db.execute(select(func.count(CloudCostDaily.id)))).scalar() or 0)


async def test_a_whole_month_collapses_to_one_row_and_keeps_its_total(db) -> None:
    for d in range(1, 29):
        db.add(_row(date(2026, 1, d), "Amazon RDS", "0.50"))
    await db.commit()
    before = await _total(db)

    await compact_closed_months(db)
    db.expire_all()  # Core SQL changed the table; do not read cached instances

    assert await _total(db) == before, "compaction changed the bill"
    assert await _count(db) == 1, "28 daily rows did not become one"


async def test_a_month_whose_only_row_is_not_the_first_survives(db) -> None:
    """THE ONE THAT WAS BROKEN. A single row on the 15th, and nothing else.

    With `HAVING COUNT(*) > 1` in the rollup this row was skipped by the INSERT
    and then removed by the DELETE. Total goes to zero, silently.
    """
    db.add(_row(date(2026, 1, 15), "Amazon RDS", "7.77"))
    await db.commit()

    await compact_closed_months(db)
    db.expire_all()

    assert await _total(db) == Decimal("7.77"), "a single-row month was destroyed"
    assert await _count(db) == 1


async def test_running_it_twice_changes_nothing(db) -> None:
    """The scheduled job runs every six hours. A compaction that is not
    idempotent would halve the bill on the second pass, or double it."""
    for d in range(1, 11):
        db.add(_row(date(2026, 1, d), "Amazon EC2", "1.25"))
    await db.commit()
    before = await _total(db)

    await compact_closed_months(db)
    db.expire_all()
    once = await _total(db)
    await compact_closed_months(db)
    db.expire_all()

    assert once == before
    assert await _total(db) == before, "the second pass moved the total"
    assert await _count(db) == 1


async def test_the_open_month_and_the_restatement_window_are_left_alone(db) -> None:
    """AWS is still revising recent days. Freezing a number that is still
    moving is worse than keeping the rows it is made of."""
    today = datetime.now(UTC).date()
    for d in range(1, 6):
        db.add(_row(date(2026, 1, d), "Amazon RDS", "1.00"))
    for i in range(3):
        db.add(_row(today - timedelta(days=i), "Amazon RDS", "2.00", usage_type="recent"))
    await db.commit()
    before = await _total(db)

    await compact_closed_months(db)
    db.expire_all()

    assert await _total(db) == before
    recent = (
        await db.execute(
            select(func.count(CloudCostDaily.id)).where(
                CloudCostDaily.day >= today - timedelta(days=3)
            )
        )
    ).scalar()
    assert recent == 3, "recent days were compacted while AWS is still revising them"


async def test_each_line_keeps_its_own_total(db) -> None:
    """A rollup that merged two services would produce a correct grand total
    and a useless page — 'where it goes' is the whole point of the screen."""
    for d in range(1, 11):
        db.add(_row(date(2026, 1, d), "Amazon RDS", "1.00"))
        db.add(_row(date(2026, 1, d), "Amazon EC2", "0.50"))
    await db.commit()

    await compact_closed_months(db)
    db.expire_all()

    assert await _total(db, service="Amazon RDS") == Decimal("10.00")
    assert await _total(db, service="Amazon EC2") == Decimal("5.00")
    assert await _count(db) == 2, "two services did not stay two rows"


async def test_credits_roll_up_as_negatives(db) -> None:
    """Credits are negative rows in the same table, and they are what make the
    invoice $0.00 while the usage is real. Losing their sign would turn a
    covered bill into a doubled one."""
    for d in range(1, 11):
        r = _row(date(2026, 1, d), "Amazon RDS", "-1.50")
        r.record_type = "Credit"
        db.add(r)
    await db.commit()

    await compact_closed_months(db)
    db.expire_all()

    assert await _total(db) == Decimal("-15.00")
    assert await _count(db) == 1
