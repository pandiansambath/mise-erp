"""Rota tests — shift hours/cost + labour summary."""
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
