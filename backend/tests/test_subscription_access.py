"""What an unpaid subscription does — and, more importantly, what it never does.

The rule these protect: we take away spending and new commitments, never a
restaurant's access to its own records. Getting that backwards would strand a
kitchen mid-service over an expired card.
"""
from datetime import UTC, datetime, timedelta

from app.hotels import access


class _Hotel:
    def __init__(self, status="active", trial_ends_on=None):
        self.subscription_status = status
        self.trial_ends_on = trial_ends_on


def test_reading_is_never_blocked_however_bad_the_billing() -> None:
    for status in ("past_due", "unpaid", "canceled", "incomplete_expired"):
        hotel = _Hotel(status)
        for perm in ("inventory:read", "reports:read", "payroll:read", "rota:read"):
            assert access.blocks(hotel, perm) is None, (status, perm)


def test_spending_and_commitments_stop_when_unpaid() -> None:
    hotel = _Hotel("past_due")
    for perm in ("ai:use", "indent:write", "payroll:write", "orders:write"):
        reason = access.blocks(hotel, perm)
        assert reason, perm
        # the message must carry the fix, not just the refusal
        assert "Your plan" in reason


def test_a_healthy_account_is_untouched() -> None:
    for status in ("active", "trialing", "free"):
        hotel = _Hotel(status, trial_ends_on=datetime.now(UTC).date() + timedelta(days=3))
        assert access.blocks(hotel, "ai:use") is None, status


def test_a_trial_that_ran_out_counts_as_lapsed() -> None:
    expired = _Hotel("trialing", trial_ends_on=datetime.now(UTC).date() - timedelta(days=1))
    assert access.is_lapsed(expired) is True
    assert "trial has finished" in (access.blocks(expired, "ai:use") or "")

    running = _Hotel("trialing", trial_ends_on=datetime.now(UTC).date() + timedelta(days=1))
    assert access.is_lapsed(running) is False


def test_trial_days_left_is_none_when_not_on_trial() -> None:
    assert access.trial_days_left(_Hotel("active")) is None
    soon = _Hotel("trialing", trial_ends_on=datetime.now(UTC).date() + timedelta(days=5))
    assert access.trial_days_left(soon) == 5
    # never negative — an expired trial reads as zero, not minus four
    past = _Hotel("trialing", trial_ends_on=datetime.now(UTC).date() - timedelta(days=4))
    assert access.trial_days_left(past) == 0
