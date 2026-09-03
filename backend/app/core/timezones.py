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
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

log = logging.getLogger("mise.timezones")

DEFAULT = "Europe/London"

# EVERY zone, not sixteen of them.
#
#   "here we can only [choose from] limited bro — please don't show like this,
#    show professionally and show all, like india (kolkata +5:30) like this."
#
# The old list was hand-written and covered the markets we happened to think of.
# A restaurant in a country nobody listed simply could not say where it was, and
# the zone decides which DAY a sale belongs to — so the consequence of a missing
# entry is wrong numbers, not a missing convenience.
#
# Built from the system's IANA database, so it stays right as zones change
# without anyone remembering to edit a list.
#
# The offset is in the LABEL because that is how people recognise a zone:
# "+5:30" is the thing an Indian owner is looking for, and "Asia/Kolkata" is not
# a phrase most people have ever typed.
def _offset_label(name: str) -> str:
    """"Asia/Kolkata" -> "Kolkata (UTC+5:30)". Uses TODAY's offset, so a zone on
    summer time reads as the clock on their wall reads right now."""
    try:
        now = datetime.now(ZoneInfo(name))
    except Exception:  # noqa: BLE001 - a zone the platform lacks is simply skipped
        return ""
    off = now.utcoffset() or _ZERO
    total = int(off.total_seconds())
    sign = "-" if total < 0 else "+"
    hours, rem = divmod(abs(total), 3600)
    mins = rem // 60
    city = name.split("/")[-1].replace("_", " ")
    region = name.split("/")[0] if "/" in name else ""
    where = f"{city}, {region}" if region and region not in {"Etc"} else city
    return f"{where} (UTC{sign}{hours}:{mins:02d})"


def _build_choices() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for name in sorted(available_timezones()):
        # Legacy aliases ("US/Eastern") and the Etc/GMT+N family duplicate real
        # zones with confusing names — the Etc ones have their SIGN REVERSED by
        # the standard, so "Etc/GMT+5" is UTC-5 and would mislead anyone who
        # picked it.
        if name.startswith("Etc/") or "/" not in name:
            continue
        label = _offset_label(name)
        if label:
            out.append({"value": name, "label": label})
    # Sorted by offset, then by name: a picker you scroll should walk around the
    # world rather than jumping between continents alphabetically.
    out.sort(key=lambda c: (_sort_offset(c["value"]), c["label"]))
    out.append({"value": "UTC", "label": "UTC (no local time)"})
    return out


def _sort_offset(name: str) -> int:
    try:
        off = datetime.now(ZoneInfo(name)).utcoffset() or _ZERO
        return int(off.total_seconds())
    except Exception:  # noqa: BLE001
        return 0


_ZERO = timedelta(0)

# The markets we know about, as a FLOOR.
#
# `available_timezones()` reads the platform's IANA database, and on a system
# without `tzdata` it returns NOTHING — which would leave this list as "UTC" and
# only "UTC", strictly worse than the hand-written list it replaces. tzdata is
# pinned in requirements so this should never fire; it exists because the
# failure it guards is silent, and the guard costs fifteen lines.
_FALLBACK: list[dict[str, str]] = [
    {"value": "Europe/London", "label": "London, Europe (UTC+0:00)"},
    {"value": "Europe/Dublin", "label": "Dublin, Europe (UTC+0:00)"},
    {"value": "Europe/Paris", "label": "Paris, Europe (UTC+1:00)"},
    {"value": "Europe/Berlin", "label": "Berlin, Europe (UTC+1:00)"},
    {"value": "Europe/Madrid", "label": "Madrid, Europe (UTC+1:00)"},
    {"value": "Asia/Dubai", "label": "Dubai, Asia (UTC+4:00)"},
    {"value": "Asia/Kolkata", "label": "Kolkata, Asia (UTC+5:30)"},
    {"value": "Asia/Colombo", "label": "Colombo, Asia (UTC+5:30)"},
    {"value": "Asia/Singapore", "label": "Singapore, Asia (UTC+8:00)"},
    {"value": "Asia/Kuala_Lumpur", "label": "Kuala Lumpur, Asia (UTC+8:00)"},
    {"value": "Australia/Sydney", "label": "Sydney, Australia (UTC+10:00)"},
    {"value": "Pacific/Auckland", "label": "Auckland, Pacific (UTC+12:00)"},
    {"value": "America/Los_Angeles", "label": "Los Angeles, America (UTC-8:00)"},
    {"value": "America/Chicago", "label": "Chicago, America (UTC-6:00)"},
    {"value": "America/New_York", "label": "New York, America (UTC-5:00)"},
    {"value": "UTC", "label": "UTC (no local time)"},
]


def _choices() -> list[dict[str, str]]:
    built = _build_choices()
    # Fewer than fifty means the loop found nothing but its own hard-coded UTC.
    if len(built) < 50:
        log.warning(
            "timezone database looks empty (%d zones) - falling back to the "
            "curated list. Is tzdata installed?",
            len(built),
        )
        return _FALLBACK
    return built


CHOICES: list[dict[str, str]] = _choices()

_VALID = {c["value"] for c in CHOICES}


def is_valid(name: str) -> bool:
    """Any zone the platform can actually resolve.

    This used to ask "is it one of our sixteen". Now that the list is generated,
    membership and validity are different questions: a zone can be perfectly
    real and simply not offered — a legacy alias, or one added to the database
    after this server booted. Rejecting those would refuse a value that works.
    """
    if name in _VALID:
        return True
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return False
    return True


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
