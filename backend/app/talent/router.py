"""Talent board + hotel-to-hotel chat.

`router`        — hotel side (auth): post staff to lend, manage them, and the
                  full chat system (persisted threads between two hotels).
`public_router` — the public "available staff" board on the careers site
                  (no auth for browsing; resume download requires a hotel login).
"""
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, require
from app.auth.models import User
from app.core.database import get_db
from app.core.storage import get_storage
from app.hotels.models import Hotel
from app.talent.models import Chat, ChatMessage, StaffPost, StaffPostStatus

router = APIRouter(prefix="/talent", tags=["talent"])
public_router = APIRouter(prefix="/public/talent", tags=["talent-public"])

RESUME_EXTS = {".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg"}
RESUME_MAX_MB = 5


# ── schemas ───────────────────────────────────────────────────────────────────
class StaffPostIn(BaseModel):
    worker_name: str = Field(min_length=2, max_length=120)
    role_title: str = Field(min_length=2, max_length=80)
    blurb: str = Field(default="", max_length=1000)
    skills: str | None = Field(default=None, max_length=300)
    available_from: str | None = None
    available_until: str | None = None
    day_rate: Decimal | None = Field(default=None, ge=0, le=Decimal("9999"))


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


def _post_out(p: StaffPost, hotel_name: str | None = None) -> dict:
    return {
        "id": str(p.id),
        "hotel_id": str(p.hotel_id),
        "hotel_name": hotel_name,
        "worker_name": p.worker_name,
        "role_title": p.role_title,
        "blurb": p.blurb,
        "skills": p.skills,
        "available_from": p.available_from.isoformat() if p.available_from else None,
        "available_until": p.available_until.isoformat() if p.available_until else None,
        "day_rate": str(p.day_rate) if p.day_rate is not None else None,
        "has_resume": bool(p.resume_key),
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else None,
    }


# ── hotel side: manage your lent-staff posts ─────────────────────────────────
@router.get("/posts")
async def my_posts(
    db: AsyncSession = Depends(get_db), user: User = Depends(require("employees:read"))
) -> list[dict]:
    rows = (
        await db.execute(
            select(StaffPost)
            .where(StaffPost.hotel_id == user.hotel_id)
            .order_by(StaffPost.created_at.desc())
        )
    ).scalars().all()
    return [_post_out(p) for p in rows]


@router.post("/posts", status_code=status.HTTP_201_CREATED)
async def create_post(
    worker_name: str = Form(...),
    role_title: str = Form(...),
    blurb: str = Form(default=""),
    skills: str | None = Form(default=None),
    available_from: str | None = Form(default=None),
    available_until: str | None = Form(default=None),
    day_rate: str | None = Form(default=None),
    resume: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    from datetime import date as date_type

    post = StaffPost(
        hotel_id=user.hotel_id,
        worker_name=worker_name.strip(),
        role_title=role_title.strip(),
        blurb=(blurb or "").strip(),
        skills=(skills or "").strip() or None,
        available_from=date_type.fromisoformat(available_from) if available_from else None,
        available_until=date_type.fromisoformat(available_until) if available_until else None,
        day_rate=Decimal(day_rate) if day_rate else None,
    )
    if resume is not None and resume.filename:
        ext = ("." + resume.filename.rsplit(".", 1)[-1].lower()) if "." in resume.filename else ""
        if ext not in RESUME_EXTS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Resume must be PDF, Word or an image"
            )
        data = await resume.read()
        if len(data) > RESUME_MAX_MB * 1024 * 1024:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"Resume exceeds {RESUME_MAX_MB} MB"
            )
        post.id = post.id or uuid.uuid4()
        post.resume_key = get_storage().save(user.hotel_id, post.id, resume.filename, data)
        post.resume_filename = resume.filename
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return _post_out(post)


@router.patch("/posts/{post_id}")
async def toggle_post(
    post_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> dict:
    post = (
        await db.execute(
            select(StaffPost).where(StaffPost.id == post_id, StaffPost.hotel_id == user.hotel_id)
        )
    ).scalar_one_or_none()
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Post not found")
    post.status = (
        StaffPostStatus.CLOSED.value
        if post.status == StaffPostStatus.OPEN.value
        else StaffPostStatus.OPEN.value
    )
    await db.commit()
    return _post_out(post)


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    post_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> None:
    post = (
        await db.execute(
            select(StaffPost).where(StaffPost.id == post_id, StaffPost.hotel_id == user.hotel_id)
        )
    ).scalar_one_or_none()
    if post:
        await db.delete(post)
        await db.commit()


# ── public: the "available staff" board ──────────────────────────────────────
@public_router.get("")
async def public_board(db: AsyncSession = Depends(get_db)) -> list[dict]:
    rows = (
        await db.execute(
            select(StaffPost, Hotel)
            .join(Hotel, StaffPost.hotel_id == Hotel.id)
            .where(StaffPost.status == StaffPostStatus.OPEN.value, Hotel.is_active.is_(True))
            .order_by(StaffPost.created_at.desc())
        )
    ).all()
    return [_post_out(p, h.name) for p, h in rows]


@router.get("/posts/{post_id}/resume")
async def download_resume(
    post_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> Response:
    """Resumes are gated to signed-in hotels (a worker's CV isn't fully public)."""
    post = await db.get(StaffPost, post_id)
    if post is None or not post.resume_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No resume on this post")
    data = get_storage().read(post.resume_key)
    fname = post.resume_filename or "resume"
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── chat: persisted hotel-to-hotel threads ───────────────────────────────────
def _pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    """Order the pair so (a,b) and (b,a) map to the same chat."""
    return (a, b) if str(a) < str(b) else (b, a)


async def _get_or_create_chat(
    db: AsyncSession, me: uuid.UUID, other: uuid.UUID, staff_post_id: uuid.UUID | None
) -> Chat:
    a, b = _pair(me, other)
    chat = (
        await db.execute(select(Chat).where(Chat.hotel_a == a, Chat.hotel_b == b))
    ).scalar_one_or_none()
    if chat is None:
        chat = Chat(hotel_a=a, hotel_b=b, staff_post_id=staff_post_id)
        db.add(chat)
        await db.commit()
        await db.refresh(chat)
    return chat


class OpenChatIn(BaseModel):
    staff_post_id: uuid.UUID


@router.post("/chats/open")
async def open_chat(
    payload: OpenChatIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> dict:
    """Start (or reopen) a chat with the hotel that posted a staff member."""
    post = await db.get(StaffPost, payload.staff_post_id)
    if post is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That staff post is gone")
    if post.hotel_id == user.hotel_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That's your own post")
    chat = await _get_or_create_chat(db, user.hotel_id, post.hotel_id, post.id)
    return {"chat_id": str(chat.id)}


async def _chat_summary(db: AsyncSession, chat: Chat, me: uuid.UUID) -> dict:
    other_id = chat.hotel_b if chat.hotel_a == me else chat.hotel_a
    other = await db.get(Hotel, other_id)
    my_seen = chat.a_seen_at if chat.hotel_a == me else chat.b_seen_at
    unread = (
        await db.execute(
            select(ChatMessage).where(
                ChatMessage.chat_id == chat.id,
                ChatMessage.sender_hotel_id != me,
                *( [ChatMessage.created_at > my_seen] if my_seen else [] ),
            )
        )
    ).scalars().all()
    last = (
        await db.execute(
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat.id)
            .order_by(ChatMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return {
        "chat_id": str(chat.id),
        "other_hotel": other.name if other else "Unknown",
        "other_hotel_id": str(other_id),
        "last_message": last.body if last else None,
        "last_message_at": last.created_at.isoformat() if last else None,
        "unread": len(unread),
    }


@router.get("/chats")
async def list_chats(
    db: AsyncSession = Depends(get_db), user: User = Depends(require("employees:read"))
) -> list[dict]:
    me = user.hotel_id
    rows = (
        await db.execute(
            select(Chat)
            .where(or_(Chat.hotel_a == me, Chat.hotel_b == me))
            .order_by(Chat.last_message_at.desc().nullslast(), Chat.created_at.desc())
        )
    ).scalars().all()
    return [await _chat_summary(db, c, me) for c in rows]


@router.get("/chats/{chat_id}/messages")
async def get_messages(
    chat_id: uuid.UUID,
    after: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> dict:
    chat = await db.get(Chat, chat_id)
    if chat is None or user.hotel_id not in (chat.hotel_a, chat.hotel_b):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat not found")
    q = select(ChatMessage).where(ChatMessage.chat_id == chat_id)
    if after:
        q = q.where(ChatMessage.created_at > datetime.fromisoformat(after))
    msgs = (await db.execute(q.order_by(ChatMessage.created_at))).scalars().all()
    # mark read (this side just opened it)
    now = datetime.now(UTC)
    if chat.hotel_a == user.hotel_id:
        chat.a_seen_at = now
    else:
        chat.b_seen_at = now
    await db.commit()
    other_id = chat.hotel_b if chat.hotel_a == user.hotel_id else chat.hotel_a
    other = await db.get(Hotel, other_id)
    return {
        "chat_id": str(chat.id),
        "other_hotel": other.name if other else "Unknown",
        "messages": [
            {
                "id": str(m.id),
                "mine": m.sender_hotel_id == user.hotel_id,
                "sender_name": m.sender_name,
                "body": m.body,
                "created_at": m.created_at.isoformat(),
            }
            for m in msgs
        ],
    }


@router.post("/chats/{chat_id}/messages", status_code=status.HTTP_201_CREATED)
async def send_message(
    chat_id: uuid.UUID,
    payload: MessageIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> dict:
    chat = await db.get(Chat, chat_id)
    if chat is None or user.hotel_id not in (chat.hotel_a, chat.hotel_b):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Chat not found")
    msg = ChatMessage(
        chat_id=chat.id,
        sender_hotel_id=user.hotel_id,
        sender_name=user.preferred_name or user.email.split("@")[0],
        body=payload.body.strip(),
    )
    db.add(msg)
    chat.last_message_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(msg)
    return {
        "id": str(msg.id),
        "mine": True,
        "sender_name": msg.sender_name,
        "body": msg.body,
        "created_at": msg.created_at.isoformat(),
    }


@router.get("/chats/unread-count")
async def unread_count(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    """Small number for the nav badge — total unread across all this hotel's chats."""
    me = user.hotel_id
    chats = (
        await db.execute(select(Chat).where(or_(Chat.hotel_a == me, Chat.hotel_b == me)))
    ).scalars().all()
    total = 0
    for c in chats:
        seen = c.a_seen_at if c.hotel_a == me else c.b_seen_at
        conds = [ChatMessage.chat_id == c.id, ChatMessage.sender_hotel_id != me]
        if seen:
            conds.append(ChatMessage.created_at > seen)
        n = (await db.execute(select(ChatMessage).where(and_(*conds)))).scalars().all()
        total += len(n)
    return {"unread": total}
