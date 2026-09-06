"""The edges of team chat: refusals, empty rooms, and files that go missing.

The happy paths live in test_team_chat.py. These are the branches a person only
meets when something has gone wrong, which is exactly when a clear answer
matters most — and they were the untested half of the module, leaving the
coverage gate with almost no margin.
"""
import io
import uuid

import pytest

from app.auth.models import Role
from app.teamchat import service
from app.teamchat.models import ChatRoom, RoomKind


async def _rooms(client, auth_header, user):
    r = await client.get("/api/chat/rooms", headers=auth_header(user))
    assert r.status_code == 200, r.text
    return {room["kind"]: room for room in r.json()}


@pytest.mark.asyncio
async def test_a_room_that_does_not_exist_is_a_404_not_a_500(client, make_user, auth_header):
    owner = await make_user("edge-owner@nirai.com", Role.SUPER_ADMIN.value)
    ghost = uuid.uuid4()

    for call in (
        client.get(f"/api/chat/rooms/{ghost}/messages", headers=auth_header(owner)),
        client.get(f"/api/chat/rooms/{ghost}/members", headers=auth_header(owner)),
        client.delete(f"/api/chat/rooms/{ghost}", headers=auth_header(owner)),
    ):
        assert (await call).status_code == 404


@pytest.mark.asyncio
async def test_an_oversized_file_is_refused_with_the_limit_in_the_message(
    client, make_user, auth_header, monkeypatch
):
    """The number in the message is read off the setting, so the two cannot
    drift apart and tell somebody a limit that is not the limit."""
    owner = await make_user("edge-big@nirai.com", Role.SUPER_ADMIN.value)
    room = (await _rooms(client, auth_header, owner))[RoomKind.EVERYONE]

    # Shrink the cap rather than uploading 25MB through the test client.
    monkeypatch.setattr(service, "MAX_ATTACHMENT_BYTES", 8)

    too_big = await client.post(
        f"/api/chat/rooms/{room['id']}/attachment",
        headers=auth_header(owner),
        files={"file": ("big.png", io.BytesIO(b"\x89PNG\r\n\x1a\n0123456789"), "image/png")},
    )
    assert too_big.status_code == 413
    assert "too big" in too_big.json()["detail"].lower()


@pytest.mark.asyncio
async def test_a_file_the_store_has_lost_says_so(client, db, make_user, auth_header):
    """The row survives its file. Answering 404 with a sentence beats a stack
    trace, and beats pretending the message was never there."""
    owner = await make_user("edge-lost@nirai.com", Role.SUPER_ADMIN.value)
    room = (await _rooms(client, auth_header, owner))[RoomKind.EVERYONE]

    sent = await client.post(
        f"/api/chat/rooms/{room['id']}/attachment",
        headers=auth_header(owner),
        files={"file": ("gone.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png")},
    )
    assert sent.status_code == 200, sent.text
    msg_id = sent.json()["id"]

    from app.core.storage import get_storage
    from app.teamchat.models import ChatRoomMessage

    row = await db.get(ChatRoomMessage, uuid.UUID(msg_id))
    get_storage().delete(row.attachment_key)

    lost = await client.get(f"/api/chat/attachments/{msg_id}", headers=auth_header(owner))
    assert lost.status_code == 404
    assert "no longer stored" in lost.json()["detail"]

    # A message id that is not an attachment at all is also a 404, not a crash.
    plain = await client.post(
        f"/api/chat/rooms/{room['id']}/messages",
        headers=auth_header(owner),
        json={"body": "just words"},
    )
    assert (
        await client.get(
            f"/api/chat/attachments/{plain.json()['id']}", headers=auth_header(owner)
        )
    ).status_code == 404
    assert (
        await client.get(f"/api/chat/attachments/{uuid.uuid4()}", headers=auth_header(owner))
    ).status_code == 404


@pytest.mark.asyncio
async def test_a_group_needs_a_name_and_a_message_needs_a_length(
    client, make_user, auth_header
):
    owner = await make_user("edge-name@nirai.com", Role.SUPER_ADMIN.value)

    blank = await client.post("/api/chat/rooms", headers=auth_header(owner), json={"name": "   "})
    assert blank.status_code == 400
    assert "name" in blank.json()["detail"].lower()

    room = (await _rooms(client, auth_header, owner))[RoomKind.EVERYONE]
    # 4000 is the ceiling; the model refuses beyond it before the service sees it.
    long_one = await client.post(
        f"/api/chat/rooms/{room['id']}/messages",
        headers=auth_header(owner),
        json={"body": "x" * 4001},
    )
    assert long_one.status_code == 422


@pytest.mark.asyncio
async def test_the_preview_names_an_attachment_when_there_are_no_words(
    client, make_user, auth_header
):
    """A room whose last message is a photo should not look empty in the list."""
    owner = await make_user("edge-prev@nirai.com", Role.SUPER_ADMIN.value)
    other = await make_user("edge-prev2@nirai.com", Role.MANAGER.value)
    room = (await _rooms(client, auth_header, owner))[RoomKind.MANAGERS]

    await client.post(
        f"/api/chat/rooms/{room['id']}/attachment",
        headers=auth_header(owner),
        files={"file": ("fridge.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png")},
    )

    seen = (await _rooms(client, auth_header, other))[RoomKind.MANAGERS]
    assert seen["preview"] and "fridge.png" in seen["preview"]
    assert seen["unread"] == 1
    assert seen["last_sender"]


@pytest.mark.asyncio
async def test_emptying_a_group_still_leaves_whoever_made_it(client, make_user, auth_header):
    owner = await make_user("edge-empty@nirai.com", Role.SUPER_ADMIN.value)
    member = await make_user("edge-member@nirai.com", Role.STAFF.value)

    made = await client.post(
        "/api/chat/rooms",
        headers=auth_header(owner),
        json={"name": "Briefly", "member_ids": [str(member.id)]},
    )
    rid = made.json()["id"]
    assert (
        await client.get(f"/api/chat/rooms/{rid}/messages", headers=auth_header(member))
    ).status_code == 200

    emptied = await client.put(
        f"/api/chat/rooms/{rid}/members", headers=auth_header(owner), json={"member_ids": []}
    )
    assert emptied.status_code == 200

    # The member is out...
    assert (
        await client.get(f"/api/chat/rooms/{rid}/messages", headers=auth_header(member))
    ).status_code == 404
    # ...but whoever made it is kept, whatever the list said. An owner who could
    # empty themselves out would lose the room AND the ability to close it,
    # because closing requires being able to see it.
    assert emptied.json()["member_ids"] == [str(owner.id)]
    assert (
        await client.get(f"/api/chat/rooms/{rid}/messages", headers=auth_header(owner))
    ).status_code == 200
    assert (
        await client.delete(f"/api/chat/rooms/{rid}", headers=auth_header(owner))
    ).status_code == 200


@pytest.mark.asyncio
async def test_a_closed_group_stops_answering(client, db, make_user, auth_header):
    owner = await make_user("edge-closed@nirai.com", Role.SUPER_ADMIN.value)
    made = await client.post(
        "/api/chat/rooms", headers=auth_header(owner), json={"name": "Short lived"}
    )
    rid = made.json()["id"]
    await client.delete(f"/api/chat/rooms/{rid}", headers=auth_header(owner))

    # Closing is a flag, not a delete — the history survives, but the door shuts.
    assert (await db.get(ChatRoom, uuid.UUID(rid))) is not None
    assert (
        await client.get(f"/api/chat/rooms/{rid}/messages", headers=auth_header(owner))
    ).status_code == 404


@pytest.mark.asyncio
async def test_the_standing_rooms_are_made_once_however_often_they_are_asked_for(
    client, db, make_user, auth_header
):
    """The rooms are created lazily on first read. Reading twice must not make
    a second Everyone — the split-room bug the unique index exists to stop."""
    owner = await make_user("edge-once@nirai.com", Role.SUPER_ADMIN.value)

    for _ in range(3):
        await _rooms(client, auth_header, owner)

    from sqlalchemy import func, select

    count = (
        await db.execute(
            select(func.count())
            .select_from(ChatRoom)
            .where(
                ChatRoom.hotel_id == owner.hotel_id,
                ChatRoom.kind == RoomKind.EVERYONE,
            )
        )
    ).scalar()
    assert count == 1


@pytest.mark.asyncio
async def test_who_counts_as_a_manager(make_user):
    """The Managers room is membership by rule, so the rule itself is worth
    pinning down: a promotion should move somebody in without anyone editing
    a list, and a cashier should not drift in by accident."""
    for role, expected in (
        (Role.SUPER_ADMIN.value, True),
        (Role.MANAGER.value, True),
        (Role.KITCHEN_MANAGER.value, True),
        (Role.ACCOUNTANT.value, False),
        (Role.CASHIER.value, False),
        (Role.STAFF.value, False),
        (Role.KIOSK.value, False),
    ):
        user = await make_user(f"rule-{role.lower()}@nirai.com", role)
        assert service.is_manager(user) is expected, role
