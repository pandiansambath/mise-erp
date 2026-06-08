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
