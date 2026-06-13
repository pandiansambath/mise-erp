"""Audit trail tests — money-trust events are logged and access is manager-gated."""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_audit_records_price_and_waste(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    item_id = (
        await client.post("/api/inventory/items", headers=h, json={"name": "Rice", "unit": "kg"})
    ).json()["id"]
    vendor_id = (await client.post("/api/vendors", headers=h, json={"name": "SK"})).json()["id"]

    # price set -> logged
    await client.post(
        f"/api/vendors/{vendor_id}/items",
        headers=h,
        json={"item_id": item_id, "price_per_unit": "2.00"},
    )
    # stock in + waste -> logged
    await client.post(
        f"/api/inventory/items/{item_id}/movements",
        headers=h,
        json={"movement_type": "PURCHASE_IN", "quantity": "10", "unit_cost": "2.00"},
    )
    await client.post(
        "/api/inventory/waste", headers=h, json={"item_id": item_id, "quantity": "2", "reason": "spoiled"}
    )

    events = (await client.get("/api/audit", headers=h)).json()
    actions = {e["action"] for e in events}
    assert "vendor.price" in actions
    assert "stock.waste" in actions
    assert events[0]["user_email"] == "admin@nirai.com"  # newest first


@pytest.mark.asyncio
async def test_audit_is_manager_gated(client, make_user, auth_header):
    cashier = await make_user("cash@nirai.com", Role.CASHIER.value)
    resp = await client.get("/api/audit", headers=auth_header(cashier))
    assert resp.status_code == 403
