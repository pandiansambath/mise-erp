"""Budget vs actual tests — set targets, compare, and manager-gating."""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_budget_set_and_compare(client, make_user, auth_header):
    admin = await make_user("owner@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)

    put = await client.put(
        "/api/reports/budget", headers=h, json={"monthly_sales": "5000", "food_cost_pct": "30"}
    )
    assert put.status_code == 200
    body = put.json()
    assert float(body["targets"]["monthly_sales"]) == 5000.0
    assert float(body["targets"]["food_cost_pct"]) == 30.0
    assert "monthly_sales" in body["actual"]  # live actuals included

    got = (await client.get("/api/reports/budget", headers=h)).json()
    assert float(got["targets"]["food_cost_pct"]) == 30.0


@pytest.mark.asyncio
async def test_budget_set_requires_manager(client, make_user, auth_header):
    cashier = await make_user("cash@nirai.com", Role.CASHIER.value)
    resp = await client.put(
        "/api/reports/budget", headers=auth_header(cashier), json={"monthly_sales": "1"}
    )
    assert resp.status_code == 403
