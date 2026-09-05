"""One request for the week, instead of eight.

    "i can note loading pages often. when i move from purchase page to inventory
     page i can see loading icon... please make our site fast faster."

The sales page drew its sparklines by asking for a full day summary once per
day of the trailing week — measured at ~600ms each on prod. This endpoint
answers the same question in one query, so the test that matters is that the
SHAPE is right: every day present including the empty ones, and the figures
landing on the correct day.
"""
from datetime import date

import pytest

from app.auth.models import Role


async def _channel(client, h, name, commission="0"):
    r = await client.post("/api/sales/channels", headers=h, json={"name": name, "commission_pct": commission})
    assert r.status_code in (200, 201), r.text
    return r.json()


@pytest.mark.asyncio
async def test_the_week_comes_back_in_one_call(client, make_user, auth_header):
    admin = await make_user("trend@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    ch = await _channel(client, h, "Dine-In")

    await client.post(
        "/api/sales/days/2026-06-10/lines",
        headers=h,
        json={"channel_id": ch["id"], "gross_amount": "120.00", "payment_method": "CARD"},
    )
    await client.post(
        "/api/sales/days/2026-06-12/lines",
        headers=h,
        json={"channel_id": ch["id"], "gross_amount": "80.00", "payment_method": "CASH"},
    )

    r = await client.get(
        "/api/sales/channel-trend?date_from=2026-06-08&date_to=2026-06-14", headers=h
    )
    assert r.status_code == 200, r.text
    body = r.json()

    # EVERY day, including the quiet ones — a sparkline with days missing tells
    # a lie about the shape of the week.
    assert body["days"] == [
        "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11",
        "2026-06-12", "2026-06-13", "2026-06-14",
    ]

    series = body["channels"]["Dine-In"]
    assert len(series) == 7
    assert series[2] == 120.0, "Wednesday's takings landed on the wrong day"
    assert series[4] == 80.0, "Friday's takings landed on the wrong day"
    assert series[0] == 0.0 and series[6] == 0.0


@pytest.mark.asyncio
async def test_it_reports_gross_not_net(client, make_user, auth_header):
    """Deliberate: the sparkline answers "how busy", and netting commission
    would make a quiet channel that pays nothing look busier than a loud one
    paying 30%."""
    admin = await make_user("trend-gross@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    ch = await _channel(client, h, "Deliveroo", commission="30")

    await client.post(
        "/api/sales/days/2026-06-10/lines",
        headers=h,
        json={"channel_id": ch["id"], "gross_amount": "100.00", "payment_method": "ONLINE"},
    )
    r = await client.get(
        "/api/sales/channel-trend?date_from=2026-06-10&date_to=2026-06-10", headers=h
    )
    assert r.json()["channels"]["Deliveroo"][0] == 100.0


@pytest.mark.asyncio
async def test_a_quiet_week_is_empty_not_an_error(client, make_user, auth_header):
    admin = await make_user("trend-quiet@nirai.com", Role.SUPER_ADMIN.value)
    r = await client.get(
        "/api/sales/channel-trend?date_from=2026-01-01&date_to=2026-01-07",
        headers=auth_header(admin),
    )
    assert r.status_code == 200
    assert len(r.json()["days"]) == 7
    assert r.json()["channels"] == {}


@pytest.mark.asyncio
async def test_it_needs_permission(client, make_user, auth_header):
    staff = await make_user("trend-staff@nirai.com", Role.STAFF.value)
    r = await client.get(
        f"/api/sales/channel-trend?date_from={date(2026, 6, 1)}&date_to={date(2026, 6, 7)}",
        headers=auth_header(staff),
    )
    assert r.status_code == 403
