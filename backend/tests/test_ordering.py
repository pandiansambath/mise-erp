"""Online ordering: menu → public order (snapshot pricing) → kitchen flow → tracking."""
import asyncio

import pytest

from app.auth.models import Role
from app.core import notify


async def _menu_item(client, hdr, name="Butter Chicken", price="12.50", **extra):
    r = await client.post(
        "/api/ordering/menu",
        headers=hdr,
        json={"name": name, "price": price, "category": "Mains", **extra},
    )
    assert r.status_code == 201
    return r.json()


@pytest.mark.asyncio
async def test_full_order_lifecycle(client, make_user, auth_header, monkeypatch, db):
    sent: list[tuple[str, str]] = []

    async def fake_send(to, subject, text, html=None):
        sent.append((to, subject))
        return True

    monkeypatch.setattr(notify, "send_email", fake_send)

    owner = await make_user("kitchen@x.com", Role.SUPER_ADMIN.value)
    hdr = auth_header(owner)
    dish = await _menu_item(client, hdr)
    drink = await _menu_item(client, hdr, name="Mango Lassi", price="3.20", category="Drinks")
    hidden = await _menu_item(client, hdr, name="Off Menu", price="9.99")
    await client.patch(f"/api/ordering/menu/{hidden['id']}", headers=hdr,
                       json={"is_available": False})

    # the public menu only shows what's switched ON
    pub = await client.get(f"/api/public/order/{owner.hotel_id}")
    assert pub.status_code == 200
    names = [m["name"] for m in pub.json()["menu"]]
    assert "Butter Chicken" in names and "Off Menu" not in names

    # place an order — totals come from OUR prices, not the client
    placed = await client.post(
        f"/api/public/order/{owner.hotel_id}",
        json={
            "customer_name": "Priya",
            "phone": "07700900123",
            "fulfilment": "PICKUP",
            "items": [
                {"menu_item_id": dish["id"], "quantity": 2},
                {"menu_item_id": drink["id"], "quantity": 1},
            ],
        },
    )
    assert placed.status_code == 201
    body = placed.json()
    assert body["total"] == "28.20"  # 2×12.50 + 3.20
    assert body["code"].startswith("M-")

    await asyncio.sleep(0.05)  # the kitchen email fires in the background
    assert any("New order" in subj for _, subj in sent)

    # the board sees it; vitals count it
    board = await client.get("/api/ordering/orders", headers=hdr)
    assert board.status_code == 200
    data = board.json()
    assert data["vitals"]["today_orders"] == 1
    order = data["orders"][0]
    assert order["status"] == "NEW" and len(order["items"]) == 2

    # kitchen flow: NEW → CONFIRMED → PREPARING → READY → COMPLETED
    oid = order["id"]
    for nxt in ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]:
        r = await client.patch(f"/api/ordering/orders/{oid}", headers=hdr,
                               json={"status": nxt})
        assert r.status_code == 200, nxt
        assert r.json()["status"] == nxt

    # no jumping the queue: COMPLETED is terminal
    dead = await client.patch(f"/api/ordering/orders/{oid}", headers=hdr,
                              json={"status": "PREPARING"})
    assert dead.status_code == 422

    # the customer tracked it publicly the whole time
    track = await client.get(f"/api/public/order/track/{oid}")
    assert track.status_code == 200 and track.json()["status"] == "COMPLETED"

    # ONE-STOP: the completed order booked itself into the money engine
    from decimal import Decimal

    from sqlalchemy import select

    from app.sales.models import SalesChannel, SalesLine

    db.expire_all()
    channel = (
        await db.execute(
            select(SalesChannel).where(
                SalesChannel.hotel_id == owner.hotel_id, SalesChannel.name == "Online Orders"
            )
        )
    ).scalar_one()
    line = (
        await db.execute(select(SalesLine).where(SalesLine.channel_id == channel.id))
    ).scalar_one()
    assert line.gross_amount == Decimal("28.20")


@pytest.mark.asyncio
async def test_order_guards(client, make_user, auth_header):
    owner = await make_user("guard@x.com", Role.SUPER_ADMIN.value)
    hdr = auth_header(owner)
    dish = await _menu_item(client, hdr, name="Dal", price="6.00")

    # delivery without an address is refused
    r = await client.post(
        f"/api/public/order/{owner.hotel_id}",
        json={"customer_name": "Ben", "phone": "077001", "fulfilment": "DELIVERY",
              "items": [{"menu_item_id": dish["id"], "quantity": 1}]},
    )
    assert r.status_code == 422

    # an item that just went off-menu blocks the order cleanly
    await client.patch(f"/api/ordering/menu/{dish['id']}", headers=hdr,
                       json={"is_available": False})
    gone = await client.post(
        f"/api/public/order/{owner.hotel_id}",
        json={"customer_name": "Ben", "phone": "077001", "fulfilment": "PICKUP",
              "items": [{"menu_item_id": dish["id"], "quantity": 1}]},
    )
    assert gone.status_code == 409

    # staff can look at the board but can't run it
    staff = await make_user("runner@x.com", Role.STAFF.value)
    denied = await client.post("/api/ordering/menu", headers=auth_header(staff),
                               json={"name": "Nope", "price": "1.00"})
    assert denied.status_code == 403


@pytest.mark.asyncio
async def test_busy_pause_blocks_orders_and_prep_is_public(client, make_user, auth_header):
    owner = await make_user("busy@x.com", Role.SUPER_ADMIN.value)
    hdr = auth_header(owner)
    dish = await _menu_item(client, hdr, name="Biryani", price="11.00")

    # the prep estimate is visible on the public menu
    r = await client.patch("/api/ordering/settings", headers=hdr, json={"prep_minutes": 35})
    assert r.status_code == 200 and r.json()["prep_minutes"] == 35
    pub = await client.get(f"/api/public/order/{owner.hotel_id}")
    assert pub.json()["hotel"]["prep_minutes"] == 35

    # pause -> the public door politely refuses
    await client.patch("/api/ordering/settings", headers=hdr, json={"ordering_paused": True})
    blocked = await client.post(
        f"/api/public/order/{owner.hotel_id}",
        json={"customer_name": "Sam", "phone": "07700", "fulfilment": "PICKUP",
              "items": [{"menu_item_id": dish["id"], "quantity": 1}]},
    )
    assert blocked.status_code == 423

    # reopen -> orders flow again
    await client.patch("/api/ordering/settings", headers=hdr, json={"ordering_paused": False})
    ok = await client.post(
        f"/api/public/order/{owner.hotel_id}",
        json={"customer_name": "Sam", "phone": "07700", "fulfilment": "PICKUP",
              "items": [{"menu_item_id": dish["id"], "quantity": 1}]},
    )
    assert ok.status_code == 201
