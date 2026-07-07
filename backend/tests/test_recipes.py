"""Recipe costing tests — the profit engine."""
import uuid
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.inventory import service as inv
from app.recipes import service as rec
from app.recipes.router import _parse_note_line
from app.vendors import service as ven


def test_parse_note_line_extracts_name_qty_unit():
    assert _parse_note_line("1. CHICKEN (Breast) 200 gms") == ("CHICKEN (Breast)", "200", "g")
    assert _parse_note_line("3) onion 100gms") == ("onion", "100", "g")
    assert _parse_note_line("Oil 100 ml") == ("Oil", "100", "ml")
    assert _parse_note_line("Curry leaves few sprig") == ("Curry leaves few sprig", None, None)
    assert _parse_note_line("Tomato 2 kg") == ("Tomato", "2", "kg")


async def _setup_biryani(db, hotel, chicken_price=Decimal("8.00")):
    rice = await inv.create_item(db, hotel.id, name="Basmati Rice", unit="kg")
    chicken = await inv.create_item(db, hotel.id, name="Chicken", unit="kg")
    vendor = await ven.create_vendor(db, hotel.id, name="SK")
    await ven.upsert_vendor_item(db, vendor.id, rice.id, Decimal("5.00"))
    await ven.upsert_vendor_item(db, vendor.id, chicken.id, chicken_price)
    recipe = await rec.create_recipe(
        db, hotel.id, name="Chicken Biryani", servings_default=50, selling_price=Decimal("15.00")
    )
    await rec.upsert_ingredient(db, recipe.id, rice.id, Decimal("5"), "kg")
    await rec.upsert_ingredient(db, recipe.id, chicken.id, Decimal("4"), "kg")
    return recipe, rice, chicken, vendor


@pytest.mark.asyncio
async def test_duplicate_recipe_name_and_serves(db, hotel):
    await rec.create_recipe(db, hotel.id, name="Biryani", servings_default=40)
    # same name + same serves -> rejected
    with pytest.raises(rec.DuplicateRecipeError):
        await rec.create_recipe(db, hotel.id, name=" biryani ", servings_default=40)
    # same name + different serves -> allowed
    other = await rec.create_recipe(db, hotel.id, name="Biryani", servings_default=60)
    assert other.servings_default == 60


@pytest.mark.asyncio
async def test_delete_ingredient(db, hotel):
    recipe, rice, chicken, _ = await _setup_biryani(db, hotel)
    assert len(await rec.list_ingredients(db, recipe.id)) == 2
    assert await rec.delete_ingredient(db, recipe.id, chicken.id) is True
    remaining = await rec.list_ingredients(db, recipe.id)
    assert len(remaining) == 1
    assert remaining[0].item_id == rice.id
    # deleting again is a no-op
    assert await rec.delete_ingredient(db, recipe.id, chicken.id) is False


@pytest.mark.asyncio
async def test_biryani_cost_and_margin(db, hotel):
    recipe, *_ = await _setup_biryani(db, hotel)
    result = await rec.calculate_recipe_cost(db, recipe.id, hotel.id)
    assert result["total_cost"] == Decimal("57.0000")  # 5*5 + 4*8
    assert result["cost_per_serving"] == Decimal("1.1400")  # 57/50
    assert result["profit_margin_pct"] == Decimal("92.40")  # (15-1.14)/15*100
    assert result["has_missing_prices"] is False


@pytest.mark.asyncio
async def test_margin_drops_when_vendor_price_rises(db, hotel):
    recipe, _rice, chicken, vendor = await _setup_biryani(db, hotel)
    initial = await rec.calculate_recipe_cost(db, recipe.id, hotel.id)

    # Chicken price jumps 8 -> 12
    await ven.upsert_vendor_item(db, vendor.id, chicken.id, Decimal("12.00"))
    updated = await rec.calculate_recipe_cost(db, recipe.id, hotel.id)

    assert updated["cost_per_serving"] > initial["cost_per_serving"]
    assert updated["profit_margin_pct"] < initial["profit_margin_pct"]


@pytest.mark.asyncio
async def test_cost_uses_cheapest_vendor(db, hotel):
    item = await inv.create_item(db, hotel.id, name="Oil", unit="litre")
    a = await ven.create_vendor(db, hotel.id, name="A")
    b = await ven.create_vendor(db, hotel.id, name="B")
    await ven.upsert_vendor_item(db, a.id, item.id, Decimal("3.00"))
    await ven.upsert_vendor_item(db, b.id, item.id, Decimal("2.50"))
    recipe = await rec.create_recipe(db, hotel.id, name="Fry", servings_default=1)
    await rec.upsert_ingredient(db, recipe.id, item.id, Decimal("2"), "litre")

    result = await rec.calculate_recipe_cost(db, recipe.id, hotel.id)
    ing = result["ingredients"][0]
    assert ing["unit_price"] == Decimal("2.50")
    assert ing["vendor_name"] == "B"
    assert result["total_cost"] == Decimal("5.0000")


@pytest.mark.asyncio
async def test_cost_uses_preferred_vendor_over_cheapest(db, hotel):
    item = await inv.create_item(db, hotel.id, name="Oil", unit="litre")
    cheap = await ven.create_vendor(db, hotel.id, name="Cheap Co")
    quality = await ven.create_vendor(db, hotel.id, name="Quality Co")
    await ven.upsert_vendor_item(db, cheap.id, item.id, Decimal("2.00"))
    await ven.upsert_vendor_item(db, quality.id, item.id, Decimal("3.00"))
    # Manager prefers the (pricier) quality vendor
    await ven.set_preferred_vendor(db, hotel.id, item.id, quality.id)

    recipe = await rec.create_recipe(db, hotel.id, name="Fry", servings_default=1)
    await rec.upsert_ingredient(db, recipe.id, item.id, Decimal("1"), "litre")
    result = await rec.calculate_recipe_cost(db, recipe.id, hotel.id)
    ing = result["ingredients"][0]
    assert ing["vendor_name"] == "Quality Co"
    assert ing["unit_price"] == Decimal("3.00")
    assert ing["price_source"] == "preferred"


@pytest.mark.asyncio
async def test_missing_vendor_price_falls_back_to_average_cost(db, hotel):
    item = await inv.create_item(db, hotel.id, name="Salt", unit="kg")
    # Establish weighted-average cost via a purchase (no vendor price set)
    await inv.record_movement(db, item, "PURCHASE_IN", Decimal("10"), unit_cost=Decimal("2.00"))
    recipe = await rec.create_recipe(db, hotel.id, name="Brine", servings_default=1)
    await rec.upsert_ingredient(db, recipe.id, item.id, Decimal("3"), "kg")

    result = await rec.calculate_recipe_cost(db, recipe.id, hotel.id)
    assert result["ingredients"][0]["price_source"] == "average_cost"
    assert result["total_cost"] == Decimal("6.0000")  # 3 * 2.00
    assert result["has_missing_prices"] is False


@pytest.mark.asyncio
async def test_unpriced_ingredient_flags_missing(db, hotel):
    item = await inv.create_item(db, hotel.id, name="Mystery Spice", unit="kg")
    recipe = await rec.create_recipe(db, hotel.id, name="Mystery Dish", servings_default=1)
    await rec.upsert_ingredient(db, recipe.id, item.id, Decimal("2"), "kg")

    result = await rec.calculate_recipe_cost(db, recipe.id, hotel.id)
    assert result["has_missing_prices"] is True
    assert result["ingredients"][0]["price_source"] == "none"
    assert result["total_cost"] == Decimal("0.0000")


@pytest.mark.asyncio
async def test_calculate_missing_recipe_returns_none(db, hotel):
    assert await rec.calculate_recipe_cost(db, uuid.uuid4(), hotel.id) is None


# ── API + RBAC ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_recipe_cost_via_api(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    rice = (
        await client.post("/api/inventory/items", headers=h, json={"name": "Rice", "unit": "kg"})
    ).json()
    vendor = (await client.post("/api/vendors", headers=h, json={"name": "SK"})).json()
    await client.post(
        f"/api/vendors/{vendor['id']}/items",
        headers=h,
        json={"item_id": rice["id"], "price_per_unit": "5.00"},
    )
    recipe = (
        await client.post(
            "/api/recipes",
            headers=h,
            json={"name": "Plain Rice", "servings_default": 10, "selling_price": "3.00"},
        )
    ).json()
    await client.post(
        f"/api/recipes/{recipe['id']}/ingredients",
        headers=h,
        json={"item_id": rice["id"], "quantity": "5", "unit": "kg"},
    )

    resp = await client.get(f"/api/recipes/{recipe['id']}/cost", headers=h)
    assert resp.status_code == 200
    body = resp.json()
    assert float(body["total_cost"]) == 25.0  # 5kg * £5
    assert float(body["cost_per_serving"]) == 2.5  # 25 / 10
    assert float(body["profit_margin_pct"]) == 16.67  # (3-2.5)/3*100


@pytest.mark.asyncio
async def test_kitchen_manager_can_write_recipes(client, make_user, auth_header):
    km = await make_user("km@nirai.com", Role.KITCHEN_MANAGER.value)
    resp = await client.post(
        "/api/recipes", headers=auth_header(km), json={"name": "Masala Dosa", "servings_default": 1}
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_accountant_can_read_recipes(client, make_user, auth_header):
    acct = await make_user("acct@nirai.com", Role.ACCOUNTANT.value)
    resp = await client.get("/api/recipes", headers=auth_header(acct))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_cashier_cannot_read_recipes(client, make_user, auth_header):
    cashier = await make_user("cash@nirai.com", Role.CASHIER.value)
    resp = await client.get("/api/recipes", headers=auth_header(cashier))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_archive_and_reactivate_recipe(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    rid = (
        await client.post(
            "/api/recipes", headers=h, json={"name": "Idli", "servings_default": 1}
        )
    ).json()["id"]

    # archive -> hidden from the default list, but visible with include_inactive
    assert (
        await client.patch(f"/api/recipes/{rid}", headers=h, json={"is_active": False})
    ).status_code == 200
    active = (await client.get("/api/recipes", headers=h)).json()
    assert all(r["id"] != rid for r in active)
    archived = (await client.get("/api/recipes?include_inactive=true", headers=h)).json()
    assert any(r["id"] == rid and r["is_active"] is False for r in archived)

    # reactivate -> back in the default list
    assert (
        await client.patch(f"/api/recipes/{rid}", headers=h, json={"is_active": True})
    ).status_code == 200
    assert any(r["id"] == rid for r in (await client.get("/api/recipes", headers=h)).json())


@pytest.mark.asyncio
async def test_allergen_matrix(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    milk = (
        await client.post("/api/inventory/items", headers=h, json={"name": "Milk", "unit": "litre"})
    ).json()["id"]
    rice = (
        await client.post("/api/inventory/items", headers=h, json={"name": "Rice", "unit": "kg"})
    ).json()["id"]
    # Milk is reviewed (contains milk + gluten); Rice is left un-reviewed (allergens NULL)
    await client.patch(f"/api/inventory/items/{milk}", headers=h, json={"allergens": "milk,gluten"})

    rid = (
        await client.post("/api/recipes", headers=h, json={"name": "Kheer", "servings_default": 1})
    ).json()["id"]
    for item_id, unit in ((milk, "litre"), (rice, "kg")):
        await client.post(
            f"/api/recipes/{rid}/ingredients",
            headers=h,
            json={"item_id": item_id, "quantity": "1", "unit": unit},
        )

    matrix = (await client.get("/api/recipes/allergen-matrix", headers=h)).json()
    row = next(r for r in matrix if r["recipe_id"] == rid)
    assert sorted(row["allergens"]) == ["gluten", "milk"]
    assert "Rice" in row["unreviewed"]


@pytest.mark.asyncio
async def test_recipe_pdf_exports(client, make_user, auth_header):
    """Allergen sheet + party-order quote both render real PDF bytes."""
    admin = await make_user("recipe-pdf@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    await client.post("/api/recipes", headers=h, json={"name": "Biryani", "servings_default": 1})

    ap = await client.get("/api/recipes/allergen-matrix.pdf", headers=h)
    assert ap.status_code == 200
    assert ap.headers["content-type"] == "application/pdf"
    assert ap.content[:4] == b"%PDF"

    pq = await client.post(
        "/api/recipes/party-quote.pdf",
        headers=h,
        json={
            "customer": "Sharma wedding", "when": "2026-07-01", "currency": "GBP ",
            "lines": [
                {"name": "Biryani", "qty": 20, "unit_price": 12.0, "unit_cost": 5.0},
                {"name": "Naan", "qty": 10, "unit_price": None, "unit_cost": 0.5},
            ],
        },
    )
    assert pq.status_code == 200
    assert pq.headers["content-type"] == "application/pdf"
    assert pq.content[:4] == b"%PDF"
