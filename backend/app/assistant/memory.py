"""The assistant's memory.

Conversations belong to the PERSON, not to the browser tab. Before this, the
Copilot forgot everything the moment you navigated — which makes it feel
disposable and makes people repeat themselves.

Threads exist so "New chat" can give you a clean screen, but they are
deliberately not sealed off from one another: `carryover()` hands the model a
little of what was said in earlier threads, so someone asking about "that
supplier" next week doesn't have to reintroduce them.
"""
from __future__ import annotations

import logging
import uuid

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant.models import ChatMessage
from app.auth.models import User

log = logging.getLogger("mise.assistant.memory")

# How much of the CURRENT thread to replay into the screen.
THREAD_LIMIT = 200
# How much of EARLIER threads to remind the model about. Small on purpose: this
# is background, and every token of it is billed on each call.
CARRYOVER_LIMIT = 6


async def latest_thread(db: AsyncSession, user: User) -> uuid.UUID | None:
    """The conversation this person was last having, so reopening resumes it."""
    return await db.scalar(
        select(ChatMessage.thread_id)
        .where(ChatMessage.user_id == user.id)
        .order_by(desc(ChatMessage.created_at))
        .limit(1)
    )


async def load(
    db: AsyncSession, user: User, thread_id: uuid.UUID | None = None
) -> tuple[uuid.UUID, list[dict]]:
    """Replay a thread. Returns (thread_id, messages oldest-first)."""
    tid = thread_id or await latest_thread(db, user) or uuid.uuid4()
    rows = (
        (
            await db.execute(
                select(ChatMessage)
                .where(ChatMessage.user_id == user.id, ChatMessage.thread_id == tid)
                .order_by(ChatMessage.created_at)
                .limit(THREAD_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    return tid, [{"role": r.role, "content": r.content} for r in rows]


async def carryover(db: AsyncSession, user: User, thread_id: uuid.UUID) -> str:
    """A short reminder of what this person discussed in EARLIER threads.

    Returns "" when there is nothing, so a first-time user costs no extra
    tokens. Trimmed hard: this is background colour, not the conversation.
    """
    rows = (
        (
            await db.execute(
                select(ChatMessage)
                .where(ChatMessage.user_id == user.id, ChatMessage.thread_id != thread_id)
                .order_by(desc(ChatMessage.created_at))
                .limit(CARRYOVER_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        return ""
    lines = [f"{r.role}: {r.content[:180]}" for r in reversed(rows)]
    return (
        "\n\nEARLIER CONVERSATIONS with this same person (background only — do not "
        "bring them up unless relevant):\n" + "\n".join(lines)
    )


async def remember(
    db: AsyncSession, user: User, thread_id: uuid.UUID, role: str, content: str
) -> None:
    """Store one turn. Never raises: losing a log line must not lose the reply
    the person is waiting for."""
    if not content:
        return
    try:
        db.add(
            ChatMessage(
                hotel_id=user.hotel_id,
                user_id=user.id,
                thread_id=thread_id,
                role="assistant" if role == "assistant" else "user",
                content=content[:8000],
            )
        )
        await db.commit()
    except Exception:  # noqa: BLE001 — memory is best-effort, the answer is not
        log.exception("could not persist a chat turn (user=%s)", user.id)
        await db.rollback()


async def forget_thread(db: AsyncSession, user: User, thread_id: uuid.UUID) -> int:
    """Delete one conversation. Scoped to the owner of the messages, so nobody
    can clear someone else's history by guessing a thread id."""
    rows = (
        (
            await db.execute(
                select(ChatMessage).where(
                    ChatMessage.user_id == user.id, ChatMessage.thread_id == thread_id
                )
            )
        )
        .scalars()
        .all()
    )
    for r in rows:
        await db.delete(r)
    await db.commit()
    return len(rows)
