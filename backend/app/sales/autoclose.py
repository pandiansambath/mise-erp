"""Close yesterday's drawer if nobody did.

A day left open never ends: its opening float never becomes the next morning's
opening, so the carry-forward chain breaks at the first busy night somebody
forgot. This runs after midnight and settles anything still open.

Three things it is careful about, because this writes to cash:

**It closes at the HOTEL's midnight, not the server's.** A restaurant in Chennai
rolls over five and a half hours before one in London. Using UTC would close a
Chennai day while service was still running, and leave a London day open for
most of the next.

**An auto-close is a GUESS and is labelled as one.** Nobody counted the till, so
it records the expected figure and sets `auto_closed`, and the UI shows that
differently from a real count. Silently presenting an assumption as a
measurement is how a cash system loses trust.

**It never overwrites a human.** Only days with no count at all are touched, so
running it twice, or late, changes nothing the second time.

Run daily (systemd timer):
    docker exec mise-backend-1 python -m app.sales.autoclose
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.timezones import hotel_today
from app.hotels.models import Hotel
from app.sales import cash, service

log = logging.getLogger("mise.sales.autoclose")


async def run_once() -> int:
    """Close every hotel's unclosed previous day. Returns how many were closed."""
    closed = 0
    async with AsyncSessionLocal() as db:
        hotels = (await db.execute(select(Hotel).where(Hotel.is_active.is_(True)))).scalars()
        for hotel in hotels:
            # "Yesterday" for THIS restaurant.
            yesterday = hotel_today(hotel) - timedelta(days=1)
            record = await service._get_day(db, hotel.id, yesterday)
            if record is None or record.cash_counted is not None:
                continue  # never traded, or a human already counted it

            summary = await service.day_summary(db, hotel.id, yesterday)
            expected = summary["expected_cash"]
            await cash.close_day(db, record, counted=expected, user_id=None, auto=True)
            closed += 1
            log.info(
                "auto-closed %s for hotel %s at expected %s",
                yesterday, hotel.id, expected,
                extra={"code": "DINE-B5001"},
            )
        await db.commit()
    log.info("auto-close finished: %d day(s)", closed, extra={"code": "DINE-B5002"})
    return closed


def main() -> None:
    print(f"days auto-closed: {asyncio.run(run_once())}")


if __name__ == "__main__":
    main()
