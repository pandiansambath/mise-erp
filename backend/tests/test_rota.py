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


@pytest.mark.asyncio
async def test_rota_strict_import(client, make_user, auth_header):
    h = auth_header(await make_user("rimp@nirai.com", Role.SUPER_ADMIN.value))
    await client.post(
        "/api/employees", headers=h,
        json={"full_name": "Sam", "salary_type": "HOURLY", "hourly_rate": "10.00"},
    )
    good = b"Employee,Date,Start,End,Break (min),Notes\nSam,2026-06-30,09:00,17:00,30,opening\n"
    ok = await client.post(
        "/api/rota/import", headers=h, files={"file": ("r.csv", good, "text/csv")},
    )
    assert ok.status_code == 200 and ok.json()["created"] == 1
    bad = b"Employee,Date,Start,End\nSam,not-a-date,09:00,17:00\n"  # bad date
    res = await client.post(
        "/api/rota/import", headers=h, files={"file": ("r.csv", bad, "text/csv")},
    )
    assert res.status_code == 422 and res.json()["detail"]["errors"]


# ── Grid template (looks exactly like the download) + grid round-trip ─────────
_GRID_HEADER = (
    "Employee,Emp ID,Role,Mon 22/06,Tue 23/06,Wed 24/06,Thu 25/06,"
    "Fri 26/06,Sat 27/06,Sun 28/06,Total h"
)


def _grid_csv(tue_cell: str) -> bytes:
    """A weekly grid CSV for 2026-06-22→28 with one shift cell on Tue 23/06."""
    return (
        "Mise — Weekly Rota\n"
        "2026-06-22 → 2026-06-28  ·  fill cells like 09:00-17:00\n"
        f"{_GRID_HEADER}\n"
        f"Sam,,,,{tue_cell},,,,,,\n"
    ).encode()


@pytest.mark.asyncio
async def test_rota_grid_template_is_a_grid(client, make_user, auth_header):
    """The downloadable template is now the weekly grid (day columns), not the old
    one-row-per-shift sheet."""
    h = auth_header(await make_user("gtpl@nirai.com", Role.SUPER_ADMIN.value))
    r = await client.get(
        "/api/rota/template.csv?date_from=2026-06-22&date_to=2026-06-28", headers=h
    )
    assert r.status_code == 200
    text = r.content.decode("utf-8-sig")
    assert "Mon 22/06" in text and "Employee" in text  # grid day columns
    assert "Start" not in text  # not the old row-per-shift template

    xl = await client.get("/api/rota/template.xlsx", headers=h)
    assert xl.status_code == 200 and "spreadsheet" in xl.headers["content-type"]


@pytest.mark.asyncio
async def test_rota_grid_import_roundtrip_and_replace(client, make_user, auth_header):
    h = auth_header(await make_user("grid@nirai.com", Role.SUPER_ADMIN.value))
    await client.post(
        "/api/employees", headers=h,
        json={"full_name": "Sam", "salary_type": "HOURLY", "hourly_rate": "10.00"},
    )
    # Upload a grid with a 09:00-17:00 -30m shift on Tue 23/06 → 7.5h paid.
    up = await client.post(
        "/api/rota/import", headers=h,
        files={"file": ("rota.csv", _grid_csv("09:00-17:00 -30m"), "text/csv")},
    )
    assert up.status_code == 200 and up.json()["created"] == 1
    shifts = (
        await client.get(
            "/api/rota/shifts?date_from=2026-06-22&date_to=2026-06-28", headers=h
        )
    ).json()
    assert len(shifts) == 1
    assert shifts[0]["date"] == "2026-06-23" and shifts[0]["break_minutes"] == 30
    assert float(shifts[0]["hours"]) == 7.5

    # Re-upload the same week with a different time → REPLACES (no duplicate).
    up2 = await client.post(
        "/api/rota/import", headers=h,
        files={"file": ("rota.csv", _grid_csv("10:00-18:00"), "text/csv")},
    )
    assert up2.status_code == 200
    shifts2 = (
        await client.get(
            "/api/rota/shifts?date_from=2026-06-22&date_to=2026-06-28", headers=h
        )
    ).json()
    assert len(shifts2) == 1  # replaced, not duplicated
    assert shifts2[0]["start_time"][:5] == "10:00" and float(shifts2[0]["hours"]) == 8.0


@pytest.mark.asyncio
async def test_rota_grid_import_xlsx_and_bad_cell(client, make_user, auth_header):
    import io as _io

    from openpyxl import Workbook

    h = auth_header(await make_user("gridx@nirai.com", Role.SUPER_ADMIN.value))
    await client.post(
        "/api/employees", headers=h,
        json={"full_name": "Sam", "salary_type": "HOURLY", "hourly_rate": "10.00"},
    )
    wb = Workbook()
    ws = wb.active
    ws.append(["Mise — Weekly Rota"])
    ws.append(["2026-06-22 → 2026-06-28  fill cells"])
    ws.append(_GRID_HEADER.split(","))
    ws.append(["Sam", "", "", "", "9 to 5", "", "", "", "", "", ""])  # unreadable cell
    buf = _io.BytesIO()
    wb.save(buf)
    mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    bad = await client.post(
        "/api/rota/import", headers=h, files={"file": ("rota.xlsx", buf.getvalue(), mime)}
    )
    assert bad.status_code == 422 and bad.json()["detail"]["errors"]
