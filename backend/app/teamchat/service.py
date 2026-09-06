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


#: What may be attached.
#:
#: It began as pictures and video only, on the reasoning that a chat should not
#: become a filing cabinet. He asked for documents as well — "emoji gif video
#: photo doc etc upload feature in ALL chats" — and he is right about the
#: workflow: a rota PDF or a supplier invoice is a normal thing to hand to a
#: colleague, and telling somebody to go and file it properly first is telling
#: them to use something else instead.
#:
#: Still a list rather than "anything not executable". Every colleague will open
#: these, so the set stays things a browser renders or downloads inertly, and
#: nothing that runs.
ALLOWED_PREFIXES = (
    "image/",
    "video/",
    "audio/",
    "application/pdf",
    "text/plain",
    "text/csv",
    # Office documents, by their full types rather than a prefix — the
    # application/ family also contains things nobody should be handed.
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument",
    "application/rtf",
)
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


def dm_key_for(a: uuid.UUID, b: uuid.UUID) -> str:
    """The same key whichever way round the two people are named."""
    return ":".join(sorted([str(a), str(b)]))


async def direct_room(db: AsyncSession, user: User, other: User) -> ChatRoom:
    """The conversation between two people, made the first time it is opened.

        "one to one within the hotel — like any staff can chat with anyone,
         like organisation in teams"

    Lazily, like the standing rooms: a pair who never speak carry no row. The
    name is left empty on purpose — a direct room has no single name, because
    it is called by the OTHER person's name, and which name that is depends on
    who is looking. `rooms_for` fills it in per viewer.
    """
    if other.hotel_id != user.hotel_id:
        raise ChatError("That person does not work here.")
    if other.id == user.id:
        raise ChatError("You cannot start a conversation with yourself.")
    if other.is_platform_owner or other.role == Role.KIOSK.value:
        raise ChatError("That login is not a person you can message.")

    key = dm_key_for(user.id, other.id)
    found = (
        await db.execute(
            select(ChatRoom).where(
                ChatRoom.hotel_id == user.hotel_id,
                ChatRoom.kind == RoomKind.DIRECT,
                ChatRoom.dm_key == key,
            )
        )
    ).scalar_one_or_none()
    if found is not None:
        if not found.is_active:
            found.is_active = True
            await db.commit()
        return found

    room = ChatRoom(
        hotel_id=user.hotel_id,
        kind=RoomKind.DIRECT,
        name="",
        created_by=user.id,
        dm_key=key,
    )
    db.add(room)
    await db.flush()
    db.add(ChatRoomMember(room_id=room.id, user_id=user.id))
    db.add(ChatRoomMember(room_id=room.id, user_id=other.id))
    try:
        await db.commit()
    except IntegrityError:
        # They opened each other in the same instant. One key, one room.
        await db.rollback()
        return (
            await db.execute(
                select(ChatRoom).where(
                    ChatRoom.hotel_id == user.hotel_id,
                    ChatRoom.kind == RoomKind.DIRECT,
                    ChatRoom.dm_key == key,
                )
            )
        ).scalar_one()
    await db.refresh(room)
    return room


async def _other_in_direct(db: AsyncSession, room: ChatRoom, me: uuid.UUID) -> User | None:
    """Whose name a direct room wears, for this reader."""
    ids = [
        m.user_id
        for m in (
            await db.execute(select(ChatRoomMember).where(ChatRoomMember.room_id == room.id))
        ).scalars()
    ]
    other = next((i for i in ids if i != me), None)
    return await db.get(User, other) if other else None


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
        last = (
            await db.execute(
                select(ChatRoomMessage)
                .where(ChatRoomMessage.room_id == r.id)
                .order_by(ChatRoomMessage.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        unread = int(
            (
                await db.execute(select(func.count()).select_from(ChatRoomMessage).where(*conds))
            ).scalar()
            or 0
        )
        name = r.name
        if r.kind == RoomKind.DIRECT:
            who = await _other_in_direct(db, r, user.id)
            name = (who.preferred_name or who.email.split("@")[0]) if who else "Someone"
            # A conversation nobody has started yet is not a conversation. It
            # would otherwise sit in the list the moment somebody opened the
            # picker and changed their mind.
            if last is None:
                continue

        out.append(
            {
                "id": str(r.id),
                "kind": r.kind,
                "name": name,
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
    if room.kind == RoomKind.DIRECT:
        raise ChatError("A one-to-one conversation is between the two of you.")
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
