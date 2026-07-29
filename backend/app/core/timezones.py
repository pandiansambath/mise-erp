"""What "today" means for a restaurant.

This is not a formatting concern. It decides which day a sale belongs to, which
shift someone worked, and what a P&L covers — so getting it wrong does not look
like a bug, it looks like the numbers are wrong.

The failure it prevents: at 04:00 in Chennai it is still *yesterday* in UTC, and
at 00:30 in London during BST it is still yesterday too. Using UTC dates would
have put late-night takings on the wrong day and made a night shift vanish from
"today's attendance" — quietly, with no error anywhere.

Rules:
* **Store UTC, always.** Every timestamp column stays timezone-aware UTC. A
  hotel changing its timezone must never rewrite history; it changes how the
  same instants are *read*.
* **Convert at the boundary.** `hotel_today()` / `hotel_now()` here, and
  formatting in the UI. Nothing in between should think about zones.
* **An unknown zone falls back to UTC rather than raising.** A bad value in one
  hotel's settings must not take down a page.
"""
from __future__ import annotations

import logging
from datetime import UTC, date, datetime, time, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

log = logging.getLogger("mise.timezones")

DEFAULT = "Europe/London"

# Offered in Settings. A short, curated list beats 600 IANA names nobody can
# scroll — these cover where the product is actually sold, plus the obvious
# expansion markets. `value` is the IANA id; the label is what a human recognises.
CHOICES: list[dict[str, str]] = [
    {"value": "Europe/London", "label": "United Kingdom (London)"},
    {"value": "Europe/Dublin", "label": "Ireland (Dublin)"},
    {"value": "Asia/Kolkata", "label": "India (IST)"},
    {"value": "Asia/Colombo", "label": "Sri Lanka (Colombo)"},
    {"value": "Asia/Dubai", "label": "UAE (Dubai)"},
    {"value": "Asia/Singapore", "label": "Singapore"},
    {"value": "Asia/Kuala_Lumpur", "label": "Malaysia (Kuala Lumpur)"},
    {"value": "Europe/Paris", "label": "France (Paris)"},
    {"value": "Europe/Berlin", "label": "Germany (Berlin)"},
    {"value": "Europe/Madrid", "label": "Spain (Madrid)"},
    {"value": "America/New_York", "label": "US Eastern (New York)"},
    {"value": "America/Chicago", "label": "US Central (Chicago)"},
    {"value": "America/Los_Angeles", "label": "US Pacific (Los Angeles)"},
    {"value": "Australia/Sydney", "label": "Australia (Sydney)"},
    {"value": "Pacific/Auckland", "label": "New Zealand (Auckland)"},
    {"value": "UTC", "label": "UTC (no local time)"},
]

_VALID = {c["value"] for c in CHOICES}


def is_valid(name: str) -> bool:
    return name in _VALID


def zone_of(hotel) -> tzinfo:
    """The hotel's zone, or UTC if it is missing or unrecognised.

    Falls back rather than raising: one bad settings value should not 500 a
    page, and UTC is at least a defensible answer.
    """
    name = (getattr(hotel, "timezone", None) or DEFAULT).strip()
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        # datetime.UTC, NOT ZoneInfo("UTC"): where the tz database is missing
        # entirely, ZoneInfo("UTC") raises too — so the "safe" fallback would
        # itself 500 every page that touches a date. This one cannot fail.
        log.warning(
            "unknown timezone %r; falling back to UTC", name[:60],
            extra={"code": "DINE-B9000"},
        )
        return UTC


def hotel_now(hotel) -> datetime:
    """Now, as the restaurant experiences it."""
    return datetime.now(UTC).astimezone(zone_of(hotel))


def hotel_today(hotel) -> date:
    """The restaurant's current business day.

    THE function to use anywhere "today" appears. `date.today()` on the server
    answers a question about the server, which nobody asked.
    """
    return hotel_now(hotel).date()


def day_bounds(hotel, day: date) -> tuple[datetime, datetime]:
    """The UTC instants that bracket a local calendar day.

    For querying UTC-stored timestamps by a local day: a Chennai Tuesday starts
    at 18:30 UTC on Monday. Comparing a UTC timestamp to a bare local date is
    the single easiest way to lose five and a half hours of trade.
    """
    tz = zone_of(hotel)
    start_local = datetime.combine(day, time.min, tzinfo=tz)
    end_local = datetime.combine(day, time.max, tzinfo=tz)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)


def to_local(value: datetime | None, hotel) -> datetime | None:
    """Render a stored UTC timestamp in the hotel's zone."""
    if value is None:
        return None
    # A naive timestamp from an older row is assumed UTC — that is what we
    # always wrote, and guessing local would shift real history.
    aware = value if value.tzinfo else value.replace(tzinfo=UTC)
    return aware.astimezone(zone_of(hotel))
