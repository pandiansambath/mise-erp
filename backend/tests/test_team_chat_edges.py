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


@pytest.mark.asyncio
async def test_the_platform_operator_is_not_in_the_hotels_staff_room(
    client, db, make_user, auth_header
):
    """Support is attached to a hotel so it can help — which would otherwise
    place it silently inside the hotel's private staff room, reading a
    conversation nobody in the restaurant knows it is in. Access to run a hotel
    is not consent to sit in its break room."""
    owner = await make_user("hotel-owner@nirai.com", Role.SUPER_ADMIN.value)
    operator = await make_user("operator@dineai.cloud", Role.SUPER_ADMIN.value)
    operator.is_platform_owner = True
    await db.commit()

    # The hotel's own owner sees both rooms; the operator sees none.
    assert RoomKind.EVERYONE in await _rooms(client, auth_header, owner)
    assert await _rooms(client, auth_header, operator) == {}

    # Nor can they reach one by id.
    room = (await _rooms(client, auth_header, owner))[RoomKind.EVERYONE]
    assert (
        await client.get(
            f"/api/chat/rooms/{room['id']}/messages", headers=auth_header(operator)
        )
    ).status_code == 404

    # And they are not offered as somebody to add to a group.
    people = await client.get("/api/chat/people", headers=auth_header(owner))
    assert people.status_code == 200
    assert all(p["email"] != "operator@dineai.cloud" for p in people.json())


@pytest.mark.asyncio
async def test_the_tablet_by_the_door_is_not_in_the_staff_room(client, make_user, auth_header):
    """The kiosk is not a person. It sits unattended on a counter where anyone
    can touch it, which is why it already reaches nothing that reveals what
    people earn — and a private staff conversation left open on that screen is
    the same exposure by another route, only worse, because chat is where
    people speak freely."""
    owner = await make_user("kiosk-owner@nirai.com", Role.SUPER_ADMIN.value)
    tablet = await make_user("tablet@nirai.com", Role.KIOSK.value)

    assert await _rooms(client, auth_header, tablet) == {}

    room = (await _rooms(client, auth_header, owner))[RoomKind.EVERYONE]
    assert (
        await client.get(f"/api/chat/rooms/{room['id']}/messages", headers=auth_header(tablet))
    ).status_code == 404
    assert (
        await client.post(
            f"/api/chat/rooms/{room['id']}/messages",
            headers=auth_header(tablet),
            json={"body": "hello from the counter"},
        )
    ).status_code == 404

    people = await client.get("/api/chat/people", headers=auth_header(owner))
    assert all(p["email"] != "tablet@nirai.com" for p in people.json())


@pytest.mark.asyncio
async def test_anyone_can_message_anyone_one_to_one(client, make_user, auth_header):
    """"one to one within the hotel — like any staff can chat with anyone, like
    organisation in teams". The thread used to live at the bottom of an employee
    record on an admin page, so a cashier or a chef — who cannot open employee
    records — had no way to message a soul."""
    chef = await make_user("dm-chef@nirai.com", Role.KITCHEN_MANAGER.value)
    cashier = await make_user("dm-cashier@nirai.com", Role.CASHIER.value)

    # Neither administers logins, and both can still find each other.
    people = await client.get("/api/chat/people", headers=auth_header(chef))
    assert people.status_code == 200
    assert any(p["id"] == str(cashier.id) for p in people.json())
    # ...but the address book stays shut: a name and a job is what you need.
    assert all(p["email"] == "" for p in people.json())
    # And you are not offered yourself.
    assert all(p["id"] != str(chef.id) for p in people.json())

    opened = await client.post(
        "/api/chat/direct", headers=auth_header(chef), json={"user_id": str(cashier.id)}
    )
    assert opened.status_code == 200, opened.text
    rid = opened.json()["id"]

    said = await client.post(
        f"/api/chat/rooms/{rid}/messages",
        headers=auth_header(chef),
        json={"body": "can you take the till at six?"},
    )
    assert said.status_code == 200, said.text

    # The other end sees the same conversation...
    seen = await client.get(f"/api/chat/rooms/{rid}/messages", headers=auth_header(cashier))
    assert seen.status_code == 200
    assert "can you take the till at six?" in [m["body"] for m in seen.json()]

    # ...and nobody else does, however senior.
    owner = await make_user("dm-owner@nirai.com", Role.SUPER_ADMIN.value)
    assert (
        await client.get(f"/api/chat/rooms/{rid}/messages", headers=auth_header(owner))
    ).status_code == 404


@pytest.mark.asyncio
async def test_one_conversation_per_pair_whichever_way_round(client, make_user, auth_header):
    """A→B and B→A are the same thread. Two rooms would each hold half the
    history and neither would look wrong."""
    a = await make_user("pair-a@nirai.com", Role.MANAGER.value)
    b = await make_user("pair-b@nirai.com", Role.STAFF.value)

    first = await client.post(
        "/api/chat/direct", headers=auth_header(a), json={"user_id": str(b.id)}
    )
    second = await client.post(
        "/api/chat/direct", headers=auth_header(b), json={"user_id": str(a.id)}
    )
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]

    # It wears the OTHER person's name, so each of them sees who they are talking to.
    assert first.json()["name"] != second.json()["name"]


@pytest.mark.asyncio
async def test_a_direct_room_refuses_the_things_it_is_not(client, make_user, auth_header):
    owner = await make_user("dm-solo@nirai.com", Role.SUPER_ADMIN.value)
    mate = await make_user("dm-mate@nirai.com", Role.STAFF.value)

    alone = await client.post(
        "/api/chat/direct", headers=auth_header(owner), json={"user_id": str(owner.id)}
    )
    assert alone.status_code == 400

    rid = (
        await client.post(
            "/api/chat/direct", headers=auth_header(owner), json={"user_id": str(mate.id)}
        )
    ).json()["id"]
    # Its membership is not a list anyone edits — it is the two of them.
    assert (
        await client.put(
            f"/api/chat/rooms/{rid}/members",
            headers=auth_header(owner),
            json={"member_ids": []},
        )
    ).status_code == 400


@pytest.mark.asyncio
async def test_an_empty_conversation_does_not_clutter_the_list(client, make_user, auth_header):
    """Opening the picker and changing your mind should not leave a room behind
    in everybody's sidebar for ever."""
    a = await make_user("quiet-a@nirai.com", Role.SUPER_ADMIN.value)
    b = await make_user("quiet-b@nirai.com", Role.STAFF.value)

    await client.post("/api/chat/direct", headers=auth_header(a), json={"user_id": str(b.id)})
    listed = await client.get("/api/chat/rooms", headers=auth_header(a))
    assert all(r["kind"] != "direct" for r in listed.json())


@pytest.mark.asyncio
async def test_a_document_may_be_sent_now(client, make_user, auth_header):
    """"emoji gif video audio image doc etc, anything we can send via chat" —
    a rota PDF is a normal thing to hand a colleague."""
    owner = await make_user("doc-owner@nirai.com", Role.SUPER_ADMIN.value)
    room = (await _rooms(client, auth_header, owner))[RoomKind.EVERYONE]

    sent = await client.post(
        f"/api/chat/rooms/{room['id']}/attachment",
        headers=auth_header(owner),
        files={"file": ("rota.pdf", io.BytesIO(b"%PDF-1.4 rota"), "application/pdf")},
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["attachment_name"] == "rota.pdf"

    # An executable is still not a document.
    refused = await client.post(
        f"/api/chat/rooms/{room['id']}/attachment",
        headers=auth_header(owner),
        files={"file": ("run.exe", io.BytesIO(b"MZ"), "application/x-msdownload")},
    )
    assert refused.status_code == 400
