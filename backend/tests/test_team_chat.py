"""In-hotel team chat: Everyone, Managers, and groups the owner shapes.

    "inside hotel a grp chat i need... all (literally all) in that chat they can
     message, send gif, emojis, pic, video etc and its persistent, literally
     like a whatsapp... another side, we need a grp chat for super admin +
     manager roles alone... also i need one customisable grp creation feature."

Three promises are worth proving, and they pull against each other:

  * EVERYONE really means everyone. A kitchen porter holding no permission at
    all must still land in that room — so this suite deliberately uses a STAFF
    login with nothing granted to it.
  * MANAGERS really means only managers. The same porter must not see it, and
    must not be able to reach it by typing the id.
  * A closed room must not even admit that it exists. The endpoints answer 404
    rather than 403, because "you may not read this room" still tells an
    outsider the room is there.
"""
import io

import pytest

from app.auth.models import Role
from app.hotels.models import Hotel
from app.teamchat.models import RoomKind


async def _rooms(client, auth_header, user):
    r = await client.get("/api/chat/rooms", headers=auth_header(user))
    assert r.status_code == 200, r.text
    return {room["kind"]: room for room in r.json()}


@pytest.mark.asyncio
async def test_everyone_room_reaches_a_staff_login_with_no_permissions(
    client, make_user, auth_header
):
    """The whole point of the room. STAFF holds no read rights anywhere, and
    still opens this one."""
    porter = await make_user("porter@nirai.com", Role.STAFF.value)

    rooms = await _rooms(client, auth_header, porter)

    assert RoomKind.EVERYONE in rooms
    assert rooms[RoomKind.EVERYONE]["name"] == "Everyone"
    # ...and the other standing room is not offered to them.
    assert RoomKind.MANAGERS not in rooms


@pytest.mark.asyncio
async def test_managers_room_is_managers_only(client, make_user, auth_header):
    owner = await make_user("owner@nirai.com", Role.SUPER_ADMIN.value)
    chef = await make_user("chef@nirai.com", Role.KITCHEN_MANAGER.value)
    porter = await make_user("porter2@nirai.com", Role.STAFF.value)

    for boss in (owner, chef):
        assert RoomKind.MANAGERS in await _rooms(client, auth_header, boss)

    managers = (await _rooms(client, auth_header, owner))[RoomKind.MANAGERS]

    # Not merely absent from the list — unreachable even knowing the id, and
    # answered as though it were not there at all.
    sneak = await client.get(
        f"/api/chat/rooms/{managers['id']}/messages", headers=auth_header(porter)
    )
    assert sneak.status_code == 404
    posted = await client.post(
        f"/api/chat/rooms/{managers['id']}/messages",
        headers=auth_header(porter),
        json={"body": "let me in"},
    )
    assert posted.status_code == 404


@pytest.mark.asyncio
async def test_history_is_shared_and_persistent(client, make_user, auth_header):
    owner = await make_user("owner2@nirai.com", Role.SUPER_ADMIN.value)
    porter = await make_user("porter3@nirai.com", Role.STAFF.value)
    room = (await _rooms(client, auth_header, owner))[RoomKind.EVERYONE]

    said = await client.post(
        f"/api/chat/rooms/{room['id']}/messages",
        headers=auth_header(owner),
        json={"body": "Delivery lands at 3 \U0001f69a"},
    )
    assert said.status_code == 200, said.text

    # The other side reads the same thread — including the emoji, unmangled.
    seen = await client.get(
        f"/api/chat/rooms/{room['id']}/messages", headers=auth_header(porter)
    )
    assert seen.status_code == 200
    bodies = [m["body"] for m in seen.json()]
    assert "Delivery lands at 3 \U0001f69a" in bodies
    assert seen.json()[-1]["sender_name"]

    # An empty message is not a message.
    empty = await client.post(
        f"/api/chat/rooms/{room['id']}/messages",
        headers=auth_header(owner),
        json={"body": "   "},
    )
    assert empty.status_code == 400


@pytest.mark.asyncio
async def test_unread_counts_the_others_and_clears_on_opening(client, make_user, auth_header):
    owner = await make_user("owner3@nirai.com", Role.SUPER_ADMIN.value)
    porter = await make_user("porter4@nirai.com", Role.STAFF.value)
    room = (await _rooms(client, auth_header, owner))[RoomKind.EVERYONE]

    for line in ("Morning all", "Fridge 2 is fixed"):
        await client.post(
            f"/api/chat/rooms/{room['id']}/messages",
            headers=auth_header(owner),
            json={"body": line},
        )

    # Your own words are never unread to you...
    assert (await _rooms(client, auth_header, owner))[RoomKind.EVERYONE]["unread"] == 0
    # ...but they are to everybody else.
    theirs = (await _rooms(client, auth_header, porter))[RoomKind.EVERYONE]
    assert theirs["unread"] == 2
    assert theirs["preview"] == "Fridge 2 is fixed"

    await client.get(f"/api/chat/rooms/{room['id']}/messages", headers=auth_header(porter))
    assert (await _rooms(client, auth_header, porter))[RoomKind.EVERYONE]["unread"] == 0


@pytest.mark.asyncio
async def test_owner_makes_a_group_and_picks_who_is_in_it(client, make_user, auth_header):
    owner = await make_user("owner4@nirai.com", Role.SUPER_ADMIN.value)
    inside = await make_user("inside@nirai.com", Role.STAFF.value)
    outside = await make_user("outside@nirai.com", Role.STAFF.value)

    made = await client.post(
        "/api/chat/rooms",
        headers=auth_header(owner),
        json={"name": "Weekend crew", "emoji": "\U0001f389", "member_ids": [str(inside.id)]},
    )
    assert made.status_code == 200, made.text
    rid = made.json()["id"]

    # The two chosen see it; the third does not, and cannot reach it by id.
    for who in (owner, inside):
        assert any(r["id"] == rid for r in (await _rooms(client, auth_header, who)).values())
    assert all(r["id"] != rid for r in (await _rooms(client, auth_header, outside)).values())
    assert (
        await client.get(f"/api/chat/rooms/{rid}/messages", headers=auth_header(outside))
    ).status_code == 404

    # Membership is editable afterwards — that is what "whichever he wish" means.
    changed = await client.put(
        f"/api/chat/rooms/{rid}/members",
        headers=auth_header(owner),
        json={"member_ids": [str(inside.id), str(outside.id)]},
    )
    assert changed.status_code == 200, changed.text
    assert str(outside.id) in changed.json()["member_ids"]
    assert (
        await client.get(f"/api/chat/rooms/{rid}/messages", headers=auth_header(outside))
    ).status_code == 200


@pytest.mark.asyncio
async def test_staff_cannot_create_rooms_or_list_people(client, make_user, auth_header):
    porter = await make_user("porter5@nirai.com", Role.STAFF.value)
    made = await client.post(
        "/api/chat/rooms", headers=auth_header(porter), json={"name": "My own club"}
    )
    assert made.status_code == 403
    assert (await client.get("/api/chat/people", headers=auth_header(porter))).status_code == 403


@pytest.mark.asyncio
async def test_standing_rooms_cannot_be_closed_or_hand_edited(client, make_user, auth_header):
    """A hotel without an Everyone room is a hotel where a notice has nowhere
    to go, and a role-driven room with a hand-written member list would drift
    the moment somebody is promoted."""
    owner = await make_user("owner5@nirai.com", Role.SUPER_ADMIN.value)
    rooms = await _rooms(client, auth_header, owner)

    for kind in (RoomKind.EVERYONE, RoomKind.MANAGERS):
        rid = rooms[kind]["id"]
        assert (
            await client.delete(f"/api/chat/rooms/{rid}", headers=auth_header(owner))
        ).status_code == 400
        assert (
            await client.put(
                f"/api/chat/rooms/{rid}/members",
                headers=auth_header(owner),
                json={"member_ids": []},
            )
        ).status_code == 400

    # A group the owner made, on the other hand, closes — and then stops listing.
    made = await client.post(
        "/api/chat/rooms", headers=auth_header(owner), json={"name": "Christmas party"}
    )
    rid = made.json()["id"]
    assert (
        await client.delete(f"/api/chat/rooms/{rid}", headers=auth_header(owner))
    ).status_code == 200
    assert all(r["id"] != rid for r in (await _rooms(client, auth_header, owner)).values())


@pytest.mark.asyncio
async def test_pictures_and_video_only_and_the_file_is_room_scoped(
    client, make_user, auth_header
):
    owner = await make_user("owner6@nirai.com", Role.SUPER_ADMIN.value)
    porter = await make_user("porter6@nirai.com", Role.STAFF.value)
    managers = (await _rooms(client, auth_header, owner))[RoomKind.MANAGERS]

    # A document is not a photo — it belongs in Documents, where it gets filed.
    refused = await client.post(
        f"/api/chat/rooms/{managers['id']}/attachment",
        headers=auth_header(owner),
        files={"file": ("invoice.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")},
    )
    assert refused.status_code == 400

    sent = await client.post(
        f"/api/chat/rooms/{managers['id']}/attachment",
        headers=auth_header(owner),
        files={"file": ("fridge.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png")},
    )
    assert sent.status_code == 200, sent.text
    msg = sent.json()
    # response_model drops what it is not told about; the url is the whole point.
    assert msg["attachment_url"] and msg["attachment_type"] == "image/png"
    assert msg["attachment_name"] == "fridge.png"

    # The file is only as reachable as the room it was posted in.
    assert (
        await client.get(f"/api/chat/attachments/{msg['id']}", headers=auth_header(owner))
    ).status_code == 200
    assert (
        await client.get(f"/api/chat/attachments/{msg['id']}", headers=auth_header(porter))
    ).status_code == 404


@pytest.mark.asyncio
async def test_another_hotel_sees_none_of_it(client, db, make_user, auth_header):
    """The rooms are per hotel. A neighbouring restaurant on the same box must
    not so much as learn that ours has a Managers room."""
    ours = await make_user("ours@nirai.com", Role.SUPER_ADMIN.value)
    room = (await _rooms(client, auth_header, ours))[RoomKind.EVERYONE]
    await client.post(
        f"/api/chat/rooms/{room['id']}/messages",
        headers=auth_header(ours),
        json={"body": "our private staffing problem"},
    )

    other = Hotel(name="Next Door", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    stranger = await make_user(
        "stranger@nextdoor.com", Role.SUPER_ADMIN.value, hotel_id=other.id
    )

    # They get their OWN standing rooms, with different ids and no messages.
    theirs = await _rooms(client, auth_header, stranger)
    assert theirs[RoomKind.EVERYONE]["id"] != room["id"]
    assert theirs[RoomKind.EVERYONE]["preview"] is None
    assert (
        await client.get(f"/api/chat/rooms/{room['id']}/messages", headers=auth_header(stranger))
    ).status_code == 404
