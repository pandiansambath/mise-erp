"""Talent board (staff lending) + persisted hotel-to-hotel chat."""
import pytest

from app.auth.models import Role
from app.hotels.models import Hotel


async def _second_hotel_owner(db, make_user):
    """A user in a DIFFERENT hotel — the other side of a chat."""
    h2 = Hotel(name="Second Spice", country="GB", base_currency="GBP", city="Leeds")
    db.add(h2)
    await db.commit()
    await db.refresh(h2)
    owner = await make_user("owner2@second.com", Role.SUPER_ADMIN.value, hotel_id=h2.id)
    return h2, owner


@pytest.mark.asyncio
async def test_staff_post_appears_on_public_board(client, make_user, auth_header):
    owner = await make_user("lend@x.com", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    made = await client.post(
        "/api/talent/posts", headers=h,
        data={"worker_name": "Arjun", "role_title": "Sous Chef",
              "blurb": "Free weekends", "skills": "tandoor,grill"},
    )
    assert made.status_code == 201
    assert made.json()["worker_name"] == "Arjun"

    board = await client.get("/api/public/talent")
    assert board.status_code == 200
    assert any(p["worker_name"] == "Arjun" and p["hotel_name"] for p in board.json())


@pytest.mark.asyncio
async def test_chat_is_persisted_and_two_sided(client, make_user, auth_header, db):
    # hotel A posts staff; hotel B opens a chat and they talk
    a_owner = await make_user("a@one.com", Role.SUPER_ADMIN.value)
    ha = auth_header(a_owner)
    post = await client.post(
        "/api/talent/posts", headers=ha,
        data={"worker_name": "Meena", "role_title": "Waiter"},
    )
    post_id = post.json()["id"]

    _h2, b_owner = await _second_hotel_owner(db, make_user)
    hb = auth_header(b_owner)

    opened = await client.post("/api/talent/chats/open", headers=hb,
                               json={"staff_post_id": post_id})
    assert opened.status_code == 200
    chat_id = opened.json()["chat_id"]

    # opening again returns the SAME chat (get-or-create)
    again = await client.post("/api/talent/chats/open", headers=hb,
                              json={"staff_post_id": post_id})
    assert again.json()["chat_id"] == chat_id

    # B sends, A replies — both stored
    await client.post(f"/api/talent/chats/{chat_id}/messages", headers=hb,
                      json={"body": "Is Meena free next week?"})
    await client.post(f"/api/talent/chats/{chat_id}/messages", headers=ha,
                      json={"body": "Yes! Mon–Wed."})

    # A sees the thread with correct sidedness (A's own message is "mine")
    a_view = await client.get(f"/api/talent/chats/{chat_id}/messages", headers=ha)
    msgs = a_view.json()["messages"]
    assert [m["body"] for m in msgs] == ["Is Meena free next week?", "Yes! Mon–Wed."]
    assert msgs[0]["mine"] is False and msgs[1]["mine"] is True

    # unread badge: A just read it → 0; B has A's reply unread → 1
    assert (await client.get("/api/talent/chats/unread-count", headers=ha)).json()["unread"] == 0
    assert (await client.get("/api/talent/chats/unread-count", headers=hb)).json()["unread"] == 1

    # each hotel's chat list shows the OTHER hotel's name + last message
    b_chats = (await client.get("/api/talent/chats", headers=hb)).json()
    assert b_chats[0]["other_hotel"] == "Test Hotel"
    assert b_chats[0]["last_message"] == "Yes! Mon–Wed."

    # you can't chat with yourself
    self_chat = await client.post("/api/talent/chats/open", headers=ha,
                                  json={"staff_post_id": post_id})
    assert self_chat.status_code == 400
