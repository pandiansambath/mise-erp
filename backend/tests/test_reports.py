"""Reports / P&L / export tests."""
from datetime import date
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.expenses import service as exp
from app.reports import service
from app.sales import service as sales

FROM, TO = "2026-06-01", "2026-06-30"


async def _seed_month(db, hotel_id):
    d = date(2026, 6, 10)
    # Sales: Deliveroo £1000 @30% -> net £700
    await sales.ensure_default_channels(db, hotel_id)
    chans = {c.name: c for c in await sales.list_channels(db, hotel_id)}
    day = await sales.upsert_day(db, hotel_id, d)
    await sales.add_line(db, day, chans["Deliveroo"].id, Decimal("1000"), "ONLINE")
    # Expenses: variable £200 (food) + fixed £500 (rent)
    await exp.ensure_default_categories(db, hotel_id)
    cats = {c.name: c for c in await exp.list_categories(db, hotel_id)}
    await exp.create_expense(db, hotel_id, category_id=cats["Vegetables"].id, date=d, amount=Decimal("200"))
    await exp.create_expense(db, hotel_id, category_id=cats["Rent"].id, date=d, amount=Decimal("500"))


@pytest.mark.asyncio
async def test_pnl_math(db, hotel):
    await _seed_month(db, hotel.id)
    p = await service.pnl(db, hotel.id, date(2026, 6, 1), date(2026, 6, 30))
    assert p["gross_sales"] == Decimal("1000")
    assert p["commission"] == Decimal("300.00")
    assert p["net_sales"] == Decimal("700.00")
    assert p["cost_of_sales"] == Decimal("200")
    assert p["gross_profit"] == Decimal("500.00")  # 700 - 200
    assert p["operating_expenses"] == Decimal("500")
    assert p["net_profit"] == Decimal("0.00")  # 500 - 500
    # food cost % = 200/700 = 28.57
    assert p["food_cost_pct"] == Decimal("28.57")


@pytest.mark.asyncio
async def test_dashboard_kpis(db, hotel):
    await _seed_month(db, hotel.id)
    dash = await service.dashboard(db, hotel.id, on=date(2026, 6, 15))
    assert dash["month_net_sales"] == Decimal("700.00")
    assert dash["month_expenses"] == Decimal("700.00")  # 200 + 500
    assert dash["month_net_profit"] == Decimal("0.00")


# ── API + export + RBAC ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_pnl_via_api(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    resp = await client.get(f"/api/reports/pnl?date_from={FROM}&date_to={TO}", headers=auth_header(admin))
    assert resp.status_code == 200
    assert "net_profit" in resp.json()


@pytest.mark.asyncio
async def test_export_xlsx_and_csv(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    xlsx = await client.get(f"/api/reports/pnl.xlsx?date_from={FROM}&date_to={TO}", headers=h)
    assert xlsx.status_code == 200
    assert "spreadsheetml" in xlsx.headers["content-type"]
    assert xlsx.content[:2] == b"PK"  # xlsx is a zip
    csv = await client.get(f"/api/reports/pnl.csv?date_from={FROM}&date_to={TO}", headers=h)
    assert csv.status_code == 200
    assert "text/csv" in csv.headers["content-type"]
    assert b"Net profit" in csv.content


@pytest.mark.asyncio
async def test_cashier_cannot_view_reports(client, make_user, auth_header):
    cashier = await make_user("cashier@nirai.com", Role.CASHIER.value)
    resp = await client.get(f"/api/reports/pnl?date_from={FROM}&date_to={TO}", headers=auth_header(cashier))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_accountant_can_view_reports(client, make_user, auth_header):
    acct = await make_user("acct@nirai.com", Role.ACCOUNTANT.value)
    resp = await client.get("/api/reports/dashboard", headers=auth_header(acct))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_sales_trend_per_day(client, make_user, auth_header, db, hotel):
    """One query, one row per day with sales — commission already deducted."""
    await sales.ensure_default_channels(db, hotel.id)
    chans = {c.name: c for c in await sales.list_channels(db, hotel.id)}
    d1, d2 = date(2026, 6, 2), date(2026, 6, 4)
    day1 = await sales.upsert_day(db, hotel.id, d1)
    await sales.add_line(db, day1, chans["Deliveroo"].id, Decimal("1000"), "ONLINE")  # 30% comm
    day2 = await sales.upsert_day(db, hotel.id, d2)
    await sales.add_line(db, day2, chans["Dine-In"].id, Decimal("500"), "CASH")  # 0% comm

    acct = await make_user("trend@nirai.com", Role.ACCOUNTANT.value)
    r = await client.get(
        "/api/reports/sales-trend?date_from=2026-06-01&date_to=2026-06-30",
        headers=auth_header(acct),
    )
    assert r.status_code == 200
    days = r.json()["days"]
    assert [d["date"] for d in days] == ["2026-06-02", "2026-06-04"]
    assert days[0]["net"] == "700.00"
    assert days[1]["net"] == "500.00"
