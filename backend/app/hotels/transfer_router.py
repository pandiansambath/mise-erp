"""Endpoints for moving or copying a restaurant to another account.

TWO AUDIENCES, AND THAT SHAPES THE FILE.

The owner's half is authenticated and hangs off `/hotels/transfer`. The
receiver's half CANNOT BE — on a copy they have no account yet, and on a move
the whole point is that the restaurant is not theirs until they accept. So
those routes are public and authorise on the token alone, exactly as
`/auth/verify-email` does.

A public route authorised by a token is only as good as the token's rules,
so all three are here:

  * minted with `secrets.token_urlsafe(32)` and stored under a UNIQUE index;
  * CLEARED the moment it is spent, whatever the outcome — accepted,
    declined, expired — so a forwarded email is never a second chance;
  * expired at seven days by `by_token`, which settles the row as it looks,
    so an abandoned request stops being a standing offer to take over a
    restaurant.
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core import notify
from app.core.config import settings
from app.core.database import get_db
from app.hotels import transfer_service as svc
from app.hotels.models import Hotel
from app.hotels.transfer_models import HotelTransfer, TransferKind, TransferState

log = logging.getLogger("mise.hotels.transfer")

router = APIRouter(tags=["transfer"])


def _public(row: HotelTransfer) -> dict:
    """What the RECEIVER may see before accepting.

    Not the row. It carries `from_email`, and showing a stranger the address
    of whoever invited them — to a link that may have been forwarded — leaks
    somebody's email for no benefit. They need to know what is on offer and
    from which restaurant, and that is all.
    """
    return {
        "id": str(row.id),
        "hotel_name": row.hotel_name,
        "kind": row.kind,
        "to_email": row.to_email,
        "expires_at": row.expires_at.isoformat(),
    }


def _mine(row: HotelTransfer) -> dict:
    """What the SENDER may see: their own request, in full."""
    return {
        **_public(row),
        "state": row.state,
        "from_email": row.from_email,
        "created_at": row.created_at.isoformat(),
        "settled_at": row.settled_at.isoformat() if row.settled_at else None,
        "result_hotel_id": str(row.result_hotel_id) if row.result_hotel_id else None,
        "note": row.note,
    }


# ── the owner's half ──────────────────────────────────────────────────────

class TransferRequestIn(BaseModel):
    to_email: str = Field(min_length=3, max_length=255)
    kind: str = Field(default=TransferKind.COPY.value)


@router.get("/hotels/transfer")
async def my_transfers(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    """The outstanding request, if any, and what has happened before."""
    rows = (
        await db.execute(
            select(HotelTransfer)
            .where(HotelTransfer.hotel_id == user.hotel_id)
            .order_by(HotelTransfer.created_at.desc())
            .limit(20)
        )
    ).scalars().all()
    open_one = next(
        (r for r in rows if r.state in (TransferState.REQUESTED.value,
                                        TransferState.ACCEPTED.value)),
        None,
    )
    return {
        "open": _mine(open_one) if open_one else None,
        "history": [_mine(r) for r in rows],
    }


@router.post("/hotels/transfer", status_code=status.HTTP_201_CREATED)
async def start_transfer(
    payload: TransferRequestIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    """Ask to move or copy this restaurant. NOTHING MOVES HERE."""
    hotel = (
        await db.execute(select(Hotel).where(Hotel.id == user.hotel_id))
    ).scalar_one_or_none()
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Restaurant not found")

    try:
        row = await svc.request_transfer(
            db, hotel=hotel, owner=user, to_email=payload.to_email, kind=payload.kind
        )
    except svc.TransferError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None

    await db.commit()

    verb = "copy of" if row.kind == TransferKind.COPY.value else "ownership of"
    link = f"{settings.app_base_url}/transfer?token={row.accept_token}"
    await notify.send_email(
        row.to_email,
        f"{hotel.name} on DineAI — a {verb} this restaurant is waiting for you",
        # PLAIN TEXT FIRST, and it has to stand alone: it is what a text-only
        # client shows, and this is the mail somebody uses to hand over a
        # business, so the link must be readable without HTML.
        (
            f"{user.email} would like to hand you {verb} {hotel.name} "
            f"on DineAI.\n\n"
            f"Nothing has moved yet. Open this link to see what is included "
            f"and decide - you will choose your own password there:\n{link}\n\n"
            f"The invitation expires in 7 days. If you were not expecting it, "
            f"ignore this email and nothing will happen."
        ),
        html=(
            f"<p>{user.email} would like to hand you {verb} <b>{hotel.name}</b> "
            f"on DineAI.</p>"
            f"<p>Nothing has moved yet. Open the link below to see what is "
            f"included and decide — you will choose your own password there.</p>"
            f'<p><a href="{link}">Review this transfer</a></p>'
            f"<p>The invitation expires in 7 days. If you were not expecting "
            f"it, ignore this email and nothing will happen.</p>"
        ),
    )
    await audit.record(
        db, hotel_id=hotel.id, user=user, action="hotel.transfer.request",
        summary=f"Requested to {row.kind} {hotel.name} to {row.to_email}",
    )
    return _mine(row)


@router.delete("/hotels/transfer/{transfer_id}")
async def cancel_transfer(
    transfer_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> dict:
    row = (
        await db.execute(
            select(HotelTransfer).where(
                HotelTransfer.id == transfer_id,
                # SCOPED TO THEIR OWN RESTAURANT. Without this, any owner
                # could cancel anybody's transfer by guessing an id.
                HotelTransfer.hotel_id == user.hotel_id,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such transfer")
    try:
        await svc.cancel(db, row, by=user)
    except svc.TransferError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    await db.commit()
    return _mine(row)


# ── the receiver's half: PUBLIC, authorised by the token alone ────────────

class AcceptIn(BaseModel):
    token: str = Field(min_length=16, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    #: Only used for a COPY — the receiver names their own restaurant rather
    #: than inheriting "X (copy)" forever.
    name: str = Field(default="", max_length=120)


class TokenOnly(BaseModel):
    token: str = Field(min_length=16, max_length=64)


@router.get("/transfer/{token}")
async def look_at_transfer(token: str, db: AsyncSession = Depends(get_db)) -> dict:
    """What is on offer. Public, and deliberately thin — see `_public`."""
    row = await svc.by_token(db, token)
    await db.commit()  # `by_token` may have settled an expired row
    if row is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "That invitation is not valid any more — it may have been used, "
            "withdrawn, or left too long.",
        )
    return _public(row)


@router.post("/transfer/accept")
async def accept_transfer(payload: AcceptIn, db: AsyncSession = Depends(get_db)) -> dict:
    """Take it. THE ONLY PLACE A TRANSFER EXECUTES.

    One transaction with the copy or the reassignment: a half-done transfer —
    the new owner created, the data not moved — is worse than a failed one,
    because both sides believe it worked.
    """
    row = await svc.by_token(db, payload.token)
    if row is None:
        await db.commit()
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "That invitation is not valid any more."
        )
    try:
        row, owner = await svc.accept(
            db, row, password=payload.password, new_name=payload.name
        )
    except svc.TransferError as exc:
        await db.rollback()
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from None
    except Exception:
        await db.rollback()
        log.exception("transfer failed to execute", extra={"code": "DINE-I1003"})
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "Something went wrong moving that restaurant, so nothing was "
            "changed. Please try the link again.",
        ) from None

    await db.commit()
    await audit.record(
        db, hotel_id=row.result_hotel_id or row.hotel_id, user=owner,
        action="hotel.transfer.accept",
        summary=f"{row.to_email} accepted the {row.kind} of {row.hotel_name}",
    )
    # NO TOKEN IN THIS RESPONSE. They have just chosen a password; signing in
    # with it is one more step and it is the step that proves they know it.
    return {
        "ok": True,
        "kind": row.kind,
        "email": row.to_email,
        "hotel_name": row.hotel_name,
    }


@router.post("/transfer/decline")
async def decline_transfer(payload: TokenOnly, db: AsyncSession = Depends(get_db)) -> dict:
    row = await svc.by_token(db, payload.token)
    if row is None:
        await db.commit()
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "That invitation is not valid any more."
        )
    await svc.decline(db, row)
    await db.commit()
    return {"ok": True}
