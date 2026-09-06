"""Staff ↔ owner messages: persistent, private to the pair, unread on both sides.

    "staff can comment that owner can see, owner can comment that staff can see
     here. they even can chat like whatsapp. make this chat history persistent"

The assertion that matters most is not that a message sends — it is that one
member of staff can never read another's thread. Everything under /me is scoped
by the employee resolved from the token, and this proves it rather than assuming.
"""
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.employees import service


async def _linked(db, hotel, make_user, email, name):
    u = await make_user(email, Role.STAFF.value)
    emp = await service.create_employee(
        db, hotel.id, full_name=name, salary_type="HOURLY", hourly_rate=Decimal("10.00")
    )
    await service.update_employee(db, emp, user_id=u.id)
    return u, emp


@pytest.mark.asyncio
async def test_both_sides_see_one_conversation(client, db, hotel, make_user, auth_header):
    owner = await make_user("chat-owner@nirai.com", Role.SUPER_ADMIN.value)
    staff, emp = await _linked(db, hotel, make_user, "chat-staff@nirai.com", "Selvi")

    said = await client.post(
        "/api/me/messages", headers=auth_header(staff), json={"body": "Can I swap Friday?"}
    )
    assert said.status_code == 200, said.text
    assert said.json()["from_staff"] is True

    replied = await client.post(
        f"/api/employees/{emp.id}/messages",
        headers=auth_header(owner),
        json={"body": "Yes — take Saturday instead."},
    )
    assert replied.status_code == 200, replied.text
    assert replied.json()["from_staff"] is False

    # ONE thread, both sides, oldest first.
    for who, header in (("staff", auth_header(staff)), ("owner", auth_header(owner))):
        url = "/api/me/messages" if who == "staff" else f"/api/employees/{emp.id}/messages"
        body = (await client.get(url, headers=header)).json()
        bodies = [m["body"] for m in body["messages"]]
        assert bodies == ["Can I swap Friday?", "Yes — take Saturday instead."], who


@pytest.mark.asyncio
async def test_history_survives(client, db, hotel, make_user, auth_header):
    """"make this chat history persistent" — it is a row, not session state."""
    staff, emp = await _linked(db, hotel, make_user, "chat-persist@nirai.com", "Bala")
    h = auth_header(staff)
    for n in range(3):
        await client.post("/api/me/messages", headers=h, json={"body": f"note {n}"})

    again = (await client.get("/api/me/messages", headers=h)).json()
    assert [m["body"] for m in again["messages"]] == ["note 0", "note 1", "note 2"]


@pytest.mark.asyncio
async def test_a_staff_member_cannot_read_anothers_thread(
    client, db, hotel, make_user, auth_header
):
    """The assertion that matters. /me resolves the employee from the TOKEN, so
    there is no id to tamper with — but that has to be true, not assumed."""
    a_user, a_emp = await _linked(db, hotel, make_user, "chat-a@nirai.com", "Person A")
    b_user, b_emp = await _linked(db, hotel, make_user, "chat-b@nirai.com", "Person B")

    await client.post(
        "/api/me/messages", headers=auth_header(a_user), json={"body": "private to A"}
    )

    seen_by_b = (await client.get("/api/me/messages", headers=auth_header(b_user))).json()
    assert seen_by_b["messages"] == [], "one staff member read another's thread"

    # And the owner-side route is not reachable by staff at all.
    poked = await client.get(f"/api/employees/{a_emp.id}/messages", headers=auth_header(b_user))
    assert poked.status_code == 403


@pytest.mark.asyncio
async def test_unread_counts_the_other_side_only(client, db, hotel, make_user, auth_header):
    owner = await make_user("chat-unread-owner@nirai.com", Role.SUPER_ADMIN.value)
    staff, emp = await _linked(db, hotel, make_user, "chat-unread@nirai.com", "Praveen")

    await client.post("/api/me/messages", headers=auth_header(staff), json={"body": "hello"})

    # The owner has not looked yet, so one is waiting for them.
    owner_view = (
        await client.get(f"/api/employees/{emp.id}/messages", headers=auth_header(owner))
    ).json()
    assert owner_view["unread"] == 1

    # Opening it counted as reading it.
    again = (
        await client.get(f"/api/employees/{emp.id}/messages", headers=auth_header(owner))
    ).json()
    assert again["unread"] == 0

    # And your own words are never unread to you.
    mine = (await client.get("/api/me/messages", headers=auth_header(staff))).json()
    assert mine["unread"] == 0


@pytest.mark.asyncio
async def test_an_empty_message_is_refused(client, db, hotel, make_user, auth_header):
    staff, _ = await _linked(db, hotel, make_user, "chat-empty@nirai.com", "Quiet")
    r = await client.post("/api/me/messages", headers=auth_header(staff), json={"body": "   "})
    assert r.status_code in (400, 422)
