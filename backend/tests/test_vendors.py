"""Vendor + price-comparison tests."""
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.inventory import service as inv_service
from app.vendors import service as vendor_service


@pytest.mark.asyncio
async def test_duplicate_vendor_name_rejected(db, hotel):
    await vendor_service.create_vendor(db, hotel.id, name="Farm2Land")
    with pytest.raises(vendor_service.DuplicateVendorError):
        await vendor_service.create_vendor(db, hotel.id, name=" farm2land ")


# ── Price comparison engine (the money feature) ────────────────────────────
@pytest.mark.asyncio
async def test_price_comparison_picks_cheapest_and_savings(db, hotel):
    chicken = await inv_service.create_item(db, hotel.id, name="Chicken Breast", unit="kg")
    al_halal = await vendor_service.create_vendor(db, hotel.id, name="Al-Halal")
    leicester = await vendor_service.create_vendor(db, hotel.id, name="Leicester Foods")
    local = await vendor_service.create_vendor(db, hotel.id, name="Local Market")

    await vendor_service.upsert_vendor_item(db, al_halal.id, chicken.id, Decimal("7.50"))
    await vendor_service.upsert_vendor_item(db, leicester.id, chicken.id, Decimal("8.20"))
    await vendor_service.upsert_vendor_item(db, local.id, chicken.id, Decimal("8.50"))

    result = await vendor_service.compare_vendor_prices(db, chicken.id, hotel.id)
    assert result["vendor_count"] == 3
    assert result["cheapest_vendor"]["vendor_name"] == "Al-Halal"
    assert result["comparisons"][0]["price_per_unit"] == Decimal("7.50")  # sorted asc
    assert result["most_expensive_vendor"]["vendor_name"] == "Local Market"
    assert result["potential_saving_per_unit"] == Decimal("1.00")  # 8.50 - 7.50


@pytest.mark.asyncio
async def test_price_comparison_no_vendors(db, hotel):
    item = await inv_service.create_item(db, hotel.id, name="Lonely Item", unit="kg")
    result = await vendor_service.compare_vendor_prices(db, item.id, hotel.id)
    assert result["vendor_count"] == 0
    assert result["cheapest_vendor"] is None
    assert result["potential_saving_per_unit"] == Decimal("0")


@pytest.mark.asyncio
async def test_price_comparison_missing_item_returns_none(db, hotel):
    import uuid

    result = await vendor_service.compare_vendor_prices(db, uuid.uuid4(), hotel.id)
    assert result is None


@pytest.mark.asyncio
async def test_upsert_vendor_item_is_idempotent(db, hotel):
    item = await inv_service.create_item(db, hotel.id, name="Tomato", unit="box")
    vendor = await vendor_service.create_vendor(db, hotel.id, name="Farm2Land")
    await vendor_service.upsert_vendor_item(db, vendor.id, item.id, Decimal("12.50"))
    # update the same vendor+item -> still one row, new price
    await vendor_service.upsert_vendor_item(db, vendor.id, item.id, Decimal("11.00"))
    rows = await vendor_service.list_vendor_items(db, vendor.id)
    assert len(rows) == 1
    assert rows[0].price_per_unit == Decimal("11.00")


@pytest.mark.asyncio
async def test_price_edit_keeps_preferred_supplier(db, hotel):
    """Regression: a plain price edit must NOT un-choose the ★ preferred supplier
    (was defaulting is_preferred=False → Inventory dropped to the cheapest vendor)."""
    item = await inv_service.create_item(db, hotel.id, name="Basmati Rice", unit="kg")
    cheap = await vendor_service.create_vendor(db, hotel.id, name="Cheap Co")
    chosen = await vendor_service.create_vendor(db, hotel.id, name="Chosen Co")
    await vendor_service.upsert_vendor_item(db, cheap.id, item.id, Decimal("4.50"))
    await vendor_service.upsert_vendor_item(db, chosen.id, item.id, Decimal("5.00"))
    # pick the (pricier) chosen supplier, then edit ITS price the way the UI does (price only)
    assert await vendor_service.set_preferred_vendor(db, hotel.id, item.id, chosen.id)
    await vendor_service.upsert_vendor_item(db, chosen.id, item.id, Decimal("5.25"))

    vi = next(v for v in await vendor_service.list_vendor_items(db, chosen.id) if v.item_id == item.id)
    assert vi.is_preferred is True            # chosen flag survived the price edit
    assert vi.price_per_unit == Decimal("5.25")


@pytest.mark.asyncio
async def test_inactive_vendor_excluded_from_comparison(db, hotel):
    item = await inv_service.create_item(db, hotel.id, name="Ginger", unit="kg")
    active = await vendor_service.create_vendor(db, hotel.id, name="Active Co")
    inactive = await vendor_service.create_vendor(db, hotel.id, name="Closed Co")
    await vendor_service.upsert_vendor_item(db, active.id, item.id, Decimal("3.00"))
    await vendor_service.upsert_vendor_item(db, inactive.id, item.id, Decimal("2.00"))
    await vendor_service.update_vendor(db, inactive, is_active=False)

    result = await vendor_service.compare_vendor_prices(db, item.id, hotel.id)
    assert result["vendor_count"] == 1
    assert result["cheapest_vendor"]["vendor_name"] == "Active Co"


# ── API + RBAC ─────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_price_comparison_via_api(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)

    item = (
        await client.post("/api/inventory/items", headers=h, json={"name": "Paneer", "unit": "kg"})
    ).json()
    v1 = (await client.post("/api/vendors", headers=h, json={"name": "Exotic"})).json()
    v2 = (await client.post("/api/vendors", headers=h, json={"name": "Rudra"})).json()

    await client.post(
        f"/api/vendors/{v1['id']}/items",
        headers=h,
        json={"item_id": item["id"], "price_per_unit": "11.99"},
    )
    await client.post(
        f"/api/vendors/{v2['id']}/items",
        headers=h,
        json={"item_id": item["id"], "price_per_unit": "6.99"},
    )

    resp = await client.get(f"/api/vendors/items/{item['id']}/price-comparison", headers=h)
    assert resp.status_code == 200
    body = resp.json()
    assert body["cheapest_vendor"]["vendor_name"] == "Rudra"
    assert float(body["potential_saving_per_unit"]) == 5.0  # 11.99 - 6.99


@pytest.mark.asyncio
async def test_create_vendor_custom_category_allowed(client, make_user, auth_header):
    # Superadmins can add their own vendor types — any non-empty label is OK.
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    resp = await client.post(
        "/api/vendors",
        headers=auth_header(admin),
        json={"name": "X", "category": "SPACESHIP"},
    )
    assert resp.status_code == 201
    assert resp.json()["category"] == "SPACESHIP"


@pytest.mark.asyncio
async def test_create_vendor_overlong_category_422(client, make_user, auth_header):
    admin = await make_user("admin2@nirai.com", Role.SUPER_ADMIN.value)
    resp = await client.post(
        "/api/vendors",
        headers=auth_header(admin),
        json={"name": "X", "category": "Z" * 41},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_accountant_can_read_but_not_create_vendor(client, make_user, auth_header):
    acct = await make_user("acct@nirai.com", Role.ACCOUNTANT.value)
    h = auth_header(acct)
    assert (await client.get("/api/vendors", headers=h)).status_code == 200
    create = await client.post("/api/vendors", headers=h, json={"name": "Nope Co"})
    assert create.status_code == 403


@pytest.mark.asyncio
async def test_staff_cannot_read_vendors(client, make_user, auth_header):
    staff = await make_user("staff@nirai.com", Role.STAFF.value)
    resp = await client.get("/api/vendors", headers=auth_header(staff))
    assert resp.status_code == 403
