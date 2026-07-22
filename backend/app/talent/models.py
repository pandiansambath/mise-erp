"""Staff-lending marketplace + hotel-to-hotel chat.

A hotel with idle staff posts a StaffPost (this person, this role, free these
dates). Other hotels browse them on the public careers board and open a Chat —
a persisted WhatsApp-style thread between the two hotels. Every ChatMessage is
stored forever, so the conversation survives reloads and sign-outs.
"""
import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class StaffPostStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"


class StaffPost(Base):
    """A worker a hotel is offering to lend / place with another hotel."""

    __tablename__ = "staff_posts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    worker_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role_title: Mapped[str] = mapped_column(String(80), nullable=False)  # Chef, Waiter…
    blurb: Mapped[str] = mapped_column(Text, nullable=False, default="")
    skills: Mapped[str | None] = mapped_column(String(300))  # CSV of tags
    available_from: Mapped[date | None] = mapped_column()
    available_until: Mapped[date | None] = mapped_column()
    day_rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    resume_key: Mapped[str | None] = mapped_column(String(255))
    resume_filename: Mapped[str | None] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default=StaffPostStatus.OPEN.value, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Chat(Base):
    """A thread between TWO hotels (ordered pair: a < b keeps it unique), started
    from a staff post or opened directly."""

    __tablename__ = "chats"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_a: Mapped[uuid.UUID] = mapped_column(ForeignKey("hotels.id"), nullable=False, index=True)
    hotel_b: Mapped[uuid.UUID] = mapped_column(ForeignKey("hotels.id"), nullable=False, index=True)
    staff_post_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("staff_posts.id"))
    # Read receipts: when each side last opened the thread (unread = messages
    # from the other side after my timestamp).
    a_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    b_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan", lazy="selectin"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id"), nullable=False, index=True
    )
    sender_hotel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hotels.id"), nullable=False)
    sender_name: Mapped[str] = mapped_column(String(120), nullable=False)  # who typed it
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # Optional attachment (image or document) stored safely in S3 like resumes.
    attachment_key: Mapped[str | None] = mapped_column(String(255))
    attachment_name: Mapped[str | None] = mapped_column(String(255))
    attachment_type: Mapped[str | None] = mapped_column(String(60))  # MIME
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    chat: Mapped[Chat] = relationship(back_populates="messages")
