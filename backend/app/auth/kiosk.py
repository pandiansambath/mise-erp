"""The tablet by the door.

A restaurant wants a screen on the wall that staff tap to clock in and out. It
cannot be somebody's login: shift workers share it, it is never locked, and
anyone walking past can touch it. So it is its own kind of account.

What that means in practice, and why:

**It is not a person.** One per restaurant, named for the device rather than a
human, so nobody is tempted to "just use the manager's login on the tablet" —
which is how a payroll screen ends up facing a dining room.

**Its permissions are sealed.** `Role.KIOSK`'s envelope is exactly its default
list, so no custom role and no toggle can widen it. It can record attendance
and read staff names to display. It cannot see wages, money, or reports.

**Its password can be rotated but never recovered.** Anybody can see this
screen, so a password reset flow reachable FROM it would be a door with the key
taped to it. Rotation happens in the app, by somebody who is already trusted.

**Email is synthetic.** A kiosk has no inbox, so verification and password
reset by email are meaningless for it — the address exists only because logins
are keyed by one, and it is marked verified at creation for that reason.
"""
from __future__ import annotations

import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Role, User
from app.auth.service import create_user
from app.core.security import hash_password

# Unambiguous on a tablet keyboard: no O/0, no l/1/I. This gets typed by
# somebody standing up, in a hurry, possibly with wet hands.
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _passphrase() -> str:
    """A short, readable password. Length beats cleverness here — it is typed
    once per device and then remembered by the browser."""
    return "-".join(
        "".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(3)
    )


def kiosk_email(hotel_id: uuid.UUID) -> str:
    """A stable synthetic address, one per restaurant.

    Deterministic so a second call finds the existing kiosk rather than
    quietly creating a rival one.
    """
    return f"kiosk+{hotel_id}@kiosk.dineai.local"


async def get_kiosk(db: AsyncSession, hotel_id: uuid.UUID) -> User | None:
    rows = await db.execute(
        select(User).where(User.hotel_id == hotel_id, User.role == Role.KIOSK.value)
    )
    return rows.scalars().first()


async def ensure_kiosk(db: AsyncSession, hotel_id: uuid.UUID) -> tuple[User, str]:
    """Create the restaurant's kiosk login, or rotate its password.

    Returns the account and the plain password — the ONLY time it is ever
    readable. It is hashed on the way in and cannot be recovered afterwards,
    which is the point: a screen anybody can reach must not be able to reveal
    its own credentials.
    """
    password = _passphrase()
    kiosk = await get_kiosk(db, hotel_id)

    if kiosk is None:
        kiosk = await create_user(
            db,
            kiosk_email(hotel_id),
            password,
            Role.KIOSK.value,
            hotel_id,
            preferred_name="Attendance tablet",
        )
        # No inbox exists, so the verify-gate would lock it out for ever.
        kiosk.email_verified = True
        await db.commit()
        await db.refresh(kiosk)
        return kiosk, password

    kiosk.password_hash = hash_password(password)
    kiosk.is_active = True
    kiosk.email_verified = True
    await db.commit()
    await db.refresh(kiosk)
    return kiosk, password
