"""Which day a sale belongs to.

These are not formatting tests. Every assertion here corresponds to a way the
numbers could silently be wrong — late trade on the wrong day, a night shift
missing from "today", a P&L short by five and a half hours. None of those raise
an error; they just look like the app is lying.
"""
from datetime import UTC, date, datetime

from app.core import timezones as tz


class _Hotel:
    def __init__(self, timezone="Europe/London"):
        self.timezone = timezone


def test_a_local_day_is_not_a_utc_day() -> None:
    """The whole reason this module exists.

    An Indian restaurant's Tuesday starts at 18:30 UTC on Monday. Treating a
    UTC timestamp as if it carried a local date loses that evening's trade.
    """
    start, end = tz.day_bounds(_Hotel("Asia/Kolkata"), date(2026, 7, 14))
    assert start.astimezone(UTC).day == 13, "IST day should begin the previous UTC day"
    assert start.astimezone(UTC).hour == 18 and start.astimezone(UTC).minute == 30
    assert end > start


def test_london_shifts_with_british_summer_time() -> None:
    """BST is UTC+1. A hard-coded offset would be right for half the year, which
    is worse than being wrong all of it — nobody investigates a bug that only
    appears in summer."""
    summer = tz.day_bounds(_Hotel("Europe/London"), date(2026, 7, 14))[0]
    winter = tz.day_bounds(_Hotel("Europe/London"), date(2026, 1, 14))[0]
    assert summer.astimezone(UTC).hour == 23  # previous day 23:00 UTC
    assert winter.astimezone(UTC).hour == 0  # GMT: midnight is midnight


def test_an_unknown_zone_falls_back_instead_of_exploding() -> None:
    """A typo in one hotel's settings must not 500 every page that shows a date.
    Note this asserts the FALLBACK works, not that bad values are acceptable —
    the API rejects them on the way in."""
    assert tz.hotel_today(_Hotel("Nowhere/Fake")) is not None
    assert tz.hotel_today(_Hotel("")) is not None
    assert tz.hotel_today(_Hotel(None)) is not None


def test_only_offered_zones_are_accepted() -> None:
    assert tz.is_valid("Europe/London")
    assert tz.is_valid("Asia/Kolkata")
    assert not tz.is_valid("Mars/Olympus")
    assert not tz.is_valid("")


def test_stored_utc_is_read_in_the_hotels_zone() -> None:
    """Storage stays UTC; only the reading changes. A hotel switching zone must
    never rewrite history."""
    stamp = datetime(2026, 7, 14, 18, 45, tzinfo=UTC)
    london = tz.to_local(stamp, _Hotel("Europe/London"))
    kolkata = tz.to_local(stamp, _Hotel("Asia/Kolkata"))
    assert london.hour == 19  # BST
    assert kolkata.hour == 0 and kolkata.day == 15  # already tomorrow there
    # the instant itself is unchanged — only its presentation
    assert london.astimezone(UTC) == kolkata.astimezone(UTC) == stamp


def test_naive_timestamps_are_treated_as_utc() -> None:
    """Older rows may be naive. Guessing local would shift real history."""
    naive = datetime(2026, 7, 14, 12, 0)
    out = tz.to_local(naive, _Hotel("Asia/Kolkata"))
    assert out.hour == 17 and out.minute == 30


def test_to_local_passes_none_through() -> None:
    assert tz.to_local(None, _Hotel()) is None
