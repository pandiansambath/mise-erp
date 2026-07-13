"""last_login stamping, vendor spend endpoint, Control Room health fields."""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_login_stamps_last_login(client, make_user):
    await make_user("stamp@x.com", Role.STAFF.value)
    r = await client.post("/api/auth/login", json={"email": "stamp@x.com", "password": "password123"})
    assert r.status_code == 200
    assert r.json()["user"]["last_login"] is not None


@pytest.mark.asyncio
async def test_vendor_spend_empty_ok(client, make_user, auth_header):
    mgr = await make_user("spend@x.com", Role.MANAGER.value)
    r = await client.get("/api/vendors/spend?days=90", headers=auth_header(mgr))
    assert r.status_code == 200
    assert r.json() == {"days": 90, "vendors": []}


@pytest.mark.asyncio
async def test_vendor_spend_scorecard_fields(client, make_user, auth_header, db, hotel):
    """Scorecard: a received PO -> spend + orders count; an upward price move
    (10 -> 12 in price_history) -> price_rises count."""
    from decimal import Decimal

    from app.inventory import service as inv
    from app.purchasing import service as pur
    from app.vendors import service as ven

    rice = await inv.create_item(db, hotel.id, name="Scorecard Rice", unit="kg")
    v = await ven.create_vendor(db, hotel.id, name="Score Foods")
    await ven.upsert_vendor_item(db, v.id, rice.id, Decimal("10.00"))
    await ven.upsert_vendor_item(db, v.id, rice.id, Decimal("12.00"))  # upward -> history row
    await ven.set_preferred_vendor(db, hotel.id, rice.id, v.id)
    indent = await pur.create_indent(
        db, hotel.id, [{"item_id": rice.id, "required_qty": Decimal("5")}]
    )
    po = (await pur.generate_pos(db, indent))["purchase_orders"][0]
    poi = (await pur.po_items(db, po.id))[0]
    mgr = await make_user("score@x.com", Role.MANAGER.value)
    res = await client.post(
        f"/api/purchasing/purchase-orders/{po.id}/receive",
        headers=auth_header(mgr),
        json={"lines": [{"po_item_id": str(poi["po_item_id"]), "received_qty": "5"}]},
    )
    assert res.status_code == 200

    r = await client.get("/api/vendors/spend?days=90", headers=auth_header(mgr))
    assert r.status_code == 200
    vendors = r.json()["vendors"]
    assert len(vendors) == 1
    row = vendors[0]
    assert row["orders"] == 1
    assert row["price_rises"] >= 1
    assert float(row["total"]) == 60.0  # 5 kg x 12.00


@pytest.mark.asyncio
async def test_hotel_list_has_health_fields(client, make_user, auth_header, db):
    owner = await make_user("op5@mise.com", Role.SUPER_ADMIN.value)
    owner.is_platform_owner = True
    await db.commit()
    # log the owner in so the hotel has activity
    await client.post("/api/auth/login", json={"email": "op5@mise.com", "password": "password123"})
    r = await client.get("/api/platform/hotels", headers=auth_header(owner))
    assert r.status_code == 200
    h = r.json()["hotels"][0]
    assert "sales_entries_7d" in h and "last_active" in h
    assert h["last_active"] is not None  # the login above stamped it
