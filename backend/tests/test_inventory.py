"""Inventory tests — weighted-average costing, stock control, RBAC."""
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.inventory import service
from app.inventory.service import signed_delta, weighted_average_cost


# ── Pure-function: weighted average cost (the money math) ──────────────────
def test_weighted_average_first_purchase():
    # No existing stock: avg = the purchase price.
    assert weighted_average_cost(Decimal("0"), Decimal("0"), Decimal("10"), Decimal("5.00")) == (
        Decimal("5.0000")
    )


def test_weighted_average_blends_prices():
    # 10kg @ £5 then 10kg @ £6  ->  (50 + 60) / 20 = £5.50
    avg = weighted_average_cost(Decimal("10"), Decimal("5.0000"), Decimal("10"), Decimal("6.00"))
    assert avg == Decimal("5.5000")


def test_weighted_average_rounds_to_4dp():
    # 1 @ 1 then 2 @ 2  -> (1 + 4)/3 = 1.6666...
    avg = weighted_average_cost(Decimal("1"), Decimal("1"), Decimal("2"), Decimal("2"))
    assert avg == Decimal("1.6667")


def test_signed_delta_directions():
    assert signed_delta("PURCHASE_IN", Decimal("5")) == Decimal("5")
    assert signed_delta("RETURN", Decimal("5")) == Decimal("5")
    assert signed_delta("CONSUMPTION", Decimal("5")) == Decimal("-5")
    assert signed_delta("WASTE", Decimal("5")) == Decimal("-5")
    assert signed_delta("ADJUSTMENT", Decimal("-3")) == Decimal("-3")  # signed passthrough


# ── Service-level (Decimal-exact, against Postgres) ────────────────────────
@pytest.mark.asyncio
async def test_purchase_updates_stock_and_avg_cost(db, hotel):
    item = await service.create_item(db, hotel.id, name="Basmati Rice", unit="kg")
    await service.record_movement(db, item, "PURCHASE_IN", Decimal("10"), unit_cost=Decimal("5.00"))
    assert item.current_stock == Decimal("10")
    assert item.average_cost == Decimal("5.0000")

    await service.record_movement(db, item, "PURCHASE_IN", Decimal("10"), unit_cost=Decimal("6.00"))
    assert item.current_stock == Decimal("20")
    assert item.average_cost == Decimal("5.5000")

    # Persisted correctly (re-fetch from DB)
    refetched = await service.get_item(db, item.id, hotel.id)
    assert refetched.current_stock == Decimal("20")
    assert refetched.average_cost == Decimal("5.5000")


@pytest.mark.asyncio
async def test_consumption_reduces_stock(db, hotel):
    item = await service.create_item(db, hotel.id, name="Onion", unit="kg")
    await service.record_movement(db, item, "PURCHASE_IN", Decimal("20"), unit_cost=Decimal("1.00"))
    await service.record_movement(db, item, "CONSUMPTION", Decimal("8"))
    assert item.current_stock == Decimal("12")
    # Consumption does NOT change average cost
    assert item.average_cost == Decimal("1.0000")


@pytest.mark.asyncio
async def test_stock_cannot_go_negative(db, hotel):
    item = await service.create_item(db, hotel.id, name="Saffron", unit="g")
    with pytest.raises(service.InsufficientStockError):
        await service.record_movement(db, item, "CONSUMPTION", Decimal("5"))


@pytest.mark.asyncio
async def test_low_stock_detection(db, hotel):
    low = await service.create_item(
        db, hotel.id, name="Salt", unit="kg", min_stock_level=Decimal("10")
    )
    ok = await service.create_item(
        db, hotel.id, name="Flour", unit="kg", min_stock_level=Decimal("1")
    )
    await service.record_movement(db, ok, "PURCHASE_IN", Decimal("50"), unit_cost=Decimal("0.80"))

    lows = await service.low_stock_items(db, hotel.id)
    ids = {i.id for i in lows}
    assert low.id in ids  # 0 <= 10
    assert ok.id not in ids  # 50 > 1


@pytest.mark.asyncio
async def test_duplicate_item_name_rejected(db, hotel):
    """No two active items share a name (case-insensitive) in the same hotel."""
    await service.create_item(db, hotel.id, name="Basmati Rice", unit="kg")
    with pytest.raises(service.DuplicateItemError):
        await service.create_item(db, hotel.id, name="  basmati rice ", unit="kg")


@pytest.mark.asyncio
async def test_item_names_stored_normalized(db, hotel):
    """Stray/double spaces can't create sneaky duplicates — names are stored
    trimmed + space-collapsed, and the dup check matches the normalized form."""
    first = await service.create_item(db, hotel.id, name="  Aluminium   Containers ", unit="pack")
    assert first.name == "Aluminium Containers"
    with pytest.raises(service.DuplicateItemError):
        await service.create_item(db, hotel.id, name="Aluminium Containers  ", unit="pack")


# ── API + RBAC ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_full_purchase_flow_via_api(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)

    created = await client.post(
        "/api/inventory/items", headers=h, json={"name": "Chicken", "unit": "kg"}
    )
    assert created.status_code == 201
    item_id = created.json()["id"]

    purchase = await client.post(
        f"/api/inventory/items/{item_id}/movements",
        headers=h,
        json={"movement_type": "PURCHASE_IN", "quantity": "10", "unit_cost": "8.00"},
    )
    assert purchase.status_code == 201

    got = await client.get(f"/api/inventory/items/{item_id}", headers=h)
    assert float(got.json()["current_stock"]) == 10.0
    assert float(got.json()["average_cost"]) == 8.0

    over = await client.post(
        f"/api/inventory/items/{item_id}/movements",
        headers=h,
        json={"movement_type": "CONSUMPTION", "quantity": "12"},
    )
    assert over.status_code == 400  # insufficient stock


@pytest.mark.asyncio
async def test_purchase_in_requires_unit_cost(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    created = await client.post(
        "/api/inventory/items", headers=h, json={"name": "Ghee", "unit": "kg"}
    )
    item_id = created.json()["id"]
    resp = await client.post(
        f"/api/inventory/items/{item_id}/movements",
        headers=h,
        json={"movement_type": "PURCHASE_IN", "quantity": "5"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_kitchen_manager_reads_but_cannot_write(client, make_user, auth_header):
    km = await make_user("km@nirai.com", Role.KITCHEN_MANAGER.value)
    h = auth_header(km)
    assert (await client.get("/api/inventory/items", headers=h)).status_code == 200
    create = await client.post(
        "/api/inventory/items", headers=h, json={"name": "X", "unit": "kg"}
    )
    assert create.status_code == 403


@pytest.mark.asyncio
async def test_cashier_cannot_access_inventory(client, make_user, auth_header):
    cashier = await make_user("cash@nirai.com", Role.CASHIER.value)
    resp = await client.get("/api/inventory/items", headers=auth_header(cashier))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_low_stock_endpoint(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    await client.post(
        "/api/inventory/items",
        headers=h,
        json={"name": "Cardamom", "unit": "kg", "min_stock_level": "5"},
    )
    resp = await client.get("/api/inventory/alerts/low-stock", headers=h)
    assert resp.status_code == 200
    names = [a["name"] for a in resp.json()]
    assert "Cardamom" in names


_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@pytest.mark.asyncio
async def test_exports_render(client, make_user, auth_header):
    """Stock-valuation + waste exports return real files (catches openpyxl 500s)."""
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    item_id = (
        await client.post(
            "/api/inventory/items", headers=h, json={"name": "Rice", "unit": "kg"}
        )
    ).json()["id"]
    await client.post(
        f"/api/inventory/items/{item_id}/movements",
        headers=h,
        json={"movement_type": "PURCHASE_IN", "quantity": "10", "unit_cost": "2.00"},
    )
    await client.post(
        "/api/inventory/waste", headers=h, json={"item_id": item_id, "quantity": "2", "reason": "spoiled"}
    )

    xlsx = await client.get("/api/inventory/items.xlsx", headers=h)
    assert xlsx.status_code == 200
    assert xlsx.headers["content-type"].startswith(_XLSX)
    assert len(xlsx.content) > 0

    for path in ("/api/inventory/items.csv", "/api/inventory/waste.csv"):
        resp = await client.get(path, headers=h)
        assert resp.status_code == 200
        assert "text/csv" in resp.headers["content-type"]

    wx = await client.get("/api/inventory/waste.xlsx", headers=h)
    assert wx.status_code == 200
    assert wx.headers["content-type"].startswith(_XLSX)


@pytest.mark.asyncio
async def test_rename_category_merges(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    await client.post("/api/inventory/items", headers=h, json={"name": "Tomato", "unit": "kg", "category": "Veg"})
    await client.post("/api/inventory/items", headers=h, json={"name": "Onion", "unit": "kg", "category": "Veggies"})

    # rename "Veg" into the existing "Veggies" → they merge
    resp = await client.post(
        "/api/inventory/categories/rename", headers=h, json={"from_name": "Veg", "to_name": "Veggies"}
    )
    assert resp.status_code == 200
    assert resp.json()["updated"] == 1
    cats = {i["name"]: i["category"] for i in (await client.get("/api/inventory/items", headers=h)).json()}
    assert cats["Tomato"] == "Veggies"
    assert cats["Onion"] == "Veggies"


# ── Purchases by supplier (a factual record, not a split of mixed stock) ──────
async def test_purchases_by_vendor_record(db, hotel):
    from app.vendors.models import Vendor

    rudra = Vendor(hotel_id=hotel.id, name="Rudra Foods")
    farm = Vendor(hotel_id=hotel.id, name="Farm2Land")
    db.add_all([rudra, farm])
    await db.flush()

    item = await service.create_item(db, hotel.id, name="Basmati Rice", unit="kg")
    # oldest → newest
    await service.record_movement(
        db, item, "PURCHASE_IN", Decimal("3"), unit_cost=Decimal("4.20"), vendor_id=rudra.id
    )
    await service.record_movement(
        db, item, "PURCHASE_IN", Decimal("2"), unit_cost=Decimal("4.55"), vendor_id=farm.id
    )

    # Two distinct vendors → breakdown should be offered.
    counts = await service.purchase_vendor_counts(db, hotel.id)
    assert counts[item.id] == 2

    # The record shows what was BOUGHT (received qty), newest first.
    rows = await service.purchases_by_vendor(db, item)
    assert [(r["vendor"], r["quantity"]) for r in rows] == [
        ("Farm2Land", Decimal("2.000")),
        ("Rudra Foods", Decimal("3.000")),
    ]

    # Consuming stock does NOT change the purchase record (it's history, not a split).
    await service.record_movement(db, item, "CONSUMPTION", Decimal("4"))
    rows2 = await service.purchases_by_vendor(db, item)
    assert [(r["vendor"], r["quantity"]) for r in rows2] == [
        ("Farm2Land", Decimal("2.000")),
        ("Rudra Foods", Decimal("3.000")),
    ]


@pytest.mark.asyncio
async def test_purchase_chain_receipt(db, make_user):
    """A purchase carries its delivery reference, and the receipt returns every item
    received together on that reference (the 'chain')."""
    import uuid

    user = await make_user("chain@x.com", Role.SUPER_ADMIN.value)
    h = user.hotel_id
    rice = await service.create_item(db, h, name="Rice", unit="kg")
    oil = await service.create_item(db, h, name="Oil", unit="l")
    ref = uuid.uuid4()
    for it, qty, price in ((rice, "10", "2"), (oil, "5", "3")):
        await service.record_movement(
            db, it, "PURCHASE_IN", Decimal(qty), unit_cost=Decimal(price),
            reference_id=ref, reference_type="PURCHASE_ORDER",
        )
    # each purchase row carries its delivery reference
    pv = await service.purchases_by_vendor(db, rice)
    assert pv and pv[0]["reference_id"] == ref
    # the chain = both items received on that delivery
    lines = await service.receipt_lines(db, h, ref)
    assert {row["item_name"] for row in lines} == {"Rice", "Oil"}
    assert next(row for row in lines if row["item_name"] == "Rice")["line_total"] == Decimal("20.00")


# ── Starter catalogue + remove (delete-or-archive) ───────────────────────────
@pytest.mark.asyncio
async def test_seed_starter_items_idempotent(db, hotel):
    first = await service.seed_starter_items(db, hotel.id)
    assert "Onion" in first["added"] and len(first["added"]) > 50 and first["skipped"] == []
    # re-running adds nothing new (no duplicates) and skips everything
    second = await service.seed_starter_items(db, hotel.id)
    assert second["added"] == [] and len(second["skipped"]) == len(first["added"])


@pytest.mark.asyncio
async def test_seed_starter_endpoint(client, make_user, auth_header):
    h = auth_header(await make_user("seed@nirai.com", Role.SUPER_ADMIN.value))
    res = await client.post("/api/inventory/seed-starter", headers=h)
    assert res.status_code == 200 and res.json()["added"] > 0
    names = [i["name"] for i in (await client.get("/api/inventory/items", headers=h)).json()]
    assert "Turmeric Powder" in names


@pytest.mark.asyncio
async def test_remove_unused_item_hard_deletes(client, make_user, auth_header):
    h = auth_header(await make_user("del@nirai.com", Role.SUPER_ADMIN.value))
    iid = (
        await client.post("/api/inventory/items", headers=h, json={"name": "Spare", "unit": "kg"})
    ).json()["id"]
    usage = await client.get(f"/api/inventory/items/{iid}/usage", headers=h)
    assert usage.json()["can_hard_delete"] is True
    res = await client.delete(f"/api/inventory/items/{iid}", headers=h)
    assert res.status_code == 200 and res.json()["action"] == "deleted"
    names = [i["name"] for i in (await client.get("/api/inventory/items", headers=h)).json()]
    assert "Spare" not in names


@pytest.mark.asyncio
async def test_remove_used_item_archives(client, make_user, auth_header):
    """An item with stock history is archived (kept), not deleted."""
    h = auth_header(await make_user("arc@nirai.com", Role.SUPER_ADMIN.value))
    iid = (
        await client.post("/api/inventory/items", headers=h, json={"name": "Used Rice", "unit": "kg"})
    ).json()["id"]
    await client.post(
        f"/api/inventory/items/{iid}/movements", headers=h,
        json={"movement_type": "PURCHASE_IN", "quantity": "5", "unit_cost": "2.00"},
    )
    res = await client.delete(f"/api/inventory/items/{iid}", headers=h)
    assert res.status_code == 200 and res.json()["action"] == "archived"
    names = [i["name"] for i in (await client.get("/api/inventory/items", headers=h)).json()]
    assert "Used Rice" not in names  # archived → hidden from the active list


@pytest.mark.asyncio
async def test_waste_total_sums_value(db, hotel):
    """waste_total = qty wasted × cost-at-the-time (an insight figure for the P&L)."""
    item = await service.create_item(db, hotel.id, name="Milk", unit="l")
    await service.record_movement(db, item, "PURCHASE_IN", Decimal("10"), unit_cost=Decimal("2.00"))
    assert await service.waste_total(db, hotel.id) == Decimal("0.00")
    await service.record_waste(db, item, Decimal("3"), "spoiled")  # 3 × £2.00
    assert await service.waste_total(db, hotel.id) == Decimal("6.00")


@pytest.mark.asyncio
async def test_remove_item_is_super_admin_only(client, make_user, auth_header):
    """A Manager can add items (inventory:write) but cannot remove them (super-admin)."""
    h = auth_header(await make_user("mgr@nirai.com", Role.MANAGER.value))
    iid = (
        await client.post("/api/inventory/items", headers=h, json={"name": "NoDelete", "unit": "kg"})
    ).json()["id"]
    res = await client.delete(f"/api/inventory/items/{iid}", headers=h)
    assert res.status_code == 403
