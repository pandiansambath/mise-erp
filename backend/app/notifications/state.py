"""Reading and writing one person's notification state.

Every query here is scoped to BOTH the user and their hotel. The user alone
would do today — a login belongs to one restaurant — but a key is only ever
meaningful inside the feed it came from, and the hotel in the WHERE clause is
what makes "another restaurant's state can never reach this bell" a property of
the query rather than of how logins happen to work this year.
"""
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.notifications.models import NotificationState
from app.notifications.pipeline import MUTE_PREFIX, Mark

# RETENTION IS NOT OPTIONAL.
#
# `act:<uuid>` keys point at audit events that scroll out of the feed within
# hours and can never come back — so a "read" row for one is dead on arrival.
# A low-stock key goes the same way once the item is restocked, and if the
# item runs low AGAIN that is a new episode and should arrive unread, not
# inherit a dismissal from last month.
#
# So on every write, this person's rows for keys that are no longer in their
# feed are deleted. The grace day only absorbs a feed that blinked — a row has
# to be both gone from the feed AND untouched for a day before it goes. Mutes
# are a preference, not a notification, and are never pruned.
GRACE = timedelta(days=1)


async def load(db: AsyncSession, user: User) -> dict[str, Mark]:
    rows = await db.execute(
        select(
            NotificationState.key,
            NotificationState.read_at,
            NotificationState.dismissed_at,
        ).where(
            NotificationState.user_id == user.id,
            NotificationState.hotel_id == user.hotel_id,
        )
    )
    return {
        key: Mark(read=read_at is not None, dismissed=dismissed_at is not None)
        for key, read_at, dismissed_at in rows.all()
    }


async def write(
    db: AsyncSession,
    user: User,
    keys: Iterable[str],
    *,
    live: set[str],
    read: bool | None = None,
    dismissed: bool | None = None,
) -> None:
    """Set read and/or dismissed on these keys for this person, then tidy up.

    `None` leaves that half alone. One statement for the lot: mark-all-read on a
    busy bell is a hundred keys, and a hundred round trips to London is a
    spinner nobody asked for.

    Putting something away counts as having seen it — a dismissed row that
    came back unread after an undo would be asking to be read twice.
    """
    keys = list(dict.fromkeys(keys))  # order kept, duplicates out
    if not keys:
        return
    now = datetime.now(UTC)

    def stamps_read(key: str) -> bool:
        return bool(read) or (bool(dismissed) and not key.startswith(MUTE_PREFIX))

    stmt = insert(NotificationState).values(
        [
            {
                "id": uuid.uuid4(),
                "hotel_id": user.hotel_id,
                "user_id": user.id,
                "key": k,
                "read_at": now if stamps_read(k) else None,
                "dismissed_at": now if dismissed else None,
                "updated_at": now,
            }
            for k in keys
        ]
    )
    # The FIRST read is the fact worth keeping, so a repeat keeps the old time.
    set_: dict = {"hotel_id": stmt.excluded.hotel_id, "updated_at": now}
    if read is False:
        set_["read_at"] = None
    elif read is True or dismissed is True:
        set_["read_at"] = func.coalesce(NotificationState.read_at, stmt.excluded.read_at)
    if dismissed is True:
        set_["dismissed_at"] = func.coalesce(
            NotificationState.dismissed_at, stmt.excluded.dismissed_at
        )
    elif dismissed is False:
        set_["dismissed_at"] = None
    await db.execute(
        stmt.on_conflict_do_update(constraint="uq_notification_state_user_key", set_=set_)
    )

    mine = and_(
        NotificationState.user_id == user.id,
        NotificationState.hotel_id == user.hotel_id,
    )
    # A row that says nothing is not state. An unmuted area has nothing left
    # to say even if a read time is still on it.
    await db.execute(
        delete(NotificationState).where(
            mine,
            NotificationState.dismissed_at.is_(None),
            or_(
                NotificationState.read_at.is_(None),
                NotificationState.key.startswith(MUTE_PREFIX),
            ),
        )
    )
    # Retention — see GRACE above.
    stale = [
        mine,
        ~NotificationState.key.startswith(MUTE_PREFIX),
        NotificationState.updated_at < now - GRACE,
    ]
    if live:
        stale.append(NotificationState.key.notin_(sorted(live)))
    await db.execute(delete(NotificationState).where(*stale))
    await db.commit()
