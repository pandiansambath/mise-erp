"""Moving or copying a restaurant to another account, with consent on both sides.

    "1.move one hotel from one email to other email 2. COPY one hotel
     datas(litrelly eevrything) from one email to othere new email if new email
     alreay in our datadvase then dont allow... also check email is valid
     before migration...for migration both side need to accept"

WHY THIS IS A ROW AND NOT A FUNCTION CALL
--------------------------------------------------------------------------
"Both sides must accept" means the two decisions happen at different times,
in different sessions, and possibly days apart. There is nowhere to hold that
except a record — and a record is also what makes the whole thing auditable
afterwards, which matters most for the case where somebody later says they
never agreed.

THE STATE IS THE WHOLE DESIGN
--------------------------------------------------------------------------
  requested  the owner asked. Nothing has moved.
  accepted   the RECEIVER said yes. Still nothing has moved.
  done       the data is there.
  declined   either side said no.
  cancelled  the sender withdrew it.
  expired    nobody answered in time.

A transfer only executes on the step from `accepted` — never on the request,
and never as a side effect of an accept alone. `settled_at` is set exactly
once, and `state` is checked at execution time rather than trusted from
whatever the caller last read, because a link in an email is a request anyone
holding it can replay.

WHY THE SENDER'S ACCEPTANCE IS SEPARATE FROM THEIR REQUEST
--------------------------------------------------------------------------
Making the request IS the sender's consent, and modelling it as a second
button would be theatre. What is NOT theatre is re-checking, at execution
time, that the person who asked still owns the restaurant: an owner can be
deactivated, or lose SUPER_ADMIN, between asking and the other side saying
yes. That check lives in the service, and `requested_by` is what it needs.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class TransferKind(str, enum.Enum):
    #: The same restaurant, a different owner. The original stops existing
    #: under the old email.
    MOVE = "move"
    #: A second restaurant with the same data. Both exist afterwards.
    COPY = "copy"


class TransferState(str, enum.Enum):
    REQUESTED = "requested"
    ACCEPTED = "accepted"
    DONE = "done"
    DECLINED = "declined"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


#: How long a request stands. Long enough for somebody to see an email over a
#: weekend, short enough that a forgotten request is not a standing offer to
#: take over a restaurant.
TRANSFER_TTL_DAYS = 7


class HotelTransfer(Base):
    """One request to move or copy a restaurant to another email."""

    __tablename__ = "hotel_transfers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)

    #: NO CASCADE, and no FK on the target. The restaurant may be deleted
    #: while a request is outstanding; the record of the request should
    #: survive that, because "what happened to my restaurant" is exactly the
    #: question this table exists to answer.
    hotel_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    hotel_name: Mapped[str] = mapped_column(String(120), nullable=False)

    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    state: Mapped[str] = mapped_column(
        String(12), nullable=False, default=TransferState.REQUESTED.value, index=True
    )

    requested_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    #: Stored as text, not as a user id. On a COPY the receiver has no account
    #: yet — that is the point — and on a MOVE the address is the thing that
    #: was agreed to, so it must not silently follow a later email change.
    from_email: Mapped[str] = mapped_column(String(255), nullable=False)
    to_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)

    #: The receiver proves they hold the address by following this. Single
    #: use: cleared the moment it is spent, so a forwarded email is not a
    #: second chance.
    accept_token: Mapped[str | None] = mapped_column(String(64), unique=True, index=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    #: Set once, whatever the outcome. A row with a `settled_at` is finished
    #: and can never execute again.
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    #: What he chose to LEAVE BEHIND on the preview, as group keys.
    #:
    #:     "if user wish to remove anytung he can do that"
    #:
    #: Stored with the request rather than recomputed at execution, so what
    #: happens days later is what was agreed today — the defaults could move
    #: in between, and a transfer that quietly carries more than was shown is
    #: the exact failure the preview exists to prevent.
    skip_groups: Mapped[list | None] = mapped_column(JSON)

    #: The hotel that came out of a COPY, so the two are linked afterwards.
    result_hotel_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    #: Why it ended the way it did, in words, for the person reading it later.
    note: Mapped[str | None] = mapped_column(Text)
