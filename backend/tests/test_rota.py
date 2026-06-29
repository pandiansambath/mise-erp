"""Rota tests — shift hours/cost + labour summary."""
from decimal import Decimal

import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_shift_hours_cost_and_labour(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    emp = (
        await client.post(
            "/api/employees",
            headers=h,
            json={"full_name": "Sam", "salary_type": "HOURLY", "hourly_rate": "10.00"},
        )
    ).json()

    # 09:00–17:00 = 8h × £10 = £80
    r = await client.post(
        "/api/rota/shifts",
        headers=h,
        json={"employee_id": emp["id"], "date": "2026-06-15", "start_time": "09:00", "end_time": "17:00"},
    )
    assert r.status_code == 201
    body = r.json()
    assert float(body["hours"]) == 8.0
    assert float(body["cost"]) == 80.0
    assert body["employee_name"] == "Sam"

    lab = (
        await client.get("/api/rota/labour?date_from=2026-06-15&date_to=2026-06-15", headers=h)
    ).json()
    assert float(lab["total_hours"]) == 8.0
    assert float(lab["total_cost"]) == 80.0
    assert len(lab["by_employee"]) == 1


@pytest.mark.asyncio
async def test_rota_exports_render(client, make_user, auth_header):
    """The matrix rota exports (xlsx + pdf) render real bytes for a populated week."""
    admin = await make_user("rota-exp@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    emp = (
        await client.post(
            "/api/employees",
            headers=h,
            json={"full_name": "Bala", "salary_type": "HOURLY", "hourly_rate": "10.00"},
        )
    ).json()
    await client.post(
        "/api/rota/shifts",
        headers=h,
        json={
            "employee_id": emp["id"], "date": "2026-06-22",
            "start_time": "09:00", "end_time": "17:00",
        },
    )
    qs = "date_from=2026-06-22&date_to=2026-06-28"

    xl = await client.get(f"/api/rota/export.xlsx?{qs}", headers=h)
    assert xl.status_code == 200
    assert "spreadsheet" in xl.headers["content-type"]
    assert len(xl.content) > 100

    pdf = await client.get(f"/api/rota/export.pdf?{qs}", headers=h)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content[:4] == b"%PDF"


def test_shift_hours_subtracts_break():
    from datetime import time

    from app.rota.service import shift_hours
    assert shift_hours(time(9, 0), time(17, 0), 0) == Decimal("8.00")
    assert shift_hours(time(9, 0), time(17, 0), 30) == Decimal("7.50")
    # a break longer than the shift can't make paid hours negative
    assert shift_hours(time(9, 0), time(10, 0), 120) == Decimal("0.00")


@pytest.mark.asyncio
async def test_shift_break_reduces_paid_hours(client, make_user, auth_header):
    admin = await make_user("brk@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    emp = (
        await client.post(
            "/api/employees", headers=h,
            json={"full_name": "Sam", "salary_type": "HOURLY", "hourly_rate": "10.00"},
        )
    ).json()
    # 09:00–17:00 = 8h, minus a 30-min break = 7.5h × £10 = £75
    r = await client.post(
        "/api/rota/shifts", headers=h,
        json={
            "employee_id": emp["id"], "date": "2026-06-15",
            "start_time": "09:00", "end_time": "17:00", "break_minutes": 30,
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert float(body["hours"]) == 7.5
    assert float(body["cost"]) == 75.0
    assert body["break_minutes"] == 30
