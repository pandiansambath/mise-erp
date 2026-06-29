"""Daily sales & cash tests."""
from datetime import date
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.sales import service
from app.sales.service import commission_for

DAY = "2026-06-01"


# ── Pure function ─────────────────────────────────────────────────────────
def test_commission_math():
    assert commission_for(Decimal("100"), Decimal("30")) == Decimal("30.00")
    assert commission_for(Decimal("100"), Decimal("0")) == Decimal("0.00")
    assert commission_for(Decimal("123.45"), Decimal("14")) == Decimal("17.28")


# ── Service-level ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_default_channels_seeded(db, hotel):
    await service.ensure_default_channels(db, hotel.id)
    channels = await service.list_channels(db, hotel.id)
    names = {c.name for c in channels}
    assert {"Dine-In", "Takeaway", "Deliveroo", "Uber Eats", "Just Eat", "FoodHub"} <= names
    # idempotent
    await service.ensure_default_channels(db, hotel.id)
    assert len(await service.list_channels(db, hotel.id)) == len(channels)


@pytest.mark.asyncio
async def test_day_summary_commission_net_and_cash_variance(db, hotel):
    await service.ensure_default_channels(db, hotel.id)
    channels = {c.name: c for c in await service.list_channels(db, hotel.id)}
    d = date(2026, 6, 1)

    day = await service.upsert_day(db, hotel.id, d, opening_cash=Decimal("100"))
    # Deliveroo £100 online (30% commission), Dine-In £50 cash (0%)
    await service.add_line(db, day, channels["Deliveroo"].id, Decimal("100"), "ONLINE")
    await service.add_line(db, day, channels["Dine-In"].id, Decimal("50"), "CASH")
    await service.upsert_day(db, hotel.id, d, cash_counted=Decimal("150"))

    s = await service.day_summary(db, hotel.id, d)
    assert s["totals"]["gross"] == Decimal("150")
    assert s["totals"]["commission"] == Decimal("30.00")
    assert s["totals"]["net"] == Decimal("120.00")
    assert s["totals"]["cash_sales"] == Decimal("50")
    assert s["expected_cash"] == Decimal("150")  # opening 100 + cash 50
    assert s["cash_variance"] == Decimal("0")  # counted 150 - expected 150


@pytest.mark.asyncio
async def test_cash_variance_flags_shortfall(db, hotel):
    await service.ensure_default_channels(db, hotel.id)
    channels = {c.name: c for c in await service.list_channels(db, hotel.id)}
    d = date(2026, 6, 2)
    day = await service.upsert_day(db, hotel.id, d, opening_cash=Decimal("100"))
    await service.add_line(db, day, channels["Takeaway"].id, Decimal("200"), "CASH")
    await service.upsert_day(db, hotel.id, d, cash_counted=Decimal("280"))  # £20 short
    s = await service.day_summary(db, hotel.id, d)
    assert s["cash_variance"] == Decimal("-20")


# ── API + RBAC ────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_cashier_can_enter_sales(client, make_user, auth_header):
    cashier = await make_user("cashier@nirai.com", Role.CASHIER.value)
    h = auth_header(cashier)
    channels = (await client.get("/api/sales/channels", headers=h)).json()
    assert len(channels) >= 6
    deliveroo = next(c for c in channels if c["name"] == "Deliveroo")

    resp = await client.post(
        f"/api/sales/days/{DAY}/lines",
        headers=h,
        json={"channel_id": deliveroo["id"], "gross_amount": "500", "payment_method": "ONLINE"},
    )
    assert resp.status_code == 201
    body = resp.json()
    assert float(body["totals"]["gross"]) == 500.0
    assert float(body["totals"]["commission"]) == 150.0  # 30%
    assert float(body["totals"]["net"]) == 350.0


@pytest.mark.asyncio
async def test_save_cash_drawer(client, make_user, auth_header):
    """PATCH day with only cash fields (no date in body) must work — regression."""
    cashier = await make_user("cashier@nirai.com", Role.CASHIER.value)
    h = auth_header(cashier)
    patched = await client.patch(
        f"/api/sales/days/{DAY}", headers=h, json={"opening_cash": "200", "cash_counted": "150"}
    )
    assert patched.status_code == 200
    day = (await client.get(f"/api/sales/days/{DAY}", headers=h)).json()
    assert float(day["opening_cash"]) == 200.0
    assert float(day["cash_variance"]) == -50.0  # counted 150 - expected 200


@pytest.mark.asyncio
async def test_day_sheet_pdf(client, make_user, auth_header):
    """Daily sales & cash sheet downloads as a valid PDF."""
    cashier = await make_user("cashier@nirai.com", Role.CASHIER.value)
    h = auth_header(cashier)
    await client.patch(f"/api/sales/days/{DAY}", headers=h, json={"opening_cash": "100"})
    pdf = await client.get(f"/api/sales/days/{DAY}/sheet.pdf", headers=h)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"


@pytest.mark.asyncio
async def test_cashier_cannot_configure_channels(client, make_user, auth_header):
    cashier = await make_user("cashier@nirai.com", Role.CASHIER.value)
    resp = await client.post(
        "/api/sales/channels",
        headers=auth_header(cashier),
        json={"name": "Hungry", "commission_pct": "10"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_manager_can_configure_channels(client, make_user, auth_header):
    manager = await make_user("manager@nirai.com", Role.MANAGER.value)
    resp = await client.post(
        "/api/sales/channels",
        headers=auth_header(manager),
        json={"name": "Hungry Panda", "commission_pct": "12.5"},
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Hungry Panda"


@pytest.mark.asyncio
async def test_staff_cannot_read_sales(client, make_user, auth_header):
    staff = await make_user("staff@nirai.com", Role.STAFF.value)
    resp = await client.get("/api/sales/channels", headers=auth_header(staff))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_sales_isolated_between_hotels(client, make_user, auth_header, db):
    from app.hotels.models import Hotel

    other = Hotel(name="Other", country="IN", base_currency="INR")
    db.add(other)
    await db.commit()
    await db.refresh(other)

    nirai_admin = await make_user("a@nirai.com", Role.SUPER_ADMIN.value)
    other_admin = await make_user("a@other.com", Role.SUPER_ADMIN.value, hotel_id=other.id)

    ch = (await client.get("/api/sales/channels", headers=auth_header(nirai_admin))).json()
    deliveroo = next(c for c in ch if c["name"] == "Deliveroo")
    await client.post(
        f"/api/sales/days/{DAY}/lines",
        headers=auth_header(nirai_admin),
        json={"channel_id": deliveroo["id"], "gross_amount": "500", "payment_method": "ONLINE"},
    )

    # Other hotel's owner sees an empty day
    resp = await client.get(f"/api/sales/days/{DAY}", headers=auth_header(other_admin))
    assert float(resp.json()["totals"]["gross"]) == 0.0
    # …and cannot use NIRAI's channel id
    cross = await client.post(
        f"/api/sales/days/{DAY}/lines",
        headers=auth_header(other_admin),
        json={"channel_id": deliveroo["id"], "gross_amount": "100", "payment_method": "ONLINE"},
    )
    assert cross.status_code == 404


@pytest.mark.asyncio
async def test_sales_strict_import(client, make_user, auth_header):
    h = auth_header(await make_user("simp@x.com", Role.SUPER_ADMIN.value))
    await client.get("/api/sales/channels", headers=h)  # seed default channels
    good = b"Channel,Gross,Method\nDine-in,240.00,CARD\n"
    ok = await client.post(
        "/api/sales/days/2026-06-15/import", headers=h,
        files={"file": ("s.csv", good, "text/csv")},
    )
    assert ok.status_code == 200
    bad = b"Channel\nDine-in\n"  # missing required Gross column
    res = await client.post(
        "/api/sales/days/2026-06-15/import", headers=h,
        files={"file": ("s.csv", bad, "text/csv")},
    )
    assert res.status_code == 422 and res.json()["detail"]["errors"]
