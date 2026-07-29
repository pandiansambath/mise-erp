"""What a lapsed subscription actually means.

`subscription_status` existed but changed nothing: a hotel marked `past_due`
kept every feature, which is a revenue hole on one side and a nasty surprise on
the other.

The shape of the rule matters more than the rule:

* **Never lock people out of their own data.** Reading always works, whatever
  the billing state. A restaurant mid-service that can't see tonight's rota
  because a card expired is a disaster we caused, and it converts nobody.
* **Stop the things that COST us**, and stop new commitments. AI is metered
  spend; new orders and payroll runs create obligations.
* **Say why, in one line, with the fix.** A blocked action that doesn't explain
  itself reads as a bug and generates a support ticket instead of a payment.
"""
from __future__ import annotations

from datetime import UTC, date, datetime

# Everything still works.
HEALTHY = {"active", "trialing", "free"}
# Card failed or invoice unpaid. Grace: read everything, commit nothing.
GRACE = {"past_due", "unpaid", "incomplete"}
# Gone. Same as grace — we still never hide their data from them.
ENDED = {"canceled", "cancelled", "incomplete_expired"}

# Permissions that create cost or commitment while unpaid.
_BLOCKED_WHEN_LAPSED = (
    "ai:use",
    "indent:write",
    "indent:approve",
    "payroll:write",
    "orders:write",
    "vendor_payments:write",
)


def trial_days_left(hotel) -> int | None:
    """Days remaining, or None when this hotel isn't on a trial."""
    ends = getattr(hotel, "trial_ends_on", None)
    if not ends:
        return None
    return max(0, (ends - datetime.now(UTC).date()).days)


def is_lapsed(hotel) -> bool:
    """Billing is unhealthy, or the trial ran out without converting."""
    status = (getattr(hotel, "subscription_status", "") or "free").lower()
    if status in GRACE or status in ENDED:
        return True
    if status == "trialing":
        ends: date | None = getattr(hotel, "trial_ends_on", None)
        return bool(ends and ends < datetime.now(UTC).date())
    return False


def blocks(hotel, permission: str) -> str | None:
    """The reason this action is blocked, or None if it may proceed.

    Read permissions are never blocked — see the module docstring.
    """
    if not is_lapsed(hotel):
        return None
    if permission not in _BLOCKED_WHEN_LAPSED:
        return None
    status = (getattr(hotel, "subscription_status", "") or "").lower()
    if status in ENDED:
        return (
            "Your subscription has ended, so new orders, payroll and AI are paused. "
            "Everything you've recorded is still here and still readable — restart "
            "any time from Your plan."
        )
    if status == "trialing":
        return (
            "Your free trial has finished. Pick a plan on Your plan to carry on — "
            "nothing has been deleted."
        )
    return (
        "We couldn't take the last payment, so new orders, payroll and AI are paused. "
        "Your data is untouched — update the card on Your plan and it all comes back."
    )
