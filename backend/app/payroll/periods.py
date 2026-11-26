"""The dates a run covers, and how they are written down.

Two spellings, on purpose. The LABEL (`2026-06`, `2026-W28`,
`2026-07-05→2026-08-04`) is what is stored and what advances are scheduled
against; a person is shown the other one, "1 to 7 Nov 2026".
"""
import re
from datetime import date, timedelta

_WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")
_CUSTOM_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})→(\d{4}-\d{2}-\d{2})$")

#: The most days one run can cover: a quarter. Long enough for anything a
#: restaurant pays by, short enough that a mistyped year cannot ask for one.
MAX_DAYS = 93

#: EVERY SHAPE A PAY PERIOD LABEL CAN TAKE: a month (2026-07), a week
#: (2026-W28), or a custom range (2026-07-01→2026-07-07).
#:
#: The endpoints that read a run back — list, approve-all, the payslip PDF —
#: each validated against month-or-week only. A custom run therefore created
#: its payslips happily and then could not be LISTED, let alone approved: the
#: request 422'd before it reached any of this code. The rows sat in DRAFT
#: forever, so their wages never reached Expenses and the month's labour cost
#: was quietly short by everyone paid on a custom range.
#:
#: One constant, because three copies of a pattern is how one of them ends up
#: not knowing about a third label shape.
PERIOD_PATTERN = r"^\d{4}-(\d{2}|W\d{2})$|^\d{4}-\d{2}-\d{2}→\d{4}-\d{2}-\d{2}$"


def is_weekly(period: str) -> bool:
    """'2026-W28' → True; '2026-06' → False."""
    return bool(_WEEK_RE.match(period))


def period_range(period: str) -> tuple[date, date]:
    """'2026-06' → calendar month; '2026-W28' → ISO week (Mon–Sun); a custom
    label → exactly what it says."""
    m = _WEEK_RE.match(period)
    if m:
        start = date.fromisocalendar(int(m[1]), int(m[2]), 1)
        return start, start + timedelta(days=6)
    m = _CUSTOM_RE.match(period)
    if m:
        return date.fromisoformat(m[1]), date.fromisoformat(m[2])
    year, month = (int(p) for p in period.split("-"))
    start = date(year, month, 1)
    nxt = date(year + (month == 12), (month % 12) + 1, 1)
    return start, nxt - timedelta(days=1)


def custom_label(start: date, end: date) -> str:
    return f"{start.isoformat()}→{end.isoformat()}"


def is_whole_month(start: date, end: date) -> bool:
    return start.day == 1 and start.year == end.year and start.month == end.month and (
        (end + timedelta(days=1)).day == 1
    )


def label_for(start: date, end: date) -> str:
    """The shortest label that means exactly these dates."""
    if is_whole_month(start, end):
        return f"{start.year:04d}-{start.month:02d}"
    if start.weekday() == 0 and (end - start).days == 6:
        iso = start.isocalendar()
        return f"{iso.year:04d}-W{iso.week:02d}"
    return custom_label(start, end)


def say_day(d: date, *, year: bool = True) -> str:
    """"5 Nov 2026" — how a person says a date. (Not `%-d`: that is glibc-only.)"""
    return f"{d.day} {d:%b %Y}" if year else f"{d.day} {d:%b}"


def say_range(start: date, end: date) -> str:
    """"November 2026", "5 Nov 2026", "1 to 7 Nov 2026", "28 Oct to 3 Nov 2026".

    "to" and not a dash: the payslip's font has no en dash, and a hyphen
    between two dates reads as part of them.
    """
    if start == end:
        return say_day(start)
    if is_whole_month(start, end):
        return f"{start:%B %Y}"
    if (start.year, start.month) == (end.year, end.month):
        return f"{start.day} to {say_day(end)}"
    if start.year == end.year:
        return f"{say_day(start, year=False)} to {say_day(end)}"
    return f"{say_day(start)} to {say_day(end)}"


def next_range(start: date, end: date) -> tuple[date, date]:
    """The dates that come straight after these, of the same kind.

    A whole month is followed by the next whole month, whatever its length.
    Anything else is followed by the same number of days.
    """
    nxt = end + timedelta(days=1)
    if is_whole_month(start, end):
        return period_range(f"{nxt.year:04d}-{nxt.month:02d}")
    return nxt, nxt + (end - start)


def days_between(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]
