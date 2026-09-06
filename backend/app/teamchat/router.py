"""Team chat endpoints — rooms, messages and attachments inside one hotel."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import effective_permissions, get_current_user, require
from app.auth.models import Role, User
from app.core.database import get_db
from app.core.rbac import has_permission
from app.core.storage import get_storage
from app.teamchat import service
from app.teamchat.models import ChatRoom, ChatRoomMessage, RoomKind

router = APIRouter(prefix="/chat", tags=["team-chat"])


class RoomOut(BaseModel):
    id: str
    kind: str
    name: str
    emoji: str | None = None
    unread: int = 0
    last_message_at: datetime | None = None
    preview: str | None = None
    last_sender: str | None = None


class MessageOut(BaseModel):
    """Every field declared: response_model drops what it is not told about,
    and an attachment url that silently vanishes would look like a lost photo."""

    id: str
    body: str | None = None
    sender_user_id: str | None = None
    sender_name: str
    created_at: datetime
    attachment_url: str | None = None
    attachment_name: str | None = None
    attachment_type: str | None = None


class SendIn(BaseModel):
    body: str = Field(default="", max_length=4000)


class RoomIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    emoji: str | None = Field(default=None, max_length=8)
    member_ids: list[uuid.UUID] = Field(default_factory=list)


class MembersIn(BaseModel):
    member_ids: list[uuid.UUID] = Field(default_factory=list)


async def _room_i_can_see(db: AsyncSession, room_id: uuid.UUID, user: User) -> ChatRoom:
    room = await db.get(ChatRoom, room_id)
    if room is None or not await service.can_see(db, room, user):
        # Deliberately 404 rather than 403: telling somebody a room exists but
        # is closed to them is itself a leak about how the hotel is organised.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such conversation")
    return room


@router.get("/rooms", response_model=list[RoomOut])
async def list_rooms(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RoomOut]:
    """Every room this person can open. No permission needed beyond being in the
    hotel — Everyone means everyone, which is the point of it."""
    return [RoomOut(**r) for r in await service.rooms_for(db, user)]


@router.get("/rooms/{room_id}/messages", response_model=list[MessageOut])
async def room_messages(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[MessageOut]:
    room = await _room_i_can_see(db, room_id, user)
    msgs = await service.messages_for(db, room)
    await service.mark_seen(db, room, user)
    return [MessageOut(**m) for m in msgs]


@router.post("/rooms/{room_id}/messages", response_model=MessageOut)
async def send_message(
    room_id: uuid.UUID,
    payload: SendIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MessageOut:
    room = await _room_i_can_see(db, room_id, user)
    try:
        return MessageOut(**await service.post(db, room, user, body=payload.body))
    except service.ChatError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.post("/rooms/{room_id}/attachment", response_model=MessageOut)
async def send_attachment(
    room_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MessageOut:
    """A picture, a video or a GIF. Checked on TYPE and SIZE before it is
    stored, because this is a file every colleague will open."""
    room = await _room_i_can_see(db, room_id, user)
    data = await file.read()
    if len(data) > service.MAX_ATTACHMENT_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"That file is too big — {service.MAX_ATTACHMENT_BYTES // (1024 * 1024)}MB "
            "is the limit.",
        )
    mime = (file.content_type or "").lower()
    if not mime.startswith(service.ALLOWED_PREFIXES):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Pictures and video only — send documents through Documents so they "
            "are filed properly.",
        )

    msg_id = uuid.uuid4()
    key = get_storage().save(room.hotel_id, msg_id, file.filename or "upload", data)
    try:
        return MessageOut(
            **await service.post(
                db,
                room,
                user,
                body="",
                attachment=(key, file.filename or "upload", mime, len(data)),
            )
        )
    except service.ChatError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc


@router.get("/attachments/{message_id}")
async def attachment(
    message_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Serve the file, but only to somebody who can open the room it is in."""
    msg = await db.get(ChatRoomMessage, message_id)
    if msg is None or not msg.attachment_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such attachment")
    await _room_i_can_see(db, msg.room_id, user)
    try:
        data = get_storage().read(msg.attachment_key)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "That file is no longer stored") from exc
    return Response(
        content=data,
        media_type=msg.attachment_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{msg.attachment_name or "file"}"'},
    )


@router.get("/people")
async def people(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """Colleagues you can talk to — every live login in this hotel.

    NO PERMISSION. It used to require users:read, which is the permission for
    administering logins, and that quietly meant only an owner or manager could
    start a conversation. "any staff can chat with anyone, like organisation in
    teams" does not work if the list of who exists is an admin screen. A kitchen
    porter knowing that a chef works here is not a disclosure; they share a
    kitchen.

    Minus the platform operator, who is attached to the hotel to support it
    rather than to work in it, and minus the kiosk, which is a tablet by the
    door. Neither is a colleague to message.

    Email is held back unless the reader administers logins. A name and a job is
    what you need to pick somebody out of a list; an address book is a different
    thing to hand out.
    """
    rows = await db.execute(
        select(User).where(
            User.hotel_id == user.hotel_id,
            User.id != user.id,
            User.deleted_at.is_(None),
            User.is_active.is_(True),
            User.is_platform_owner.is_(False),
            User.role != Role.KIOSK.value,
        )
    )
    granted = await effective_permissions(db, user)
    may_admin = (
        "*" in granted or "users:read" in granted or "users:write" in granted
        if granted is not None
        else has_permission(user.role, "users:read")
    )
    return [
        {
            "id": str(u.id),
            "name": u.preferred_name or u.email.split("@")[0],
            "email": u.email if may_admin else "",
            "role": u.role,
        }
        for u in rows.scalars()
    ]


class DirectIn(BaseModel):
    user_id: uuid.UUID


@router.post("/direct", response_model=RoomOut)
async def start_direct(
    payload: DirectIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoomOut:
    """Open the conversation with one colleague, making it if it is the first.

    Any login may do this. That is the whole point of it — the one-to-one thread
    used to live at the bottom of an employee's record on an admin page, so a
    chef or a cashier had no way to message anybody at all.
    """
    other = await db.get(User, payload.user_id)
    if other is None or other.hotel_id != user.hotel_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such person")
    try:
        room = await service.direct_room(db, user, other)
    except service.ChatError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return RoomOut(
        id=str(room.id),
        kind=room.kind,
        name=other.preferred_name or other.email.split("@")[0],
        emoji=None,
    )


@router.post("/rooms", response_model=RoomOut)
async def create_room(
    payload: RoomIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:write")),
) -> RoomOut:
    """"superadmin can decide to create a grp and add members whichever he wish"."""
    try:
        room = await service.create_room(
            db, user, name=payload.name, emoji=payload.emoji, member_ids=payload.member_ids
        )
    except service.ChatError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return RoomOut(id=str(room.id), kind=room.kind, name=room.name, emoji=room.emoji)


@router.get("/rooms/{room_id}/members")
async def room_members(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    room = await _room_i_can_see(db, room_id, user)
    return {"kind": room.kind, "member_ids": await service.member_ids(db, room)}


@router.put("/rooms/{room_id}/members")
async def set_room_members(
    room_id: uuid.UUID,
    payload: MembersIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:write")),
) -> dict:
    room = await _room_i_can_see(db, room_id, user)
    try:
        await service.set_members(db, room, payload.member_ids)
    except service.ChatError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {"member_ids": await service.member_ids(db, room)}


@router.delete("/rooms/{room_id}")
async def close_room(
    room_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("users:write")),
) -> dict:
    """Close a group. The two standing rooms cannot be closed — a hotel without
    an Everyone room is a hotel where a notice has nowhere to go."""
    room = await _room_i_can_see(db, room_id, user)
    if room.kind != RoomKind.CUSTOM:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Everyone and Managers are always there."
        )
    room.is_active = False
    await db.commit()
    return {"closed": True}
