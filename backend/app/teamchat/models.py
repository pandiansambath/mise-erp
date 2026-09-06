"""Team chat inside one hotel — Everyone, Managers, and custom groups."""
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class RoomKind:
    """Three kinds, and only one of them keeps a member list.

    EVERYONE and MANAGERS are membership by RULE, evaluated live from each
    person's role. That is not a shortcut — with member rows, hiring somebody
    would leave them silently outside Everyone until an admin remembered to add
    them, and promoting a chef to manager would not let them into Managers. A
    rule cannot be forgotten; a list can.
    """

    EVERYONE = "everyone"
    MANAGERS = "managers"
    CUSTOM = "custom"
    #: One person and one other person. Membership is a LIST like a custom
    #: group — it is simply a list of two — so `can_see` needs no new branch.
    DIRECT = "direct"


class ChatRoom(Base):
    __tablename__ = "chat_rooms"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(
        String(16), nullable=False, default=RoomKind.CUSTOM, server_default="custom"
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    emoji: Mapped[str | None] = mapped_column(String(8))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    #: Drives the ordering of the room list — a chat app sorts by who spoke last.
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    #: For DIRECT rooms only: the two user ids, sorted, joined by a colon.
    #:
    #: Two people opening each other at the same moment must land in the SAME
    #: conversation, and "did a room already exist between these two" has to be
    #: one indexed lookup rather than a scan of every room's membership. Sorting
    #: makes it symmetrical: A→B and B→A produce the same key, so there is no
    #: such thing as "his copy" and "her copy" of the thread.
    dm_key: Mapped[str | None] = mapped_column(String(80), index=True)


class ChatRoomMember(Base):
    """Only custom rooms use this. "whichever he wish" is a list, not a rule."""

    __tablename__ = "chat_room_members"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_member"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)


class ChatRoomMessage(Base):
    __tablename__ = "chat_room_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    sender_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    #: Stored as a name as well as an id, so the history still reads properly
    #: after a login is removed.
    sender_name: Mapped[str] = mapped_column(String(120), nullable=False)
    #: Optional, because a picture on its own is a message.
    body: Mapped[str | None] = mapped_column(Text)
    attachment_key: Mapped[str | None] = mapped_column(String(500))
    attachment_name: Mapped[str | None] = mapped_column(String(255))
    attachment_type: Mapped[str | None] = mapped_column(String(80))
    attachment_size: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class ChatRoomRead(Base):
    """When one person last looked at one room.

    Per person per room, because two people reading the same room have different
    ideas of what is new — a single timestamp on the room would make everyone's
    badge agree with whoever looked most recently.
    """

    __tablename__ = "chat_room_reads"
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_read"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    room_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chat_rooms.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
