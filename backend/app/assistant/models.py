"""Every AI call, logged.

Without this table you cannot answer the only question that matters when the
Bedrock bill arrives: *who spent this?* One row per call — hotel, user, model,
tokens both ways, and an estimated cost — which is also what the quota checks
read to decide whether the next call is allowed.

Denormalised on purpose (user_email kept, no FKs) so the ledger survives a
staff member being removed, exactly like the audit trail.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class AiUsage(Base):
    __tablename__ = "ai_usage"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    user_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # chat | vision | health
    model: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(10, 6), nullable=False, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class AssistantMessage(Base):
    """One turn of a person's conversation with the assistant.

    Kept per USER, not per browser: the Copilot was losing everything the moment
    you navigated, which makes it feel disposable and forces people to repeat
    themselves. History survives logout, device changes and new sessions.

    Named `assistant_messages`, not `chat_messages`: the latter is already the
    hotel-to-hotel messaging table and the two are unrelated.

    `thread_id` groups a conversation so "New chat" can start a clean screen —
    but threads are NOT walled off from each other. The assistant is given
    recent context across threads, because a restaurant owner asking about the
    same supplier next week should not have to re-explain who they mean.
    """

    __tablename__ = "assistant_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    thread_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(12), nullable=False)  # user | assistant
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
