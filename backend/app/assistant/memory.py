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
from datetime import UTC, datetime

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant.models import AssistantMessage, AssistantThread
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
        select(AssistantMessage.thread_id)
        .where(AssistantMessage.user_id == user.id)
        .order_by(desc(AssistantMessage.created_at))
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
                select(AssistantMessage)
                .where(AssistantMessage.user_id == user.id, AssistantMessage.thread_id == tid)
                .order_by(AssistantMessage.created_at)
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
                select(AssistantMessage)
                .where(AssistantMessage.user_id == user.id, AssistantMessage.thread_id != thread_id)
                .order_by(desc(AssistantMessage.created_at))
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
            AssistantMessage(
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
                select(AssistantMessage).where(
                    AssistantMessage.user_id == user.id, AssistantMessage.thread_id == thread_id
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


def _auto_title(first_question: str) -> str:
    """Name a thread from its opening line.

    Trimmed to something scannable rather than the whole sentence: a sidebar of
    120-character titles is as unreadable as a sidebar of UUIDs.
    """
    text = " ".join((first_question or "").split())
    if not text:
        return "New chat"
    return (text[:47].rstrip() + "…") if len(text) > 48 else text


async def touch_thread(
    db: AsyncSession, user: User, thread_id: uuid.UUID, first_question: str = ""
) -> AssistantThread:
    """Create the thread on first use, or bump its timestamp. Titles are only
    written once — a later question shouldn't rename a conversation under you."""
    row = await db.get(AssistantThread, thread_id)
    if row is None:
        row = AssistantThread(
            id=thread_id,
            hotel_id=user.hotel_id,
            user_id=user.id,
            title=_auto_title(first_question),
        )
        db.add(row)
    else:
        row.updated_at = datetime.now(UTC)
    await db.commit()
    return row


async def list_threads(db: AsyncSession, user: User, limit: int = 30) -> list[dict]:
    """This person's conversations, newest first."""
    rows = (
        (
            await db.execute(
                select(AssistantThread)
                .where(AssistantThread.user_id == user.id)
                .order_by(desc(AssistantThread.updated_at))
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    return [
        {"id": str(r.id), "title": r.title, "updated_at": r.updated_at.isoformat()} for r in rows
    ]


async def rename_thread(
    db: AsyncSession, user: User, thread_id: uuid.UUID, title: str
) -> bool:
    """Scoped to the owner, so a guessed id renames nothing."""
    row = await db.get(AssistantThread, thread_id)
    if row is None or row.user_id != user.id:
        return False
    row.title = (title or "").strip()[:120] or "New chat"
    await db.commit()
    return True
