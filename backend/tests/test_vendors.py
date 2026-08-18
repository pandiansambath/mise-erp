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


@pytest.mark.asyncio
async def test_price_change_records_history(db, hotel):
    """Setting then changing a vendor price appends to the item price history."""
    milk = await inv_service.create_item(db, hotel.id, name="Milk", unit="litre")
    sk = await vendor_service.create_vendor(db, hotel.id, name="SK")

    await vendor_service.upsert_vendor_item(db, sk.id, milk.id, Decimal("1.10"))  # first price
    await vendor_service.upsert_vendor_item(db, sk.id, milk.id, Decimal("1.10"))  # no change → no row
    await vendor_service.upsert_vendor_item(db, sk.id, milk.id, Decimal("1.25"))  # a rise

    hist = await vendor_service.item_price_history(db, hotel.id, milk.id)
    assert len(hist) == 2  # first-set + the rise (the no-op isn't recorded)
    assert hist[0]["new_price"] == "1.25" and hist[0]["old_price"] == "1.10"  # newest first
    assert hist[1]["old_price"] is None and hist[1]["new_price"] == "1.10"
    assert all(h["source"] == "manual" for h in hist)


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


@pytest.mark.asyncio
async def test_price_list_strict_import(client, make_user, auth_header):
    h = auth_header(await make_user("vimp@x.com", Role.SUPER_ADMIN.value))
    v = (await client.post("/api/vendors", headers=h, json={"name": "Fresh Farms"})).json()
    good = b"Item,Price,Unit\nBasmati Rice,5.00,kg\n"
    ok = await client.post(
        f"/api/vendors/{v['id']}/items/import", headers=h,
        files={"file": ("p.csv", good, "text/csv")},
    )
    assert ok.status_code == 200
    bad = b"Item\nBasmati Rice\n"  # missing required Price column
    res = await client.post(
        f"/api/vendors/{v['id']}/items/import", headers=h,
        files={"file": ("p.csv", bad, "text/csv")},
    )
    assert res.status_code == 422 and res.json()["detail"]["errors"]


@pytest.mark.asyncio
async def test_price_edit_keeps_the_suppliers_own_pack_size(db, hotel):
    """Editing only the price must not wipe how big THIS supplier's bottle is.

    His case: one vendor's bottle holds 30 pieces, another's holds 10. That size
    is stored per vendor. Every other field on this row already survives a
    partial save; the override did not, so a plain price change silently reset
    the bottle back to the item's own size — and the next delivery credited the
    wrong number of pieces into stock.
    """
    lemon = await inv_service.create_item(db, hotel.id, name="Lemon", unit="piece")
    sk = await vendor_service.create_vendor(db, hotel.id, name="SK")

    await vendor_service.upsert_vendor_item(
        db, sk.id, lemon.id, Decimal("5.00"), pack_size_override=Decimal("30")
    )
    # A plain price edit — the form sends no pack size at all.
    vi = await vendor_service.upsert_vendor_item(db, sk.id, lemon.id, Decimal("5.50"))
    assert vi.pack_size_override == Decimal("30"), "a price edit erased the pack size"

    # ...but clearing it explicitly still works, or a typo would be permanent.
    vi = await vendor_service.upsert_vendor_item(
        db, sk.id, lemon.id, Decimal("5.50"), pack_size_override=None
    )
    assert vi.pack_size_override is None


@pytest.mark.asyncio
async def test_item_suppliers_reports_each_vendors_own_pack_size(client, make_user, auth_header):
    """The per-item supplier list must carry pack_size_override.

    It selected the column and the service put it in the dict, but the response
    schema did not declare it — and `response_model` drops what it does not
    know. So every screen fed by this endpoint saw None and fell back to the
    item's own size: a supplier whose box holds 500 kg was drawn as 50, with
    nothing anywhere looking broken.
    """
    user = await make_user("packsize@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(user)

    r = await client.post("/api/inventory/items", json={"name": "Guava", "unit": "kg"}, headers=h)
    item_id = r.json()["id"]
    v = await client.post("/api/vendors", json={"name": "Big Box Co"}, headers=h)
    vendor_id = v.json()["id"]

    r = await client.post(
        f"/api/vendors/{vendor_id}/items",
        json={"item_id": item_id, "price_per_unit": "500.00", "pack_name": "box", "pack_size": "500"},
        headers=h,
    )
    assert r.status_code == 201, r.text
    assert str(r.json()["pack_size_override"]).startswith("500")

    rows = (await client.get("/api/purchasing/item-suppliers", headers=h)).json()
    mine = [x for x in rows if x["item_id"] == item_id]
    assert mine, "the item is not listed at all"
    opt = mine[0]["vendors"][0]
    assert opt["pack_size_override"] is not None, "the endpoint dropped the pack size"
    assert str(opt["pack_size_override"]).startswith("500")
