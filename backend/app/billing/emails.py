"""Telling a customer their access is about to change.

Everything else in billing was already correct — a failed card sets past_due, a
cancelled subscription closes the door — but all of it happened *silently*. The
first a restaurant knew about an expired card was a screen that stopped working
mid-service, and the first they knew about a trial ending was the same. That is
how you lose a customer who would happily have paid: not by charging them, by
surprising them.

Every message here is sent to the owners (SUPER_ADMIN), because a manager cannot
fix a card. All of them are best-effort: billing state must commit whether or not
the mail provider is reachable, so nothing in this module is allowed to raise.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Role, User
from app.core import notify
from app.core.config import settings

log = logging.getLogger("mise.billing.email")


async def _owners(db: AsyncSession, hotel_id) -> list[User]:
    """Active owners of this hotel. Managers cannot update a card, so telling
    them is noise; telling nobody is worse."""
    rows = await db.execute(
        select(User).where(
            User.hotel_id == hotel_id,
            User.role == Role.SUPER_ADMIN.value,
            User.is_active.is_(True),
        )
    )
    return list(rows.scalars())


def _billing_url() -> str:
    return f"{(settings.app_base_url or '').rstrip('/')}/settings/billing"


async def _send_to_owners(db: AsyncSession, hotel, subject: str, text: str, html: str) -> None:
    try:
        for owner in await _owners(db, hotel.id):
            notify.fire(notify.send_email(owner.email, subject, text, html=html))
    except Exception:  # noqa: BLE001 — never let a notification break billing state
        log.exception("could not queue billing email", extra={"code": "DINE-B4001"})


async def payment_failed(db: AsyncSession, hotel, attempt_count: int = 1) -> None:
    """A card was declined. The app deliberately stays open (past_due is a grace
    state), so the tone is 'fix this when you can', not 'you are locked out' —
    which would be both alarming and untrue."""
    name = hotel.name or "your restaurant"
    await _send_to_owners(
        db,
        hotel,
        subject="Your DineAI payment didn't go through",
        text=(
            f"We couldn't take this month's payment for {name}. Nothing has been "
            "switched off — your team can carry on as normal while you update the "
            f"card. Update it here: {_billing_url()}"
        ),
        html=notify.render_email(
            badge="💳 Payment",
            heading="Your card was declined",
            intro=(
                f"We couldn't take this month's payment for <b>{name}</b>. "
                "Nothing has been switched off and your team can carry on as "
                "normal — this is just a heads-up so it doesn't become a problem "
                "later. Most declines are an expired card or a bank block."
            ),
            rows=[
                ("Restaurant", name),
                ("Plan", (hotel.plan or "—").title()),
                ("Attempt", str(attempt_count)),
            ],
            cta_label="Update payment method",
            cta_url=_billing_url(),
            accent="#d97742",
            footnote=(
                "We'll retry automatically over the next few days. If it keeps "
                "failing we'll email again before anything changes."
            ),
        ),
    )


async def trial_ending(db: AsyncSession, hotel, days_left: int) -> None:
    """The trial is nearly up. Says exactly what happens next and when, because
    'your trial is ending' without a date is just anxiety."""
    name = hotel.name or "your restaurant"
    # Not strftime("%-d") — that padding flag is glibc-only and raises on
    # Windows, so a dev running the suite locally would see a crash the server
    # never shows. Build it by hand instead.
    when = (
        f"{hotel.trial_ends_on.day} {hotel.trial_ends_on.strftime('%B')}"
        if hotel.trial_ends_on
        else "shortly"
    )
    day_word = "today" if days_left <= 0 else f"in {days_left} day{'s' if days_left != 1 else ''}"
    await _send_to_owners(
        db,
        hotel,
        subject=f"Your DineAI trial ends {day_word}",
        text=(
            f"Your free trial for {name} ends {day_word} ({when}). Your data stays "
            "exactly where it is either way — choose a plan to keep using DineAI: "
            f"{_billing_url()}"
        ),
        html=notify.render_email(
            badge="⏳ Trial",
            heading=f"Your trial ends {day_word}",
            intro=(
                f"Your free trial for <b>{name}</b> ends on {when}. Nothing is "
                "deleted when it does — your recipes, stock and staff records stay "
                "exactly where they are, and picking a plan turns everything back "
                "on where you left it."
            ),
            rows=[
                ("Restaurant", name),
                ("Trial ends", when),
                ("Current plan", (hotel.plan or "—").title()),
            ],
            cta_label="Choose a plan",
            cta_url=_billing_url(),
            accent="#059669",
            footnote="Questions about which plan fits? Just reply to this email.",
        ),
    )


async def subscription_ended(db: AsyncSession, hotel) -> None:
    """The subscription is gone and the door has closed. Must be unambiguous
    about the one thing people actually panic over: their data."""
    name = hotel.name or "your restaurant"
    await _send_to_owners(
        db,
        hotel,
        subject="Your DineAI subscription has ended",
        text=(
            f"The DineAI subscription for {name} has ended and sign-in is now "
            "closed. Your data has NOT been deleted — restarting a plan restores "
            f"access to everything: {_billing_url()}"
        ),
        html=notify.render_email(
            badge="🔒 Subscription ended",
            heading="Your subscription has ended",
            intro=(
                f"The DineAI subscription for <b>{name}</b> has ended, so sign-in "
                "is closed for now. <b>Your data has not been deleted.</b> Every "
                "recipe, supplier price and staff record is still here, and "
                "restarting a plan puts you back exactly where you were."
            ),
            rows=[("Restaurant", name), ("Last plan", (hotel.plan or "—").title())],
            cta_label="Restart my plan",
            cta_url=_billing_url(),
            accent="#e11d48",
        ),
    )
