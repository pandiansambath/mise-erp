"""GIF search and sending, which went out untested.

The interesting part is not that a GIF arrives — it is the two guards around it.
The key never reaches the browser, and the server will only fetch from one host,
because "take this URL and go and get it" is how a server gets used to reach
places a browser could not.
"""
import uuid

import pytest

from app.auth.models import Role
from app.teamchat.models import RoomKind


async def _everyone(client, auth_header, user):
    r = await client.get("/api/chat/rooms", headers=auth_header(user))
    assert r.status_code == 200, r.text
    return next(x for x in r.json() if x["kind"] == RoomKind.EVERYONE)


@pytest.mark.asyncio
async def test_gif_search_says_so_when_it_is_not_configured(client, make_user, auth_header):
    """No key is the normal state until he adds one, and an empty grid would
    read as "there are no cat GIFs" — a remarkable thing for the internet to be
    true about. It answers in words instead."""
    porter = await make_user("gif-porter@nirai.com", Role.STAFF.value)

    r = await client.get("/api/chat/gifs?q=thanks", headers=auth_header(porter))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["configured"] is False
    assert body["results"] == []
    assert "Tenor" in body["hint"]
    # And it is offered to everyone, not just whoever administers logins —
    # a porter sending a thumbs-up is the whole point.


@pytest.mark.asyncio
async def test_only_tenor_may_be_fetched(client, make_user, auth_header):
    """The server fetches a URL the CLIENT chose. Without a host check that is a
    request forgery: an attacker names an internal address and the server, which
    can reach places the browser cannot, goes and gets it."""
    owner = await make_user("gif-owner@nirai.com", Role.SUPER_ADMIN.value)
    room = await _everyone(client, auth_header, owner)

    for bad in (
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost:8000/api/health",
        "https://evil.example.com/cat.gif",
        "https://tenor.com.evil.example.com/cat.gif",
    ):
        r = await client.post(
            f"/api/chat/rooms/{room['id']}/gif",
            headers=auth_header(owner),
            json={"url": bad},
        )
        assert r.status_code == 400, f"{bad} was not refused: {r.status_code}"
        assert "picker" in r.json()["detail"]


@pytest.mark.asyncio
async def test_a_gif_needs_a_room_you_can_open(client, make_user, auth_header):
    porter = await make_user("gif-outsider@nirai.com", Role.STAFF.value)
    owner = await make_user("gif-boss@nirai.com", Role.SUPER_ADMIN.value)

    rooms = await client.get("/api/chat/rooms", headers=auth_header(owner))
    managers = next(x for x in rooms.json() if x["kind"] == RoomKind.MANAGERS)

    r = await client.post(
        f"/api/chat/rooms/{managers['id']}/gif",
        headers=auth_header(porter),
        json={"url": "https://media.tenor.com/abc/cat.gif"},
    )
    assert r.status_code == 404, "a room you cannot open is a room that is not there"

    ghost = await client.post(
        f"/api/chat/rooms/{uuid.uuid4()}/gif",
        headers=auth_header(owner),
        json={"url": "https://media.tenor.com/abc/cat.gif"},
    )
    assert ghost.status_code == 404


@pytest.mark.asyncio
async def test_the_url_has_a_ceiling(client, make_user, auth_header):
    """A 600-character cap, because this string is handed to an HTTP client."""
    owner = await make_user("gif-long@nirai.com", Role.SUPER_ADMIN.value)
    room = await _everyone(client, auth_header, owner)

    r = await client.post(
        f"/api/chat/rooms/{room['id']}/gif",
        headers=auth_header(owner),
        json={"url": "https://media.tenor.com/" + "a" * 900 + ".gif"},
    )
    assert r.status_code == 422
