"""Closing yesterday's drawer when nobody did.

This runs unattended, after midnight, and it writes to cash — the one place in
the product where being quietly wrong costs real money and real trust. It had
no tests at all.

Four properties matter, and each is one test:

  * a day left open is settled, so the carry-forward chain does not break at
    the first busy night somebody forgot
  * it never overwrites a human's count, so running it twice or late is safe
  * an auto-close is labelled as a GUESS, because presenting an assumption as
    a measurement is how a cash system loses trust
  * "yesterday" means the RESTAURANT's yesterday — a Chennai day rolls over
    five and a half hours before a London one, and using the server's clock
    would close a day while service was still running
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.timezones import hotel_today
from app.hotels.models import Hotel
from app.sales import autoclose
from app.sales.models import DailySales


@pytest.fixture
async def london(db) -> Hotel:
    h = Hotel(
        name="London Place",
        country="GB",
        base_currency="GBP",
        city="London",
        timezone="Europe/London",
    )
    db.add(h)
    await db.commit()
    await db.refresh(h)
    return h


async def _open_day(db, hotel, day: date, *, opening="100.00", counted=None) -> DailySales:
    row = DailySales(
        hotel_id=hotel.id,
        date=day,
        opening_cash=Decimal(opening),
        cash_counted=None if counted is None else Decimal(counted),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def test_an_open_day_gets_closed(db, london) -> None:
    """The whole point: a day nobody counted still ends."""
    yesterday = hotel_today(london) - timedelta(days=1)
    row = await _open_day(db, london, yesterday)

    assert await autoclose.run_once() == 1

    await db.refresh(row)
    assert row.cash_counted is not None
    assert row.closed_at is not None


async def test_an_auto_close_is_labelled_as_a_guess(db, london) -> None:
    """Nobody counted the till. Recording the expected figure is reasonable;
    letting it look like a measurement is not."""
    yesterday = hotel_today(london) - timedelta(days=1)
    row = await _open_day(db, london, yesterday, opening="250.00")

    await autoclose.run_once()

    await db.refresh(row)
    assert row.auto_closed is True
    # With no sales and nothing spent, expected is simply the opening float.
    assert row.cash_counted == Decimal("250.00")


async def test_it_never_overwrites_a_human_count(db, london) -> None:
    """A manager counted 300 and the drawer was 50 short. That is a fact about
    the evening, and an automated job must not tidy it away."""
    yesterday = hotel_today(london) - timedelta(days=1)
    row = await _open_day(db, london, yesterday, opening="350.00", counted="300.00")

    assert await autoclose.run_once() == 0

    await db.refresh(row)
    assert row.cash_counted == Decimal("300.00")
    assert row.auto_closed is False


async def test_running_it_twice_changes_nothing_the_second_time(db, london) -> None:
    """It runs on a timer. A retry, a late run, or two boxes firing at once
    must all be harmless."""
    yesterday = hotel_today(london) - timedelta(days=1)
    row = await _open_day(db, london, yesterday)

    assert await autoclose.run_once() == 1
    await db.refresh(row)
    first_close = row.closed_at

    assert await autoclose.run_once() == 0
    await db.refresh(row)
    assert row.closed_at == first_close


async def test_today_is_left_alone(db, london) -> None:
    """Service may still be running. Only YESTERDAY is settled."""
    today = hotel_today(london)
    row = await _open_day(db, london, today)

    assert await autoclose.run_once() == 0

    await db.refresh(row)
    assert row.cash_counted is None


async def test_a_hotel_that_never_traded_is_skipped(db, london) -> None:
    """No row for the day means the restaurant was shut. There is no drawer to
    close, and inventing one would put a phantom day in the chain."""
    assert await autoclose.run_once() == 0


async def test_each_hotel_closes_on_its_own_midnight(db, london) -> None:
    """A Chennai day rolls over five and a half hours before a London one. The
    server's clock answers a question nobody asked."""
    chennai = Hotel(
        name="Chennai Place",
        country="IN",
        base_currency="INR",
        city="Chennai",
        timezone="Asia/Kolkata",
    )
    db.add(chennai)
    await db.commit()
    await db.refresh(chennai)

    # Each hotel's OWN yesterday — these are not always the same calendar date.
    await _open_day(db, london, hotel_today(london) - timedelta(days=1))
    await _open_day(db, chennai, hotel_today(chennai) - timedelta(days=1))

    assert await autoclose.run_once() == 2


async def test_an_inactive_hotel_is_not_touched(db, london) -> None:
    """A closed-down restaurant should not keep generating cash records."""
    london.is_active = False
    await db.commit()
    await _open_day(db, london, hotel_today(london) - timedelta(days=1))

    assert await autoclose.run_once() == 0


# ── the two faults that stranded 25 and 26 September ─────────────────────


async def test_several_missed_nights_are_all_recovered(db, london) -> None:
    """⭐ NOT ONLY YESTERDAY.

    It used to look at exactly one date. One missed night — and the job was
    crashing every night it had work — stranded that day forever, because by
    the next run "yesterday" was a different date. On his real restaurant 25
    and 26 September were still open four days later for exactly that reason.
    """
    today = hotel_today(london)
    d1 = await _open_day(db, london, today - timedelta(days=3), opening="100.00")
    d2 = await _open_day(db, london, today - timedelta(days=2), opening="0")
    await autoclose.run_once()
    await db.refresh(d1)
    await db.refresh(d2)
    assert d1.cash_counted is not None, "an older missed night was left open"
    assert d2.cash_counted is not None
    assert d1.auto_closed and d2.auto_closed


async def test_oldest_first_so_each_close_feeds_the_next(db, london) -> None:
    """Each close is the next day's opening. Settle the later day first and it
    is computed from a float that is about to change underneath it."""
    today = hotel_today(london)
    early = await _open_day(db, london, today - timedelta(days=3), opening="100.00")
    # opening 0 → this day's float is a CARRY from the day before
    late = await _open_day(db, london, today - timedelta(days=2), opening="0")
    await autoclose.run_once()
    await db.refresh(early)
    await db.refresh(late)
    assert late.cash_counted == early.cash_counted, (
        "the later day did not carry the earlier day's close"
    )


async def test_it_does_not_reach_into_old_history(db, london) -> None:
    """A few missed nights is the realistic failure. Reaching back months would
    start settling history nobody is thinking about."""
    old = await _open_day(
        db, london, hotel_today(london) - timedelta(days=autoclose.RECOVER_DAYS + 5)
    )
    await autoclose.run_once()
    await db.refresh(old)
    assert old.cash_counted is None


def test_every_foreign_key_resolves_in_a_fresh_process() -> None:
    """⭐ THE TEST THAT WOULD HAVE CAUGHT IT — and the first version of it did not.

    Every test above ran green while production crashed nightly with

        NoReferencedTableError: ... 'cash_events.changed_by' could not find
        table 'users'

    because the TEST process imports the whole app, so every model is
    registered and every foreign key resolves. systemd runs `python -m
    app.sales.autoclose` in a FRESH interpreter holding only this module's
    imports.

    ⚠️ My first version called `configure_mappers()` and PASSED WITHOUT THE FIX
    — it proved nothing. The crash comes from the FLUSH, which sorts tables by
    their foreign keys and resolves every one of them. So this resolves every
    foreign key directly, the way the flush does. Measured before writing it:
    without `_load_every_model()`, `users` is not registered and SEVEN foreign
    keys cannot resolve; with it, none.
    """
    import subprocess
    import sys
    import textwrap

    code = textwrap.dedent(
        """
        from app.sales import autoclose
        autoclose._load_every_model()
        from app.core.database import Base
        bad = []
        for t in Base.metadata.tables.values():
            for fk in t.foreign_keys:
                try:
                    fk.column
                except Exception as e:
                    bad.append(f"{t.name}.{fk.parent.name}: {type(e).__name__}")
        assert not bad, bad
        print("ok")
        """
    )
    out = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, text=True, timeout=120
    )
    assert out.returncode == 0, out.stderr[-2000:]
    assert "ok" in out.stdout
