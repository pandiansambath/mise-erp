"""Close any recent drawer nobody counted.

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
from app.sales.models import DailySales

log = logging.getLogger("mise.sales.autoclose")


#: How far back a missed night is recovered. A few nights is the realistic
#: failure — a crash, a deploy, a box that was down — and reaching further
#: would start settling history nobody is thinking about.
RECOVER_DAYS = 7


def _load_every_model() -> None:
    """Register every table before touching any of them.

    ⚠️ THIS JOB CRASHED EVERY NIGHT IT HAD WORK TO DO:

        NoReferencedTableError: Foreign key associated with column
        'cash_events.changed_by' could not find table 'users'

    Inside the web app every router is imported, so every model is registered
    and every foreign key resolves. Run on its own (`python -m
    app.sales.autoclose`) it only imported the handful of modules above, so the
    first WRITE of a cash event — the only thing it exists to do — failed on
    `users`. On nights with nothing to close it wrote nothing, so systemd
    logged "Finished" every night and nobody saw it.

    Discovered rather than listed. A hand-maintained list here is exactly the
    kind that drifts: the next model added anywhere would bring this back.
    """
    import importlib
    import pkgutil

    import app

    for mod in pkgutil.walk_packages(app.__path__, "app."):
        if mod.name.endswith(".models") or mod.name.endswith("_models"):
            importlib.import_module(mod.name)


async def run_once() -> int:
    """Close every hotel's uncounted recent days. Returns how many were closed.

    ⚠️ NOT ONLY YESTERDAY. It used to look at exactly one day — "yesterday" —
    so a single missed night stranded that day forever: by the next run,
    "yesterday" was a different date. On his restaurant 25 and 26 September
    were still open four days later for precisely that reason.

    OLDEST FIRST, because each close is the next day's opening. Settling the
    26th before the 25th would compute the 26th from a float that was about to
    change underneath it.
    """
    _load_every_model()
    closed = 0
    async with AsyncSessionLocal() as db:
        hotels = (await db.execute(select(Hotel).where(Hotel.is_active.is_(True)))).scalars()
        for hotel in list(hotels):
            # "Today" for THIS restaurant — its midnight, not the server's.
            today = hotel_today(hotel)
            since = today - timedelta(days=RECOVER_DAYS)
            open_days = (
                await db.execute(
                    select(DailySales)
                    .where(
                        DailySales.hotel_id == hotel.id,
                        DailySales.date < today,
                        DailySales.date >= since,
                        DailySales.cash_counted.is_(None),
                    )
                    .order_by(DailySales.date.asc())
                )
            ).scalars().all()

            for record in open_days:
                summary = await service.day_summary(db, hotel.id, record.date)
                expected = summary["expected_cash"]
                await cash.close_day(db, record, counted=expected, user_id=None, auto=True)
                # Flushed per day, so the NEXT day's carry reads this close.
                await db.flush()
                closed += 1
                log.info(
                    "auto-closed %s for hotel %s at expected %s",
                    record.date, hotel.id, expected,
                    extra={"code": "DINE-B5001"},
                )
        await db.commit()
    log.info("auto-close finished: %d day(s)", closed, extra={"code": "DINE-B5002"})
    return closed


def main() -> None:
    print(f"days auto-closed: {asyncio.run(run_once())}")


if __name__ == "__main__":
    main()
