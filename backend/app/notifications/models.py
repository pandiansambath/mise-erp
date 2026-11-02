"""State ABOUT a notification — never the notification itself.

    32.13: "Notification state needs a row, but NOT a notifications table."

The feed stays computed. A `notifications` table would be a second copy of
facts already sitting in document_requests, shifts, items and audit_events, and
every feature that writes would have to remember to write a notification too —
which is exactly the failure 32.2 already was: two features ABOUT a staff member
that notified everyone except the staff member.

What does need storing is what ONE PERSON has done to a notification: read it,
or put it away. One row per (user, key), keyed on the id the API already emits
(`low:<item>`, `price:<item>:<price>`, `act:<audit event>`, `docreq:<id>`…).
That buys the three things a localStorage seen-set never could: a dismiss that
holds, a mark-all-read that sticks, and read-on-one-device-is-read-on-all.

A row that says nothing — neither read nor dismissed — is deleted rather than
kept, and rows for things that have left the feed are pruned on the next write
(`state.py`), so the table holds what is on somebody's bell and little else.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class NotificationState(Base):
    __tablename__ = "notification_state"
    __table_args__ = (
        UniqueConstraint("user_id", "key", name="uq_notification_state_user_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Plain references, like every other foreign key to `hotels`: deleting a
    # restaurant is done table by table on purpose (platform_admin/deletion.py),
    # and a cascade here would be the first one to make it quietly convenient.
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    #: The notification's own id, exactly as the feed emits it, or `area:<key>`
    #: for a muted area. 160 is generous: the longest real id is
    #: `price:<uuid>:<price>`, about 50.
    key: Mapped[str] = mapped_column(String(160), nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
