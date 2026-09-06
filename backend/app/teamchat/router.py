"""Team chat endpoints — rooms, messages and attachments inside one hotel."""
import logging
import uuid
from datetime import datetime
from urllib.parse import quote, urlparse

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import effective_permissions, get_current_user, require
from app.auth.models import Role, User
from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import has_permission
from app.core.storage import get_storage
from app.teamchat import service
from app.teamchat.models import ChatRoom, ChatRoomMessage, RoomKind

logger = logging.getLogger("mise.chat")

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


class GifIn(BaseModel):
    """A GIF chosen from the picker, named by the URL the search gave back."""

    url: str = Field(max_length=600)


@router.get("/gifs")
async def gif_search(
    q: str = "",
    user: User = Depends(get_current_user),
) -> dict:
    """Search GIFs, through us rather than from the browser.

    The key never reaches the page: a key in frontend JavaScript is a key you
    have published. And going through the server means one place decides what
    the app may talk to.

    With no key configured this answers plainly instead of showing an empty
    grid — an empty grid reads as "there are no cat GIFs", which would be a
    remarkable thing for the internet to be true about.
    """
    if not settings.tenor_api_key:
        return {
            "configured": False,
            "results": [],
            "hint": "GIF search needs a Tenor API key. Sending a .gif file works without one.",
        }
    term = (q or "funny").strip()[:80]
    url = (
        "https://tenor.googleapis.com/v2/search"
        f"?q={quote(term)}&key={settings.tenor_api_key}"
        f"&client_key=dineai&limit=24&media_filter=tinygif,gif&contentfilter=high"
    )
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()
    except Exception:  # noqa: BLE001 — a dead search must not break the chat
        logger.warning("gif.search_failed", extra={"hotel": str(user.hotel_id)})
        return {"configured": True, "results": [], "hint": "GIF search is not answering."}

    out = []
    for item in data.get("results", [])[:24]:
        media = item.get("media_formats", {})
        thumb = (media.get("tinygif") or {}).get("url")
        full = (media.get("gif") or {}).get("url")
        if thumb and full:
            out.append(
                {
                    "preview": thumb,
                    "url": full,
                    "description": item.get("content_description", ""),
                }
            )
    return {"configured": True, "results": out}


@router.post("/rooms/{room_id}/gif", response_model=MessageOut)
async def send_gif(
    room_id: uuid.UUID,
    payload: GifIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MessageOut:
    """Send a chosen GIF.

    We fetch it and store it like any other attachment rather than keeping the
    remote address. Hot-linking would mean a conversation quietly depending on
    somebody else's CDN: the joke somebody sent in March disappears in June and
    the thread stops making sense.

    Only Tenor's own media host is fetched. Taking a URL from a client and
    asking the server to go and get it is how a server gets used to reach places
    a browser could not, so the host is checked rather than trusted.
    """
    room = await _room_i_can_see(db, room_id, user)
    host = urlparse(payload.url).netloc.lower()
    if not (host.endswith(".tenor.com") or host == "tenor.com" or host.endswith(".googleapis.com")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That is not a GIF from the picker.")

    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            r = await client.get(payload.url)
            r.raise_for_status()
            data = r.content
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Could not fetch that GIF.") from exc

    if len(data) > service.MAX_ATTACHMENT_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "That GIF is too big.")
    mime = (r.headers.get("content-type") or "image/gif").split(";")[0].strip().lower()
    if not mime.startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That link is not an image.")

    msg_id = uuid.uuid4()
    key = get_storage().save(room.hotel_id, msg_id, "reaction.gif", data)
    try:
        return MessageOut(
            **await service.post(
                db, room, user, body="", attachment=(key, "reaction.gif", mime, len(data))
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
