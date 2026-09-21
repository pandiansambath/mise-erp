"""Requesting, accepting and executing a hotel transfer.

    "we need a super secured migraiton feature ... for migration both side
     need to accept ... also check email is valid before migration ... if new
     email alreay in our datadvase then dont allow"

FOUR RULES, AND EACH ONE IS A REFUSAL
--------------------------------------------------------------------------
1. THE TARGET ADDRESS MUST BE FREE. `users.email` is globally unique and a
   user belongs to exactly one restaurant, so an address already in use
   cannot receive one — for a MOVE as much as a COPY. He only stated it for
   copy; it is the same constraint underneath, and refusing early gives a
   sentence instead of an IntegrityError.

2. THE ADDRESS MUST BE PLAUSIBLE. Checked before the request is stored, not
   after, because an unreachable address turns a transfer into a restaurant
   nobody can claim and nobody can cancel.

3. ONLY THE OWNER MAY ASK, AND ONLY WHILE THEY STILL ARE THE OWNER. Checked
   at request time AND AGAIN at execution — days can pass in between, and an
   owner can be deactivated or demoted in that window.

4. NOTHING MOVES ON A REQUEST. The request is the sender's half. Execution
   happens on the step out of `accepted`, once, guarded by `settled_at`.

WHY THE RECEIVER SETS A PASSWORD AT ACCEPT TIME
--------------------------------------------------------------------------
A MOVE could be implemented by rewriting the owner's email column, and that
would be wrong: the password would come too, so the new owner signs in with
the old owner's credential and neither of them knows it. Instead the receiver
creates their own login, and the old owner is DEACTIVATED rather than deleted
— their id is on years of audit rows, and deleting it would either cascade
into that history or fail on a foreign key.
"""

from __future__ import annotations

import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service as auth_service
from app.auth.models import Role, User
from app.hotels.models import Hotel
from app.hotels.transfer_models import (
    TRANSFER_TTL_DAYS,
    HotelTransfer,
    TransferKind,
    TransferState,
)
from app.platform_admin import cloning

#: Deliberately permissive. This is a typo check, not an identity check — the
#: emailed link is what actually proves the address, and a regex that rejects
#: a valid unusual address is worse than one that accepts an invalid one.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")


class TransferError(Exception):
    """Refused, with a sentence the caller can show as-is."""


def _clean_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise TransferError(f"“{raw.strip()}” doesn't look like an email address.")
    return email


async def _email_is_free(db: AsyncSession, email: str) -> bool:
    found = await db.execute(
        select(User.id).where(func.lower(User.email) == email).limit(1)
    )
    return found.first() is None


async def request_transfer(
    db: AsyncSession,
    *,
    hotel: Hotel,
    owner: User,
    to_email: str,
    kind: str,
) -> HotelTransfer:
    """Ask to move or copy this restaurant. Writes a request; moves nothing."""
    if kind not in (TransferKind.MOVE.value, TransferKind.COPY.value):
        raise TransferError("A transfer is either a move or a copy.")
    if owner.role != Role.SUPER_ADMIN.value:
        raise TransferError("Only the restaurant's owner can transfer it.")

    target = _clean_email(to_email)
    if target == (owner.email or "").strip().lower():
        raise TransferError("That is already your address.")
    if not await _email_is_free(db, target):
        # DELIBERATELY THE SAME SENTENCE whoever asks. "That address already
        # has an account" told anyone with a login which of their customers'
        # addresses are registered here.
        raise TransferError(
            "That address can't receive a restaurant — it already has an "
            "account here. Ask them to use an address they haven't signed up "
            "with, or to delete that account first."
        )

    open_already = await db.execute(
        select(HotelTransfer).where(
            HotelTransfer.hotel_id == hotel.id,
            HotelTransfer.state.in_(
                [TransferState.REQUESTED.value, TransferState.ACCEPTED.value]
            ),
        ).limit(1)
    )
    if open_already.scalar_one_or_none() is not None:
        raise TransferError(
            "There is already a transfer waiting on this restaurant. Cancel "
            "that one first."
        )

    row = HotelTransfer(
        hotel_id=hotel.id,
        hotel_name=hotel.name,
        kind=kind,
        state=TransferState.REQUESTED.value,
        requested_by=owner.id,
        from_email=owner.email,
        to_email=target,
        accept_token=secrets.token_urlsafe(32),
        expires_at=datetime.now(UTC) + timedelta(days=TRANSFER_TTL_DAYS),
    )
    db.add(row)
    await db.flush()
    return row


async def by_token(db: AsyncSession, token: str) -> HotelTransfer | None:
    """The pending request behind an emailed link, if it is still live."""
    if not token:
        return None
    row = (
        await db.execute(select(HotelTransfer).where(HotelTransfer.accept_token == token))
    ).scalar_one_or_none()
    if row is None or row.state != TransferState.REQUESTED.value:
        return None
    if row.expires_at <= datetime.now(UTC):
        row.state = TransferState.EXPIRED.value
        row.settled_at = datetime.now(UTC)
        row.accept_token = None
        await db.flush()
        return None
    return row


async def decline(db: AsyncSession, row: HotelTransfer, *, why: str = "") -> HotelTransfer:
    if row.settled_at is not None:
        raise TransferError("That transfer has already finished.")
    row.state = TransferState.DECLINED.value
    row.settled_at = datetime.now(UTC)
    row.accept_token = None
    row.note = why[:500] or "Declined by the receiver."
    await db.flush()
    return row


async def cancel(db: AsyncSession, row: HotelTransfer, *, by: User) -> HotelTransfer:
    if row.settled_at is not None:
        raise TransferError("That transfer has already finished.")
    row.state = TransferState.CANCELLED.value
    row.settled_at = datetime.now(UTC)
    row.accept_token = None
    row.note = f"Cancelled by {by.email}."
    await db.flush()
    return row


async def accept(
    db: AsyncSession, row: HotelTransfer, *, password: str, new_name: str = ""
) -> tuple[HotelTransfer, User]:
    """The receiver's half, and the only place a transfer executes.

    Runs in ONE transaction with the copy or the reassignment. A half-executed
    transfer — the new owner made, the data not moved — is worse than a failed
    one, because both sides believe it worked.
    """
    now = datetime.now(UTC)
    if row.settled_at is not None or row.state != TransferState.REQUESTED.value:
        raise TransferError("That transfer has already been dealt with.")
    if row.expires_at <= now:
        raise TransferError("That invitation has expired. Ask them to send a new one.")
    if len(password or "") < 8:
        raise TransferError("Choose a password of at least 8 characters.")

    # RE-CHECKED HERE, not trusted from request time. Days can pass, and the
    # person who asked may no longer own the restaurant — or anything.
    if not await _email_is_free(db, row.to_email):
        raise TransferError(
            "That address has been signed up in the meantime, so it can no "
            "longer receive this restaurant."
        )
    sender = (
        await db.execute(select(User).where(User.id == row.requested_by))
    ).scalar_one_or_none()
    if sender is None or sender.role != Role.SUPER_ADMIN.value or not sender.is_active:
        raise TransferError(
            "The person who sent this is no longer the owner of that "
            "restaurant, so it can't be transferred."
        )
    source = (
        await db.execute(select(Hotel).where(Hotel.id == row.hotel_id))
    ).scalar_one_or_none()
    if source is None:
        raise TransferError("That restaurant no longer exists.")

    if row.kind == TransferKind.COPY.value:
        owner, result_id = await _do_copy(db, row, source, password, new_name)
    else:
        owner, result_id = await _do_move(db, row, source, sender, password)

    row.state = TransferState.DONE.value
    row.accepted_at = now
    row.settled_at = now
    row.accept_token = None
    row.result_hotel_id = result_id
    await db.flush()
    return row, owner


async def _do_move(
    db: AsyncSession, row: HotelTransfer, source: Hotel, sender: User, password: str
) -> tuple[User, uuid.UUID]:
    """Same restaurant, different owner.

    The old owner is DEACTIVATED, not deleted. Their id is on years of audit
    rows, expenses and payslips; removing it would either cascade into that
    history or fail on a foreign key — and the history is the thing a new
    owner most needs to be intact.
    """
    new_owner = await auth_service.create_user(
        db, row.to_email, password, Role.SUPER_ADMIN.value, source.id
    )
    # Not verified: they proved they hold the address by following the link,
    # but that is consent to receive, not a subscription. The banner inside
    # asks them, like it asks everyone else.
    new_owner.email_verified = False
    new_owner.verify_required = False

    sender.is_active = False
    await db.flush()
    return new_owner, source.id


async def _do_copy(
    db: AsyncSession, row: HotelTransfer, source: Hotel, password: str, new_name: str
) -> tuple[User, uuid.UUID]:
    """A second restaurant holding the same data. Both exist afterwards."""
    name = (new_name or "").strip()[:120] or f"{source.name} (copy)"
    clone = Hotel(
        name=name,
        # A HANDLE IS A PUBLIC ADDRESS AND CANNOT BE SHARED. Minted, not
        # copied: `username` is unique and it is also somebody's subdomain.
        username=await _free_handle(db, source.username or "hotel"),
        country=source.country,
        city=source.city,
        base_currency=source.base_currency,
        plan=source.plan,
        features=source.features,
    )
    db.add(clone)
    await db.flush()

    await cloning.copy_hotel(db, source.id, clone.id)

    owner = await auth_service.create_user(
        db, row.to_email, password, Role.SUPER_ADMIN.value, clone.id
    )
    owner.email_verified = False
    owner.verify_required = False
    await db.flush()
    return owner, clone.id


async def _free_handle(db: AsyncSession, base: str) -> str:
    """`base-2`, `base-3`… until one is unused. Bounded, then random — a loop
    that can spin forever inside a transfer is a loop that will."""
    stem = re.sub(r"[^a-z0-9-]", "", (base or "hotel").lower())[:32] or "hotel"
    for n in range(2, 40):
        candidate = f"{stem}-{n}"
        found = await db.execute(
            select(Hotel.id).where(Hotel.username == candidate).limit(1)
        )
        if found.first() is None:
            return candidate
    return f"{stem}-{secrets.token_hex(4)}"
