"""Kitchen indent -> purchase order -> receive tests."""
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.inventory import service as inv
from app.purchasing import service
from app.vendors import service as ven


async def _setup_catalog(db, hotel_id):
    rice = await inv.create_item(db, hotel_id, name="Rice", unit="kg")
    chicken = await inv.create_item(db, hotel_id, name="Chicken", unit="kg")
    v1 = await ven.create_vendor(db, hotel_id, name="V1")
    v2 = await ven.create_vendor(db, hotel_id, name="V2")
    await ven.upsert_vendor_item(db, v1.id, rice.id, Decimal("5.00"))
    await ven.upsert_vendor_item(db, v2.id, rice.id, Decimal("5.50"))
    await ven.upsert_vendor_item(db, v1.id, chicken.id, Decimal("9.00"))
    await ven.upsert_vendor_item(db, v2.id, chicken.id, Decimal("8.00"))
    # Admin's chosen suppliers (POs use these, NOT the cheapest).
    await ven.set_preferred_vendor(db, hotel_id, rice.id, v1.id)
    await ven.set_preferred_vendor(db, hotel_id, chicken.id, v2.id)
    return rice, chicken, v1, v2


@pytest.mark.asyncio
async def test_generate_pos_groups_by_chosen_vendor(db, hotel):
    rice, chicken, v1, v2 = await _setup_catalog(db, hotel.id)
    indent = await service.create_indent(
        db, hotel.id,
        [{"item_id": rice.id, "required_qty": Decimal("10")},
         {"item_id": chicken.id, "required_qty": Decimal("4")}],
    )
    result = await service.generate_pos(db, indent)
    pos = result["purchase_orders"]
    assert len(pos) == 2  # rice->V1 (chosen), chicken->V2 (chosen)
    by_vendor = {po.vendor_id: po for po in pos}
    assert by_vendor[v1.id].total_amount == Decimal("50.00")  # 10 * 5.00
    assert by_vendor[v2.id].total_amount == Decimal("32.00")  # 4 * 8.00
    assert result["skipped_items"] == []
    assert indent.status == "ORDERED"


@pytest.mark.asyncio
async def test_consolidated_open_pos(client, make_user, auth_header, db, hotel):
    """The consolidated view combines all open POs across vendors with a grand total."""
    rice, chicken, v1, v2 = await _setup_catalog(db, hotel.id)
    indent = await service.create_indent(
        db, hotel.id,
        [{"item_id": rice.id, "required_qty": Decimal("10")},
         {"item_id": chicken.id, "required_qty": Decimal("4")}],
    )
    await service.generate_pos(db, indent)
    admin = await make_user("buyer@x.com", Role.SUPER_ADMIN.value)
    res = await client.get(
        "/api/purchasing/purchase-orders/consolidated", headers=auth_header(admin)
    )
    assert res.status_code == 200
    data = res.json()
    assert data["po_count"] == 2 and data["vendor_count"] == 2 and data["item_count"] == 2
    assert Decimal(data["grand_total"]) == Decimal("82.00")  # 50.00 + 32.00


@pytest.mark.asyncio
async def test_item_without_chosen_vendor_falls_back_to_cheapest(db, hotel):
    rice = await inv.create_item(db, hotel.id, name="Rice", unit="kg")
    v1 = await ven.create_vendor(db, hotel.id, name="V1")
    v2 = await ven.create_vendor(db, hotel.id, name="V2")
    await ven.upsert_vendor_item(db, v1.id, rice.id, Decimal("5.00"))  # cheapest
    await ven.upsert_vendor_item(db, v2.id, rice.id, Decimal("5.50"))
    # nobody is "chosen" — order from the cheapest
    indent = await service.create_indent(
        db, hotel.id, [{"item_id": rice.id, "required_qty": Decimal("10")}]
    )
    result = await service.generate_pos(db, indent)
    assert result["skipped_items"] == []
    assert len(result["purchase_orders"]) == 1
    po = result["purchase_orders"][0]
    assert po.vendor_id == v1.id
    assert po.total_amount == Decimal("50.00")


@pytest.mark.asyncio
async def test_per_line_picked_vendor_beats_preferred(db, hotel):
    rice, _chicken, _v1, v2 = await _setup_catalog(db, hotel.id)
    # rice's preferred is V1 (5.00), but the chef PICKS V2 (5.50) for this order
    indent = await service.create_indent(
        db, hotel.id,
        [{"item_id": rice.id, "required_qty": Decimal("10"), "vendor_id": v2.id}],
    )
    result = await service.generate_pos(db, indent)
    assert result["skipped_items"] == []
    assert len(result["purchase_orders"]) == 1
    po = result["purchase_orders"][0]
    assert po.vendor_id == v2.id
    assert po.total_amount == Decimal("55.00")  # 10 * 5.50 — the picked vendor's price


@pytest.mark.asyncio
async def test_unpriced_item_skipped(db, hotel):
    item = await inv.create_item(db, hotel.id, name="Mystery", unit="kg")  # no vendor price
    indent = await service.create_indent(
        db, hotel.id, [{"item_id": item.id, "required_qty": Decimal("5")}]
    )
    result = await service.generate_pos(db, indent)
    assert result["purchase_orders"] == []
    assert "Mystery" in result["skipped_items"]


@pytest.mark.asyncio
async def test_receive_po_increases_stock_and_cost(db, hotel):
    rice, _chicken, v1, _v2 = await _setup_catalog(db, hotel.id)
    indent = await service.create_indent(
        db, hotel.id, [{"item_id": rice.id, "required_qty": Decimal("10")}]
    )
    result = await service.generate_pos(db, indent)
    po = next(p for p in result["purchase_orders"] if p.vendor_id == v1.id)

    await service.receive_po(db, po)
    refreshed = await inv.get_item(db, rice.id, hotel.id)
    assert refreshed.current_stock == Decimal("10.000")
    assert refreshed.average_cost == Decimal("5.0000")  # received at £5
    assert po.status == "RECEIVED"


# ── API + RBAC ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_kitchen_manager_creates_indent(client, make_user, auth_header, db, hotel):
    km = await make_user("km@nirai.com", Role.KITCHEN_MANAGER.value)
    item = await inv.create_item(db, hotel.id, name="Onion", unit="kg")
    resp = await client.post(
        "/api/purchasing/indents",
        headers=auth_header(km),
        json={"items": [{"item_id": str(item.id), "required_qty": "20"}]},
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "PENDING"


@pytest.mark.asyncio
async def test_cashier_cannot_create_indent(client, make_user, auth_header, db, hotel):
    cashier = await make_user("cash@nirai.com", Role.CASHIER.value)
    item = await inv.create_item(db, hotel.id, name="Onion", unit="kg")
    resp = await client.post(
        "/api/purchasing/indents",
        headers=auth_header(cashier),
        json={"items": [{"item_id": str(item.id), "required_qty": "20"}]},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_full_flow_and_po_pdf_via_api(client, make_user, auth_header, db, hotel):
    mgr = await make_user("mgr@nirai.com", Role.MANAGER.value)
    h = auth_header(mgr)
    rice, _c, _v1, _v2 = await _setup_catalog(db, hotel.id)

    indent = (await client.post(
        "/api/purchasing/indents", headers=h,
        json={"items": [{"item_id": str(rice.id), "required_qty": "10"}]},
    )).json()
    await client.post(f"/api/purchasing/indents/{indent['id']}/approve", headers=h)
    gen = (await client.post(f"/api/purchasing/indents/{indent['id']}/generate-pos", headers=h)).json()
    assert len(gen["purchase_orders"]) == 1
    po_id = gen["purchase_orders"][0]["id"]

    pdf = await client.get(f"/api/purchasing/purchase-orders/{po_id}/pdf", headers=h)
    assert pdf.status_code == 200
    assert pdf.content[:4] == b"%PDF"

    recv = await client.post(f"/api/purchasing/purchase-orders/{po_id}/receive", headers=h)
    assert recv.status_code == 200
    assert recv.json()["status"] == "RECEIVED"


@pytest.mark.asyncio
async def test_reorder_suggestions_tops_up_to_par(db, hotel):
    # Orderable item below min with a par (max) level → suggested = par − stock
    tomato = await inv.create_item(
        db, hotel.id, name="Tomato", unit="kg",
        min_stock_level=Decimal("10"), max_stock_level=Decimal("25"),
    )
    v = await ven.create_vendor(db, hotel.id, name="SK")
    await ven.upsert_vendor_item(db, v.id, tomato.id, Decimal("2.00"))
    await inv.record_movement(db, tomato, "PURCHASE_IN", Decimal("4"), unit_cost=Decimal("2.00"))

    # Below min but NO vendor prices it → excluded (can't generate a PO)
    salt = await inv.create_item(db, hotel.id, name="Salt", unit="kg", min_stock_level=Decimal("5"))
    assert salt.current_stock == Decimal("0")  # below min, but unorderable

    sug = {s["item_name"]: s for s in await service.reorder_suggestions(db, hotel.id)}
    assert "Tomato" in sug
    assert sug["Tomato"]["suggested_qty"] == Decimal("21.000")  # 25 par − 4 on hand
    assert "Salt" not in sug


@pytest.mark.asyncio
async def test_partial_receive_records_short_delivery(db, hotel):
    """Ordered 100, got 30: only 30 hits stock, received_qty + reason are recorded."""
    rice = await inv.create_item(db, hotel.id, name="Rice", unit="kg")
    v1 = await ven.create_vendor(db, hotel.id, name="V1")
    await ven.upsert_vendor_item(db, v1.id, rice.id, Decimal("5.00"))
    await ven.set_preferred_vendor(db, hotel.id, rice.id, v1.id)
    indent = await service.create_indent(
        db, hotel.id, [{"item_id": rice.id, "required_qty": Decimal("100")}]
    )
    po = (await service.generate_pos(db, indent))["purchase_orders"][0]
    pi_id = str((await service.po_items(db, po.id))[0]["po_item_id"])

    await service.receive_po(
        db, po, lines={pi_id: Decimal("30")}, note="vendor short - sent 30 of 100"
    )
    assert po.status == "RECEIVED"
    assert po.receive_note == "vendor short - sent 30 of 100"
    # only the 30 that arrived hit stock (not the ordered 100)
    refetched = await inv.get_item(db, rice.id, hotel.id)
    assert refetched.current_stock == Decimal("30.000")
    assert (await service.po_items(db, po.id))[0]["received_qty"] == Decimal("30.000")
