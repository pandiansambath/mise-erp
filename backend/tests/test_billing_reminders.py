"""Warning a restaurant before their access changes.

The email content is not what these test — the SCHEDULE is. A reminder that
fires every day for three days looks like broken software at exactly the moment
we are asking someone to trust us with a card, and a reminder that never fires
leaves them to discover the trial ended by finding the app shut.
"""
from datetime import UTC, datetime, timedelta

import pytest

from app.auth.models import Role
from app.billing import emails, reminders
from app.hotels.models import Hotel


async def _ok() -> bool:
    return True


@pytest.fixture
def sent(monkeypatch):
    """Capture emails instead of sending them.

    Records at CALL time rather than await time, because production uses
    fire-and-forget: the coroutine is handed to notify.fire() and never awaited
    by the caller. Closing it keeps pytest from warning about a coroutine that
    was never awaited.
    """
    box: list[tuple[str, str]] = []

    def _capture(to, subject, text, html=None):
        box.append((to, subject))
        return _ok()

    monkeypatch.setattr(emails.notify, "send_email", _capture)
    monkeypatch.setattr(emails.notify, "fire", lambda coro: coro.close())
    return box


async def _trial_hotel(db, days_out: int, **kw) -> Hotel:
    h = Hotel(
        name="Trial Palace",
        country="GB",
        base_currency="GBP",
        city="London",
        trial_ends_on=datetime.now(UTC).date() + timedelta(days=days_out),
        subscription_status=kw.pop("status", "trialing"),
        **kw,
    )
    db.add(h)
    await db.commit()
    await db.refresh(h)
    return h


@pytest.mark.asyncio
async def test_a_trial_ending_soon_is_warned_once_not_daily(db, make_user, sent) -> None:
    """The reason the marker column exists. Three days out, this hotel matches
    the query on all three days — it must still receive exactly one email."""
    hotel = await _trial_hotel(db, days_out=2)
    await make_user("owner@trial.test", Role.SUPER_ADMIN.value, hotel_id=hotel.id)

    first = await reminders.run_once()
    second = await reminders.run_once()
    third = await reminders.run_once()

    assert first == 1, "a trial ending in 2 days should be warned"
    assert (second, third) == (0, 0), "the same end date must never be warned twice"


@pytest.mark.asyncio
async def test_an_extended_trial_is_warned_again(db, make_user, sent) -> None:
    """A date, not a boolean: extending a trial must produce a NEW warning about
    the new date rather than silently skipping the hotel forever."""
    hotel = await _trial_hotel(db, days_out=1)
    await make_user("owner2@trial.test", Role.SUPER_ADMIN.value, hotel_id=hotel.id)
    assert await reminders.run_once() == 1

    hotel.trial_ends_on = datetime.now(UTC).date() + timedelta(days=2)
    await db.commit()
    assert await reminders.run_once() == 1, "the new end date deserves its own warning"


@pytest.mark.asyncio
async def test_distant_and_expired_trials_are_left_alone(db, make_user, sent) -> None:
    """Warning someone three weeks early is noise; chasing an already-expired
    trial every day forever is worse."""
    far = await _trial_hotel(db, days_out=30)
    await make_user("far@trial.test", Role.SUPER_ADMIN.value, hotel_id=far.id)
    gone = await _trial_hotel(db, days_out=-5)
    await make_user("gone@trial.test", Role.SUPER_ADMIN.value, hotel_id=gone.id)

    assert await reminders.run_once() == 0


@pytest.mark.asyncio
async def test_paying_customers_are_not_told_their_trial_is_ending(db, make_user, sent) -> None:
    """They already gave us a card. 'Your trial is ending, choose a plan' to
    someone who has chosen and paid reads as us losing track of their money."""
    hotel = await _trial_hotel(db, days_out=1, status="active")
    await make_user("paid@trial.test", Role.SUPER_ADMIN.value, hotel_id=hotel.id)

    assert await reminders.run_once() == 0


@pytest.mark.asyncio
async def test_only_owners_are_emailed(db, make_user, monkeypatch) -> None:
    """A cashier cannot update a card. Sending billing mail to the whole team is
    both noise and a small privacy leak about the restaurant's finances."""
    hotel = await _trial_hotel(db, days_out=1)
    await make_user("theowner@trial.test", Role.SUPER_ADMIN.value, hotel_id=hotel.id)
    await make_user("cashier@trial.test", Role.CASHIER.value, hotel_id=hotel.id)
    await make_user("chef@trial.test", Role.KITCHEN_MANAGER.value, hotel_id=hotel.id)

    recipients: list[str] = []

    def _capture(to, subject, text, html=None):
        recipients.append(to)
        return _ok()

    monkeypatch.setattr(emails.notify, "send_email", _capture)
    monkeypatch.setattr(emails.notify, "fire", lambda coro: coro.close())

    await emails.trial_ending(db, hotel, 1)
    assert recipients == ["theowner@trial.test"]


@pytest.mark.asyncio
async def test_a_billing_email_failure_cannot_break_billing(db, make_user, monkeypatch) -> None:
    """State changes must commit whether or not the mail provider is reachable.
    Losing an email is recoverable; losing the record of a failed payment is not."""
    hotel = await _trial_hotel(db, days_out=1)
    await make_user("owner3@trial.test", Role.SUPER_ADMIN.value, hotel_id=hotel.id)

    def _explode(*a, **k):
        raise RuntimeError("resend is down")

    monkeypatch.setattr(emails.notify, "fire", _explode)
    # None of these may raise.
    await emails.payment_failed(db, hotel, 2)
    await emails.trial_ending(db, hotel, 1)
    await emails.subscription_ended(db, hotel)
