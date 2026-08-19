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
