"""`usage_daily` — the measured half of the money dashboard (§43).

Every figure the page can label "measured, live" (as opposed to "billed, hours
behind") comes out of this one table, written by `app.core.usage.flush()`
every five minutes. The two ways that can lie without a single visible error:

  1. the UPSERT replaces instead of adding, so a five-minute flush loses the
     previous five minutes instead of accumulating them — the bill would read
     low and nobody would notice because low looks fine.
  2. the unique constraint is subtly wrong (too coarse merges two different
     things into one row; too fine splits one thing into many), which is
     invisible on a small test but corrupts every count once traffic is real.

DB FIXTURE REQUIRED for every test below — they write real rows through the
real `flush()` and read them back. NONE of this runs on this machine: even a
test with no `db` fixture at all still fails to collect here, because
`conftest.py` provisions a Postgres database at import time for the whole
`tests/` package. Written for CI.
"""
from datetime import date as date_type

import pytest
from sqlalchemy import select

from app.core import usage
from app.hotels.models import Hotel
from app.platform_admin.models import ANON_HOTEL, UsageDaily


@pytest.fixture(autouse=True)
def _clean_counters():
    """`usage.COUNTERS` is a process-wide singleton — `_reset_db` drops and
    recreates the tables between tests but nothing clears THIS, because it
    lives in memory, not in Postgres. Left alone, whatever an earlier test
    recorded and never flushed would leak into this test's first flush and
    inflate its counts by however much ran before it.
    """
    usage.COUNTERS.drain()
    yield
    usage.COUNTERS.drain()


async def test_two_flushes_of_the_same_key_sum_rather_than_replace(db, hotel) -> None:
    """THE property that makes a five-minute flush, a second uvicorn worker or
    an overlapping container swap during a deploy all safe. Two wrong answers
    look identical to a casual read of the table: an UPSERT that REPLACES
    leaves one row with only the second flush's numbers, and an UPSERT that
    inserts a fresh row every time also leaves what looks like real data —
    only counting rows and summing across them catches either.
    """
    usage.COUNTERS.add(
        hotel_id=str(hotel.id), method="GET", endpoint="/api/x", status=200,
        ms=120, db_selects=2, db_writes=0, db_ms=15,
    )
    await usage.flush(db)

    usage.COUNTERS.add(
        hotel_id=str(hotel.id), method="GET", endpoint="/api/x", status=200,
        ms=80, db_selects=1, db_writes=0, db_ms=9,
    )
    usage.COUNTERS.add(
        hotel_id=str(hotel.id), method="GET", endpoint="/api/x", status=500,
        ms=40, db_selects=0, db_writes=1, db_ms=5,
    )
    await usage.flush(db)

    rows = (
        await db.execute(
            select(UsageDaily).where(
                UsageDaily.hotel_id == hotel.id, UsageDaily.endpoint == "/api/x"
            )
        )
    ).scalars().all()
    assert len(rows) == 1, "two flushes of the same (day, hotel, method, endpoint) made two rows"
    row = rows[0]
    assert row.requests == 3
    assert row.errors_5xx == 1
    assert row.duration_ms == 120 + 80 + 40
    assert row.db_selects == 3
    assert row.db_writes == 1
    assert row.db_ms == 15 + 9 + 5


async def test_a_second_flush_with_nothing_new_writes_nothing(db, hotel) -> None:
    """`drain()` empties the in-memory counters as part of the flush. A flush
    with nothing recorded since the last one must not re-send stale numbers
    and must not touch rows for keys nobody hit this cycle.
    """
    usage.COUNTERS.add(hotel_id=str(hotel.id), method="GET", endpoint="/api/quiet", status=200, ms=10)
    written = await usage.flush(db)
    assert written == 1

    written_again = await usage.flush(db)
    assert written_again == 0

    row = (
        await db.execute(select(UsageDaily).where(UsageDaily.endpoint == "/api/quiet"))
    ).scalar_one()
    assert row.requests == 1


async def test_anonymous_traffic_uses_the_sentinel_and_still_accumulates(db) -> None:
    """Postgres treats NULL as distinct from every other NULL in a unique
    constraint, so a nullable `hotel_id` would insert a FRESH row on every
    five-minute flush of anonymous traffic instead of matching the existing
    one — code that looks exactly like an UPSERT and, for the diner scanning a
    QR code with no login, never actually is one. `ANON_HOTEL` is a concrete
    all-zeroes UUID for exactly this reason; this proves it behaves like any
    other hotel_id under the constraint rather than merely existing as a
    constant nobody's code-path actually reaches.
    """
    usage.COUNTERS.add(hotel_id=None, method="GET", endpoint="/api/public/menu", status=200, ms=50)
    await usage.flush(db)
    usage.COUNTERS.add(hotel_id=None, method="GET", endpoint="/api/public/menu", status=200, ms=70)
    await usage.flush(db)

    rows = (
        await db.execute(select(UsageDaily).where(UsageDaily.endpoint == "/api/public/menu"))
    ).scalars().all()
    assert len(rows) == 1, "anonymous traffic split across two rows instead of matching itself"
    assert rows[0].hotel_id == ANON_HOTEL
    assert rows[0].requests == 2


async def test_different_methods_on_the_same_endpoint_are_not_merged(db, hotel) -> None:
    """The unique key is (day, hotel, METHOD, endpoint). Drop `method` from it
    by accident in a future migration and a GET and a POST on the same path
    would silently share one row — read-count and write-count would both be
    wrong in a way that never raises an error, just quietly conflates a chart
    read with the write that follows it.
    """
    usage.COUNTERS.add(hotel_id=str(hotel.id), method="GET", endpoint="/api/y", status=200, ms=10)
    usage.COUNTERS.add(hotel_id=str(hotel.id), method="POST", endpoint="/api/y", status=200, ms=10)
    await usage.flush(db)

    rows = (
        await db.execute(
            select(UsageDaily).where(UsageDaily.hotel_id == hotel.id, UsageDaily.endpoint == "/api/y")
        )
    ).scalars().all()
    assert len(rows) == 2
    assert {r.method for r in rows} == {"GET", "POST"}


async def test_two_hotels_on_the_same_endpoint_are_not_merged(db, hotel) -> None:
    """The other half of the same risk: drop `hotel_id` from the key (or key
    only on endpoint) and every restaurant hitting a popular route — `/api/
    dashboard`, say — would pile onto one row, and 'who cost how much' would
    stop being answerable, which is the entire point of this table.
    """
    other = Hotel(name="Second Kitchen", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)

    usage.COUNTERS.add(hotel_id=str(hotel.id), method="GET", endpoint="/api/shared", status=200, ms=10)
    usage.COUNTERS.add(hotel_id=str(other.id), method="GET", endpoint="/api/shared", status=200, ms=10)
    await usage.flush(db)

    rows = (
        await db.execute(select(UsageDaily).where(UsageDaily.endpoint == "/api/shared"))
    ).scalars().all()
    assert len(rows) == 2
    assert {r.hotel_id for r in rows} == {hotel.id, other.id}


async def test_deleting_a_hotel_does_not_erase_its_usage_daily_rows(db, hotel) -> None:
    """Last month's bill is not the tenant's to erase. `usage_daily` carries NO
    foreign key to `hotels` — deliberately, per the comment above the model —
    because `deletion.purge()` derives its delete plan by walking the live FK
    graph, not a hand-maintained table list (that hand-maintained list is what
    caused the outage `deletion.py`'s own docstring describes). A table with
    no FK to `hotels` is invisible to that walk and therefore untouched by a
    tenant delete. If a future migration "helpfully" added the FK back, this
    is the test that would catch it: the restaurant's spend history would
    vanish from the platform's own books at the exact moment it churned,
    which is backwards for a table whose only reason to exist is billing
    history.
    """
    from app.platform_admin import deletion

    row = UsageDaily(
        day=date_type.today(), hotel_id=hotel.id, method="GET", endpoint="/api/z",
        requests=7, db_selects=3, db_writes=1, db_ms=40, duration_ms=300,
    )
    db.add(row)
    await db.commit()

    await deletion.purge(db, hotel.id)
    await db.commit()
    # EXPUNGE, not expire.
    #
    # `purge()` deletes with raw `text()` SQL, so the ORM never learns the row
    # is gone. `expire_all()` only marks the loaded attributes stale — the Hotel
    # INSTANCE stays in the identity map, so `db.get()` hands it straight back
    # and then raises ObjectDeletedError the moment anything touches a column.
    # Expunging drops it, so the query below actually goes to the database.
    db.expunge_all()

    # the hotel really is gone — otherwise the row "surviving" would be
    # meaningless, nothing was actually deleted
    gone = (
        await db.execute(select(Hotel).where(Hotel.id == hotel.id))
    ).scalar_one_or_none()
    assert gone is None

    survivors = (
        await db.execute(select(UsageDaily).where(UsageDaily.hotel_id == hotel.id))
    ).scalars().all()
    assert len(survivors) == 1, "usage_daily rows were deleted along with the hotel"
    assert survivors[0].requests == 7
