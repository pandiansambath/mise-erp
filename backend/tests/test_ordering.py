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

    hid = owner.hotel_id  # capture BEFORE expire_all — expired attrs can't lazy-load in async
    db.expire_all()
    channel = (
        await db.execute(
            select(SalesChannel).where(
                SalesChannel.hotel_id == hid, SalesChannel.name == "Online Orders"
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


@pytest.mark.asyncio
async def test_autopilot_deducts_ingredients_on_completion(client, make_user, auth_header, db):
    """ONE-STOP: a completed online order eats its recipe's ingredients out of
    stock automatically (clamped, never blocking)."""
    from decimal import Decimal

    from sqlalchemy import select

    from app.inventory.models import Item
    from app.recipes.models import Recipe, RecipeIngredient

    owner = await make_user("autopilot@x.com", Role.SUPER_ADMIN.value)
    hdr = auth_header(owner)
    hid = owner.hotel_id

    chicken = Item(hotel_id=hid, name="Chicken", unit="kg", current_stock=Decimal("10"))
    db.add(chicken)
    recipe = Recipe(hotel_id=hid, name="Butter Chicken", selling_price=Decimal("12.50"))
    db.add(recipe)
    await db.flush()
    db.add(
        RecipeIngredient(
            recipe_id=recipe.id, item_id=chicken.id, quantity=Decimal("0.5"), unit="kg"
        )
    )
    await db.commit()
    chicken_id, recipe_id = chicken.id, recipe.id

    dish = await client.post(
        "/api/ordering/menu", headers=hdr,
        json={"name": "Butter Chicken", "price": "12.50", "recipe_id": str(recipe_id)},
    )
    placed = await client.post(
        f"/api/public/order/{hid}",
        json={"customer_name": "Ana", "phone": "07700", "fulfilment": "PICKUP",
              "items": [{"menu_item_id": dish.json()["id"], "quantity": 4}]},
    )
    oid = placed.json()["id"]
    for nxt in ["CONFIRMED", "PREPARING", "READY", "COMPLETED"]:
        await client.patch(f"/api/ordering/orders/{oid}", headers=hdr, json={"status": nxt})

    db.expire_all()
    fresh = (await db.execute(select(Item).where(Item.id == chicken_id))).scalar_one()
    assert fresh.current_stock == Decimal("8.000")  # 10 - 4×0.5


# ── Dine-in: a QR on every table ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_table_qr_orders_land_in_the_kitchen(client, make_user, auth_header, hotel):
    """The whole feature in one test: scan, see the menu, order, kitchen sees it.

    "customer comes and sits on table and he can scan qr... at the same time
     other side customer, table, items etc super admin will get and this will be
     displayed to tab which is inside the kitchen."
    """
    admin = await make_user("dinein@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)

    made = await client.post("/api/ordering/tables", json={"label": "Table 1", "seats": 4}, headers=h)
    assert made.status_code == 201, made.text
    code = made.json()["code"]
    assert len(code) == 7, "the printed code should stay short enough to type"

    dish = await client.post(
        "/api/ordering/menu",
        json={"name": "Idli", "price": "3.00", "category": "Breakfast"},
        headers=h,
    )
    assert dish.status_code == 201, dish.text
    dish_id = dish.json()["id"]

    # The diner's side needs NO login at all.
    menu = await client.get(f"/api/public/table/{code}")
    assert menu.status_code == 200, menu.text
    assert menu.json()["table"]["label"] == "Table 1"
    assert any(m["id"] == dish_id for m in menu.json()["menu"])

    placed = await client.post(
        f"/api/public/table/{code}",
        json={"items": [{"menu_item_id": dish_id, "quantity": 3}]},
    )
    assert placed.status_code == 201, placed.text
    assert placed.json()["total"] == "9.00", "3 idli at £3 is £9 — priced from OUR menu"

    # ...and the kitchen sees it, pinned to the table.
    board = (await client.get("/api/ordering/orders", headers=h)).json()
    mine = [o for o in board["orders"] if o["code"] == placed.json()["code"]]
    assert mine, "the order never reached the kitchen board"
    assert mine[0]["fulfilment"] == "DINE_IN"


@pytest.mark.asyncio
async def test_a_diner_cannot_name_their_own_price(client, make_user, auth_header):
    """A browser console must not be a discount. Prices come from our menu."""
    admin = await make_user("price@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    code = (
        await client.post("/api/ordering/tables", json={"label": "T9"}, headers=h)
    ).json()["code"]
    dish_id = (
        await client.post(
            "/api/ordering/menu", json={"name": "Dosa", "price": "5.00"}, headers=h
        )
    ).json()["id"]

    placed = await client.post(
        f"/api/public/table/{code}",
        # A tampered client sends a price. It is simply not read.
        json={"items": [{"menu_item_id": dish_id, "quantity": 2, "unit_price": "0.01"}]},
    )
    assert placed.status_code == 201, placed.text
    assert placed.json()["total"] == "10.00"


@pytest.mark.asyncio
async def test_calling_for_help_raises_a_ticket_even_with_no_order(client, make_user, auth_header):
    """The automated wave. Water or a spoon is a request with no food attached,
    and it still has to reach the same screen."""
    admin = await make_user("help@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    code = (
        await client.post("/api/ordering/tables", json={"label": "T7"}, headers=h)
    ).json()["code"]

    r = await client.post(f"/api/public/table/{code}/help")
    assert r.status_code == 202, r.text
    live = (await client.get(f"/api/public/table/{code}/orders")).json()
    assert live["orders"], "the call for help never appeared"


@pytest.mark.asyncio
async def test_bulk_tables_can_be_pressed_twice_without_duplicates(client, make_user, auth_header):
    """Safely repeatable: a slip of the finger must not create Table 1 twice."""
    admin = await make_user("bulk@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    first = await client.post("/api/ordering/tables/bulk", json={"count": 5}, headers=h)
    assert first.status_code == 201, first.text
    assert len(first.json()) == 5
    await client.post("/api/ordering/tables/bulk", json={"count": 5}, headers=h)
    all_tables = (await client.get("/api/ordering/tables", headers=h)).json()
    labels = [t["label"] for t in all_tables]
    assert len(labels) == len(set(labels)), f"duplicate table labels: {labels}"


@pytest.mark.asyncio
async def test_an_unknown_or_disabled_table_takes_no_orders(client, make_user, auth_header):
    admin = await make_user("off@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    t = (await client.post("/api/ordering/tables", json={"label": "T3"}, headers=h)).json()
    assert (await client.get("/api/public/table/nosuch")).status_code == 404

    await client.patch(
        f"/api/ordering/tables/{t['id']}",
        json={"label": "T3", "seats": 4, "is_active": False},
        headers=h,
    )
    assert (await client.get(f"/api/public/table/{t['code']}")).status_code == 404


@pytest.mark.asyncio
async def test_freeing_a_table_clears_it_for_the_next_party(client, make_user, auth_header):
    """"how we will release the table... so that new customer can come and
    occupy and cycle goes on."

    A party that has eaten and left is not a ticket the kitchen still owes."""
    admin = await make_user("release@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    t = (await client.post("/api/ordering/tables", json={"label": "R1"}, headers=h)).json()
    dish = (
        await client.post("/api/ordering/menu", json={"name": "Vada", "price": "2.00"}, headers=h)
    ).json()
    await client.post(
        f"/api/public/table/{t['code']}",
        json={"items": [{"menu_item_id": dish["id"], "quantity": 2}]},
    )
    live = (await client.get(f"/api/public/table/{t['code']}/orders")).json()
    assert live["orders"], "nothing to release"

    r = await client.post(f"/api/ordering/tables/{t['id']}/release", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["cleared"] >= 1

    after = (await client.get(f"/api/public/table/{t['code']}/orders")).json()
    assert after["orders"] == [], "the table still shows the old party's food"


@pytest.mark.asyncio
async def test_the_kitchen_screen_needs_no_login(client, make_user, auth_header):
    """"so that the kitchen staff no need to have my super admin creds in tab."

    Its own address, and it can read tickets and move them - nothing else."""
    admin = await make_user("kds@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    link = await client.get("/api/ordering/kitchen-screen", headers=h)
    assert link.status_code == 200, link.text
    code = link.json()["code"]
    assert len(code) > 12, "a kitchen-tablet URL should not be guessable"
    assert f"/kds/{code}" in link.json()["url"]

    t = (await client.post("/api/ordering/tables", json={"label": "K1"}, headers=h)).json()
    dish = (
        await client.post("/api/ordering/menu", json={"name": "Bonda", "price": "1.50"}, headers=h)
    ).json()
    placed = await client.post(
        f"/api/public/table/{t['code']}",
        json={"items": [{"menu_item_id": dish["id"], "quantity": 1}]},
    )
    order_id = placed.json()["id"]

    # No auth header anywhere below.
    board = await client.get(f"/api/public/kds/{code}")
    assert board.status_code == 200, board.text
    assert any(o["id"] == order_id for o in board.json()["orders"])

    moved = await client.patch(
        f"/api/public/kds/{code}/orders/{order_id}", json={"status": "CONFIRMED"}
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["status"] == "CONFIRMED"


@pytest.mark.asyncio
async def test_a_wrong_kitchen_screen_code_sees_nothing(client):
    assert (await client.get("/api/public/kds/not-a-real-code")).status_code == 404


@pytest.mark.asyncio
async def test_rotating_the_kitchen_screen_kills_the_old_link(client, make_user, auth_header):
    """For when a tablet walks off."""
    admin = await make_user("rotate@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    old = (await client.get("/api/ordering/kitchen-screen", headers=h)).json()["code"]
    new = (await client.post("/api/ordering/kitchen-screen/rotate", headers=h)).json()["code"]
    assert new != old
    assert (await client.get(f"/api/public/kds/{old}")).status_code == 404
    assert (await client.get(f"/api/public/kds/{new}")).status_code == 200


@pytest.mark.asyncio
async def test_seats_are_the_hotels_to_decide(client, make_user, auth_header):
    """"how you know each table will have 4 seats... it depends."""
    admin = await make_user("seats@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    made = await client.post(
        "/api/ordering/tables/bulk", json={"count": 2, "prefix": "Booth", "seats": 8}, headers=h
    )
    assert made.status_code == 201, made.text
    assert all(t["seats"] == 8 for t in made.json())


@pytest.mark.asyncio
async def test_the_table_card_renders_a_real_svg(client, make_user, auth_header):
    """A printed card is the whole point, and an SVG with no namespace renders
    as alt text through <img>."""
    admin = await make_user("qr@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    t = (await client.post("/api/ordering/tables", json={"label": "Q1"}, headers=h)).json()
    r = await client.get(f"/api/public/table/{t['code']}/qr.svg")
    assert r.status_code == 200, r.text
    body = r.text
    assert "xmlns" in body[:200], "an <img> will refuse an SVG with no namespace"
    assert r.headers["content-type"].startswith("image/svg+xml")


# ── Menu availability: four facts, not one boolean ───────────────────────────


def test_finished_today_clears_itself_overnight():
    """"we ran out of biryani" must not still be true on Tuesday.

    Nobody comes in at 6am to un-tick yesterday's sold-out flag, and if the
    software needs them to, the feature rots into "everything is off the menu".
    """
    from datetime import date, timedelta

    from app.ordering import availability as av

    today = date(2026, 8, 19)
    assert av.effective_state(av.FINISHED_TODAY, today, today) == av.FINISHED_TODAY
    assert av.effective_state(av.FINISHED_TODAY, today - timedelta(days=1), today) == av.AVAILABLE


def test_serving_hours_can_cross_midnight():
    """A late menu running 22:00-02:00 is exactly the case a naive
    from <= now <= to gets silently wrong."""
    from datetime import time

    from app.ordering import availability as av

    late_from, late_to = time(22, 0), time(2, 0)
    assert av.within_hours(time(23, 30), late_from, late_to)
    assert av.within_hours(time(1, 0), late_from, late_to)
    assert not av.within_hours(time(15, 0), late_from, late_to)
    # ...and the ordinary way round still works.
    assert av.within_hours(time(9, 0), time(7, 0), time(11, 0))
    assert not av.within_hours(time(15, 0), time(7, 0), time(11, 0))


def test_a_dish_that_is_off_says_why_and_when_it_is_back():
    """Hiding is the lazy option and it costs a sale: a dish that silently
    vanishes reads as "they don't do that"."""
    from datetime import date, time
    from types import SimpleNamespace

    from app.ordering import availability as av

    today = date(2026, 8, 19)
    dosa = SimpleNamespace(
        availability=av.AVAILABLE, sold_out_on=None, serve_from=time(7, 0), serve_to=time(11, 0)
    )
    assert av.why_not(dosa, today, time(9, 0)) is None
    assert "07:00" in (av.why_not(dosa, today, time(16, 0)) or "")

    gone = SimpleNamespace(
        availability=av.FINISHED_TODAY, sold_out_on=today, serve_from=None, serve_to=None
    )
    assert "tomorrow" in (av.why_not(gone, today, time(16, 0)) or "")


@pytest.mark.asyncio
async def test_a_stale_page_cannot_order_what_is_off(client, make_user, auth_header):
    """A menu left open on a table since breakfast must not be able to order the
    dosa at four o'clock."""
    admin = await make_user("avail@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    t = (await client.post("/api/ordering/tables", json={"label": "A1"}, headers=h)).json()
    dish = (
        await client.post("/api/ordering/menu", json={"name": "Dosa", "price": "5.00"}, headers=h)
    ).json()

    off = await client.patch(
        f"/api/ordering/menu/{dish['id']}", json={"availability": "out_of_stock"}, headers=h
    )
    assert off.status_code == 200, off.text
    assert off.json()["availability"] == "out_of_stock"

    placed = await client.post(
        f"/api/public/table/{t['code']}",
        json={"items": [{"menu_item_id": dish["id"], "quantity": 1}]},
    )
    assert placed.status_code == 422, "an out-of-stock dish was still orderable"

    # ...and the diner is TOLD, rather than the dish vanishing.
    menu = (await client.get(f"/api/public/table/{t['code']}")).json()["menu"]
    mine = [m for m in menu if m["id"] == dish["id"]]
    assert mine, "the dish vanished instead of explaining itself"
    assert mine[0]["orderable"] is False
    assert "stock" in (mine[0]["unavailable_reason"] or "").lower()


@pytest.mark.asyncio
async def test_a_table_can_send_a_message(client, make_user, auth_header):
    """"customer sitting in table can also msg using that QR."

    It has to reach the same screen as everything else — a message that lands
    where nobody looks is worse than none, because the diner believes they have
    been heard."""
    admin = await make_user("msg@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    t = (await client.post("/api/ordering/tables", json={"label": "M1"}, headers=h)).json()

    r = await client.post(
        f"/api/public/table/{t['code']}/message", json={"text": "More water please"}
    )
    assert r.status_code == 202, r.text

    board = (await client.get("/api/ordering/orders", headers=h)).json()["orders"]
    mine = [o for o in board if o.get("table_label") == "M1"]
    assert mine, "the message never reached the kitchen"
    assert mine[0]["guest_message"] == "More water please"
    assert mine[0]["help_requested_at"], "nobody was flagged as waiting"


@pytest.mark.asyncio
async def test_the_kitchen_can_set_a_ticket_s_own_eta(client, make_user, auth_header):
    """"chef and super admin can change the estimated time for each table order."

    A biryani is forty minutes and a lassi is two; an average serves neither."""
    admin = await make_user("eta@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    t = (await client.post("/api/ordering/tables", json={"label": "E1"}, headers=h)).json()
    dish = (
        await client.post("/api/ordering/menu", json={"name": "Biryani", "price": "9.00"}, headers=h)
    ).json()
    placed = await client.post(
        f"/api/public/table/{t['code']}",
        json={"items": [{"menu_item_id": dish["id"], "quantity": 1}]},
    )
    oid = placed.json()["id"]

    r = await client.patch(f"/api/ordering/orders/{oid}/eta", json={"minutes": 40}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["eta_minutes"] == 40

    # ...and blank puts it back on the hotel default.
    r = await client.patch(f"/api/ordering/orders/{oid}/eta", json={"minutes": None}, headers=h)
    assert r.json()["eta_minutes"] is None


@pytest.mark.asyncio
async def test_the_guest_assistant_is_never_handed_the_money(
    client, make_user, auth_header, monkeypatch
):
    """THE GUARANTEE, tested at the only place it can be tested.

    "make our ai not to answer profit or revenue kinda question abt hotels."

    A prompt instruction is not a control — it is a request that a determined
    guest can talk their way around. The control is that the model is never
    given the numbers. So this captures exactly what we send and asserts the
    business's money is not in it.
    """
    captured: dict = {}

    def fake_ask(question, **kw):
        captured["question"] = question
        captured["context"] = kw.get("context", "")
        captured["system_extra"] = kw.get("system_extra", "")
        return "We are known for our dosa."

    from app.assistant import bedrock

    monkeypatch.setattr(bedrock, "ask", fake_ask)

    admin = await make_user("ask@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    t = (await client.post("/api/ordering/tables", json={"label": "AI1"}, headers=h)).json()
    await client.post(
        "/api/ordering/menu", json={"name": "Masala Dosa", "price": "7.50"}, headers=h
    )

    r = await client.post(
        f"/api/public/table/{t['code']}/ask",
        json={"question": "What is your profit on the dosa?"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is True

    ctx = captured["context"].lower()
    # The menu IS there — that is what it is for.
    assert "masala dosa" in ctx
    # ...and nothing commercial is, whatever the guest asks.
    for forbidden in ("profit", "margin", "revenue", "payroll", "wage", "supplier", "cost_price"):
        assert forbidden not in ctx, f"the assistant was handed {forbidden}"


@pytest.mark.asyncio
async def test_the_cards_come_off_the_screen(client, make_user, auth_header):
    """"each qr we need download option — download as image or PDF — and one
    consolidated download button."""
    admin = await make_user("pdf@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    t = (await client.post("/api/ordering/tables", json={"label": "P1"}, headers=h)).json()

    png = await client.get(f"/api/public/table/{t['code']}/qr.png")
    assert png.status_code == 200
    assert png.content[:4] == b"\x89PNG"

    one = await client.get(f"/api/ordering/tables/{t['id']}/card.pdf", headers=h)
    assert one.status_code == 200
    assert one.content[:4] == b"%PDF"

    every = await client.get("/api/ordering/table-cards.pdf", headers=h)
    assert every.status_code == 200
    assert every.content[:4] == b"%PDF"


def test_a_real_hotels_spreadsheet_is_read_forgivingly():
    """"he can upload the menu so that our AI can see the menu photo or excel."

    A spreadsheet is already structured, so we read it ourselves rather than pay
    a model to guess at a column of numbers. Real ones say "Dish" and "Rate",
    carry currency symbols, and have blank rows in the middle.
    """
    from app.ordering.router import _rows_from_sheet

    csv = (
        "Dish,Rate,Section\n"
        "Masala Dosa,7.50,Breakfast\n"
        "Chicken 65,\u00a38.95,Starters\n"
        ",,\n"
        "Free Water,0,Drinks\n"
    ).encode()
    out = _rows_from_sheet(csv, "menu.csv")
    names = [r["name"] for r in out]
    assert names == ["Masala Dosa", "Chicken 65"], names
    # The currency symbol is stripped rather than swallowing the number.
    assert out[1]["price"] == "8.95"
    assert out[0]["category"] == "Breakfast"
    # A dish priced zero is skipped: a £0 menu item is worse than a missing one.
    assert "Free Water" not in names


def test_a_sheet_with_no_headers_still_reads():
    """Plenty of kitchens keep a list with no header row at all."""
    from app.ordering.router import _rows_from_sheet

    out = _rows_from_sheet(b"Idli,3.00\nVada,2.50\n", "list.csv")
    assert [r["name"] for r in out] == ["Idli", "Vada"]
    assert out[0]["category"] == "Mains"


@pytest.mark.asyncio
async def test_reading_a_menu_writes_nothing(client, make_user, auth_header):
    """A model that can silently add twenty dishes priced off a blurry photo is
    a mess somebody unpicks dish by dish. It proposes; a person confirms."""
    admin = await make_user("read@test.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    before = (await client.get("/api/ordering/menu", headers=h)).json()

    r = await client.post(
        "/api/ordering/menu/read",
        files={"file": ("menu.csv", b"Dish,Rate\nPongal,4.50\n", "text/csv")},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["found"] == 1
    assert body["items"][0]["name"] == "Pongal"
    assert body["items"][0]["already_on_menu"] is False

    after = (await client.get("/api/ordering/menu", headers=h)).json()
    assert len(after) == len(before), "reading a menu wrote to the menu"
