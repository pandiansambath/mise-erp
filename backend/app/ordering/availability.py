"""Is this dish orderable right now, and if not, what do we tell the diner?

    "super admin can... mark as out of stock, or over, or not served, only
     served at this particular time etc."

Four states and a clock, kept in one place so the diner's page, the kitchen and
the owner's menu can never disagree about whether the dosa is on.

The rule underneath all of it: **say why, and say when it is back.** A dish that
silently vanishes from a menu makes a diner think the restaurant does not do it;
a dish that says "breakfast only — back at 7am" makes them come back tomorrow.
Hiding is the lazy option and it costs the hotel a sale.
"""
from __future__ import annotations

from datetime import date as date_type
from datetime import time as time_type

AVAILABLE = "available"
OUT_OF_STOCK = "out_of_stock"
FINISHED_TODAY = "finished_today"
NOT_SERVED = "not_served"

STATES = (AVAILABLE, OUT_OF_STOCK, FINISHED_TODAY, NOT_SERVED)


def effective_state(availability: str, sold_out_on: date_type | None, today: date_type) -> str:
    """`finished_today` expires on its own.

    Nobody comes in at 6am to un-tick yesterday's sold-out biryani, and if the
    software needs them to then the feature quietly rots into "everything is off
    the menu". A flag with no expiry is a chore with a delay on it.
    """
    if availability == FINISHED_TODAY and sold_out_on is not None and sold_out_on < today:
        return AVAILABLE
    return availability or AVAILABLE


def within_hours(now: time_type, serve_from: time_type | None, serve_to: time_type | None) -> bool:
    """Is the kitchen making this at this hour?

    Handles a window that crosses midnight (22:00–02:00 for a late menu), which
    is otherwise a silent bug for exactly the hotels that need it most.
    """
    if serve_from is None and serve_to is None:
        return True
    if serve_from is None:
        return now <= (serve_to or now)
    if serve_to is None:
        return now >= serve_from
    if serve_from <= serve_to:
        return serve_from <= now <= serve_to
    return now >= serve_from or now <= serve_to  # wraps past midnight


def orderable(item, today: date_type, now: time_type) -> bool:
    """Can a diner add this to their basket this second?"""
    if effective_state(item.availability, item.sold_out_on, today) != AVAILABLE:
        return False
    return within_hours(now, item.serve_from, item.serve_to)


def _hhmm(t: time_type | None) -> str:
    return t.strftime("%H:%M") if t else ""


def why_not(item, today: date_type, now: time_type) -> str | None:
    """What the diner is told, in a sentence that helps them.

    Returns None when the dish is orderable. Everything else names the reason
    AND, wherever we can, when it comes back — the difference between "no" and
    "not yet".
    """
    state = effective_state(item.availability, item.sold_out_on, today)
    if state == OUT_OF_STOCK:
        return "Out of stock today"
    if state == FINISHED_TODAY:
        return "Finished for today — back tomorrow"
    if state == NOT_SERVED:
        return "Not on the menu"
    if not within_hours(now, item.serve_from, item.serve_to):
        if item.serve_from and item.serve_to:
            return f"Served {_hhmm(item.serve_from)}–{_hhmm(item.serve_to)}"
        if item.serve_from:
            return f"Served from {_hhmm(item.serve_from)}"
        return f"Served until {_hhmm(item.serve_to)}"
    return None
