"""The daily "your trial is ending" sweep.

Stripe fires `trial_will_end` only for trials Stripe knows about. Ours start the
moment a restaurant signs up, long before anyone has entered a card, so nothing
would ever warn those hotels — they would simply arrive one morning to an app
that had stopped working.

Run once a day (systemd timer, same as the backup):

    docker exec mise-backend-1 python -m app.billing.reminders

Two properties matter more than the email itself:

* **Idempotent.** `trial_reminder_sent_on` records the trial end date we warned
  about, so running the job five times in a day sends one email. Retrying after
  a failure is safe.
* **It cannot take the app down.** It runs out-of-process, so a mail provider
  outage delays a reminder and nothing else.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.billing import emails
from app.core.database import AsyncSessionLocal
from app.hotels.models import Hotel

log = logging.getLogger("mise.billing.reminders")

# How far ahead to warn. Enough time to talk to a bank; not so far that the
# email is forgotten by the time it matters.
WARN_DAYS = 3


async def run_once() -> int:
    """Warn every hotel whose trial ends within WARN_DAYS. Returns how many were
    emailed."""
    # The trial deadline is a calendar date, so "today" is taken in UTC here and
    # the cutoff is generous by design: warning someone a few hours early is
    # harmless, warning them late is the whole failure we are fixing.
    today = datetime.now(UTC).date()
    cutoff = today + timedelta(days=WARN_DAYS)

    sent = 0
    async with AsyncSessionLocal() as db:
        rows = await db.execute(
            select(Hotel).where(
                Hotel.trial_ends_on.is_not(None),
                Hotel.trial_ends_on <= cutoff,
                Hotel.trial_ends_on >= today,
                Hotel.is_active.is_(True),
                # Already paying? Then the trial ending changes nothing for them.
                Hotel.subscription_status.notin_(("active", "canceled")),
            )
        )
        for hotel in rows.scalars():
            if hotel.trial_reminder_sent_on == hotel.trial_ends_on:
                continue  # already warned about THIS end date
            days_left = (hotel.trial_ends_on - today).days
            await emails.trial_ending(db, hotel, days_left)
            # Mark against the end date, not today: if the trial is later
            # extended, the new date is a new warning rather than a silent skip.
            hotel.trial_reminder_sent_on = hotel.trial_ends_on
            sent += 1
        await db.commit()

    log.info("trial reminders sent: %d", sent, extra={"code": "DINE-B4002"})
    return sent


def main() -> None:
    print(f"trial reminders sent: {asyncio.run(run_once())}")


if __name__ == "__main__":
    main()
