"""Locking a device to the attendance screen, with a PIN.

The owner's design, and it is a better one than a separate login: a manager
opens the attendance view on whatever tablet is to hand, types the restaurant's
PIN, and that browser tab drops to attendance-only until the PIN is typed
again. Nothing to provision, nothing to remember, no second credential to leak.

The important part is that this is not a UI trick.

**The tab's session is REPLACED, not hidden.** Unlocking swaps that tab's token
for a KIOSK-scoped one — the same sealed role the device account uses, which
can record a punch and read staff names and nothing else. So a tablet left on
the counter is not a manager's session behind a modal somebody can escape; the
credential in that tab genuinely cannot reach payroll, however hard it is
poked. Closing the tab, clearing storage, opening devtools — none of it helps,
because there is nothing better in there to find.

**Leaving needs the PIN too**, because otherwise the lock is decoration.

**The PIN is hashed** and set only by someone who can already prove they are
the owner, with their password. It is four to eight digits, typed in public,
next to a door — treat it like a door code, not a password.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Role, User
from app.core.security import create_access_token, hash_password, verify_password
from app.hotels.models import Hotel

# Long enough not to be guessed by a bored customer, short enough to type with
# one hand while carrying plates.
MIN_PIN = 4
MAX_PIN = 8

# A shift, not a day. The tablet re-unlocks each morning, which is the moment
# somebody notices it has been sitting there all night.
KIOSK_TOKEN_MINUTES = 14 * 60


class PinError(ValueError):
    """The PIN is missing, malformed, or wrong."""


def check_shape(pin: str) -> str:
    pin = (pin or "").strip()
    if not pin.isdigit():
        raise PinError("The PIN must be digits only.")
    if not (MIN_PIN <= len(pin) <= MAX_PIN):
        raise PinError(f"The PIN must be {MIN_PIN} to {MAX_PIN} digits.")
    return pin


async def set_pin(db: AsyncSession, hotel: Hotel, pin: str) -> None:
    """Set or change it. The caller must have already re-checked the password —
    a code that unlocks a door should not be changeable by whoever happens to
    be sitting at an unlocked screen."""
    hotel.attendance_pin_hash = hash_password(check_shape(pin))
    await db.commit()


def has_pin(hotel: Hotel) -> bool:
    return bool(hotel.attendance_pin_hash)


def verify(hotel: Hotel, pin: str) -> bool:
    if not hotel.attendance_pin_hash:
        return False
    try:
        return verify_password((pin or "").strip(), hotel.attendance_pin_hash)
    except Exception:  # noqa: BLE001 — a malformed hash must read as "wrong"
        return False


async def kiosk_token_for(db: AsyncSession, hotel_id: uuid.UUID) -> str | None:
    """A KIOSK-scoped token for this restaurant.

    Issued against the hotel's own attendance identity rather than the person
    who typed the PIN, so nothing in the tab traces back to their access. If
    the restaurant has no kiosk account yet, one is created — the PIN is the
    only thing anybody needs to know.
    """
    from app.auth import kiosk as kiosk_service

    account = await kiosk_service.get_kiosk(db, hotel_id)
    if account is None:
        account, _ = await kiosk_service.ensure_kiosk(db, hotel_id)
    return create_access_token(
        str(account.id), Role.KIOSK.value, expires_minutes=KIOSK_TOKEN_MINUTES
    )


def can_manage_pin(user: User) -> bool:
    """Only the owner sets the door code."""
    return user.role == Role.SUPER_ADMIN.value
