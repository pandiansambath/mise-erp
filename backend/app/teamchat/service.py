"""Who can see which room, what is unread, and what may be sent."""
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Role, User
from app.teamchat.models import (
    ChatRoom,
    ChatRoomMember,
    ChatRoomMessage,
    ChatRoomRead,
    RoomKind,
)


class ChatError(ValueError):
    """Something the person can fix, said in words they can act on."""


#: What may be attached. Deliberately a list rather than "anything not
#: executable": this is a file every colleague will open, so the safe set is the
#: one we can actually render — pictures, video, and GIFs, exactly as asked.
ALLOWED_PREFIXES = ("image/", "video/")
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

#: The two rooms every hotel has. Created on first use rather than at signup, so
#: a hotel that never opens chat carries no rows for it.
STANDING = (
    (RoomKind.EVERYONE, "Everyone", "\U0001f465"),
    (RoomKind.MANAGERS, "Managers", "\U0001f510"),
)

MANAGER_ROLES = {Role.SUPER_ADMIN.value, Role.MANAGER.value, Role.KITCHEN_MANAGER.value}


def is_manager(user: User) -> bool:
    return user.role in MANAGER_ROLES


async def ensure_standing_rooms(db: AsyncSession, hotel_id: uuid.UUID) -> None:
    """Make sure Everyone and Managers exist for this hotel.

    Created lazily, on the first request that lists rooms, so a hotel that never
    opens chat carries no rows for it. That timing has a cost: two people opening
    the page in the same second both find no Everyone room and both try to make
    one. A check-then-insert cannot settle that on its own, so a partial unique
    index on (hotel_id, kind) decides who was first and the loser simply reads
    what the winner made.
    """
    have = {
        r.kind
        for r in (
            await db.execute(select(ChatRoom).where(ChatRoom.hotel_id == hotel_id))
        ).scalars()
    }
    made = False
    for kind, name, emoji in STANDING:
        if kind not in have:
            db.add(ChatRoom(hotel_id=hotel_id, kind=kind, name=name, emoji=emoji))
            made = True
    if not made:
        return
    try:
        await db.commit()
    except IntegrityError:
        # Somebody else got there first. Their room is as good as ours would
        # have been, and it is the one everybody else is already reading.
        await db.rollback()


async def can_see(db: AsyncSession, room: ChatRoom, user: User) -> bool:
    """Membership is a RULE for the standing rooms and a LIST for custom ones."""
    if room.hotel_id != user.hotel_id or not room.is_active:
        return False
    # Two logins belong to the hotel without belonging in its staff room.
    #
    # The platform operator is support, not staff. They are attached to a hotel
    # so they can help it, which would otherwise place them silently inside its
    # private staff room — reading a conversation nobody in the restaurant knows
    # they are in. Access to run a hotel is not consent to sit in its break room.
    #
    # The kiosk is not a person at all. It is a shared tablet by the door that
    # sits unattended on a counter where anyone can touch it, which is why it
    # already reaches nothing that reveals what people earn. A private staff
    # conversation left open on that screen is the same exposure by another
    # route — and worse, because chat is where people speak freely.
    if user.is_platform_owner or user.role == Role.KIOSK.value:
        return False
    if room.kind == RoomKind.EVERYONE:
        return True
    if room.kind == RoomKind.MANAGERS:
        return is_manager(user)
    row = await db.execute(
        select(ChatRoomMember).where(
            ChatRoomMember.room_id == room.id, ChatRoomMember.user_id == user.id
        )
    )
    return row.scalar_one_or_none() is not None


async def rooms_for(db: AsyncSession, user: User) -> list[dict]:
    """Every room this person can open, busiest conversation first."""
    await ensure_standing_rooms(db, user.hotel_id)

    rooms = list(
        (
            await db.execute(
                select(ChatRoom)
                .where(ChatRoom.hotel_id == user.hotel_id, ChatRoom.is_active.is_(True))
                .order_by(ChatRoom.last_message_at.desc().nullslast(), ChatRoom.created_at)
            )
        ).scalars()
    )

    mine = [r for r in rooms if await can_see(db, r, user)]
    if not mine:
        return []

    reads = {
        r.room_id: r.seen_at
        for r in (
            await db.execute(select(ChatRoomRead).where(ChatRoomRead.user_id == user.id))
        ).scalars()
    }

    out: list[dict] = []
    for r in mine:
        conds = [
            ChatRoomMessage.room_id == r.id,
            # Your own messages are never unread to you.
            (ChatRoomMessage.sender_user_id != user.id)
            | (ChatRoomMessage.sender_user_id.is_(None)),
        ]
        seen = reads.get(r.id)
        if seen is not None:
            conds.append(ChatRoomMessage.created_at > seen)
        unread = int(
            (
                await db.execute(select(func.count()).select_from(ChatRoomMessage).where(*conds))
            ).scalar()
            or 0
        )
        last = (
            await db.execute(
                select(ChatRoomMessage)
                .where(ChatRoomMessage.room_id == r.id)
                .order_by(ChatRoomMessage.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        out.append(
            {
                "id": str(r.id),
                "kind": r.kind,
                "name": r.name,
                "emoji": r.emoji,
                "unread": unread,
                "last_message_at": r.last_message_at,
                "preview": (
                    (last.body or ("\U0001f4ce " + (last.attachment_name or "attachment")))[:80]
                    if last
                    else None
                ),
                "last_sender": last.sender_name if last else None,
            }
        )
    return out


async def messages_for(db: AsyncSession, room: ChatRoom, *, limit: int = 200) -> list[dict]:
    """Oldest first — a conversation reads downwards. The limit takes the most
    RECENT and flips them, so a long room opens at the end, not the beginning."""
    rows = await db.execute(
        select(ChatRoomMessage)
        .where(ChatRoomMessage.room_id == room.id)
        .order_by(ChatRoomMessage.created_at.desc())
        .limit(limit)
    )
    return [_msg(m) for m in list(rows.scalars())[::-1]]


def _msg(m: ChatRoomMessage) -> dict:
    return {
        "id": str(m.id),
        "body": m.body,
        "sender_user_id": str(m.sender_user_id) if m.sender_user_id else None,
        "sender_name": m.sender_name,
        "created_at": m.created_at,
        "attachment_url": f"/api/chat/attachments/{m.id}" if m.attachment_key else None,
        "attachment_name": m.attachment_name,
        "attachment_type": m.attachment_type,
    }


async def post(
    db: AsyncSession,
    room: ChatRoom,
    user: User,
    *,
    body: str | None = None,
    attachment: tuple[str, str, str, int] | None = None,
) -> dict:
    """Say something. A picture on its own counts, so body may be empty."""
    text = (body or "").strip()
    if not text and attachment is None:
        raise ChatError("Write something, or attach a picture.")
    if len(text) > 4000:
        raise ChatError("That message is too long — keep it under 4000 characters.")

    msg = ChatRoomMessage(
        room_id=room.id,
        hotel_id=room.hotel_id,
        sender_user_id=user.id,
        sender_name=(user.preferred_name or user.email.split("@")[0] or "Someone")[:120],
        body=text or None,
    )
    if attachment:
        key, name, mime, size = attachment
        msg.attachment_key, msg.attachment_name = key, name
        msg.attachment_type, msg.attachment_size = mime, size

    db.add(msg)
    room.last_message_at = datetime.now(UTC)
    await _mark_seen(db, room, user, commit=False)
    await db.commit()
    await db.refresh(msg)
    return _msg(msg)


async def _mark_seen(db: AsyncSession, room: ChatRoom, user: User, *, commit: bool = True) -> None:
    row = (
        await db.execute(
            select(ChatRoomRead).where(
                ChatRoomRead.room_id == room.id, ChatRoomRead.user_id == user.id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = ChatRoomRead(room_id=room.id, user_id=user.id)
        db.add(row)
    row.seen_at = datetime.now(UTC)
    if commit:
        await db.commit()


async def mark_seen(db: AsyncSession, room: ChatRoom, user: User) -> None:
    await _mark_seen(db, room, user)


async def create_room(
    db: AsyncSession, user: User, *, name: str, emoji: str | None, member_ids: list[uuid.UUID]
) -> ChatRoom:
    """A group the owner shapes: any name, any people."""
    clean = (name or "").strip()
    if not clean:
        raise ChatError("Give the group a name.")
    room = ChatRoom(
        hotel_id=user.hotel_id,
        kind=RoomKind.CUSTOM,
        name=clean[:80],
        emoji=(emoji or None),
        created_by=user.id,
    )
    db.add(room)
    await db.flush()
    # Whoever made it is in it — a group its creator cannot read would be a
    # strange thing to have made.
    for uid in {*member_ids, user.id}:
        db.add(ChatRoomMember(room_id=room.id, user_id=uid))
    await db.commit()
    await db.refresh(room)
    return room


async def set_members(db: AsyncSession, room: ChatRoom, member_ids: list[uuid.UUID]) -> None:
    if room.kind != RoomKind.CUSTOM:
        raise ChatError(
            "Everyone and Managers pick their own members from people's roles — "
            "add someone to the hotel, or change their role, and they appear here."
        )
    existing = list(
        (
            await db.execute(select(ChatRoomMember).where(ChatRoomMember.room_id == room.id))
        ).scalars()
    )
    # Whoever made it stays in it. Without this an owner could empty their own
    # group, lose sight of it, and then be unable to close it either — closing
    # requires being able to see the room, so the group would be stranded in
    # everyone's history with no way to reach it.
    want = set(member_ids)
    if room.created_by:
        want.add(room.created_by)
    for m in existing:
        if m.user_id not in want:
            await db.delete(m)
        else:
            want.discard(m.user_id)
    for uid in want:
        db.add(ChatRoomMember(room_id=room.id, user_id=uid))
    await db.commit()


async def member_ids(db: AsyncSession, room: ChatRoom) -> list[str]:
    rows = await db.execute(
        select(ChatRoomMember.user_id).where(ChatRoomMember.room_id == room.id)
    )
    return [str(r) for r in rows.scalars()]
