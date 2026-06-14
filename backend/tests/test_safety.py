"""Food-safety log tests — temperature + checks, hotel-scoped, validated kinds."""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_safety_logs_temp_and_check(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)

    temp = await client.post(
        "/api/safety/logs",
        headers=h,
        json={"kind": "TEMP", "label": "Walk-in fridge", "reading": "9.5", "status": "FAIL"},
    )
    assert temp.status_code == 201
    await client.post(
        "/api/safety/logs",
        headers=h,
        json={"kind": "CHECK", "label": "Surfaces sanitised", "status": "DONE"},
    )

    logs = (await client.get("/api/safety/logs", headers=h)).json()
    assert len(logs) == 2
    assert {x["kind"] for x in logs} == {"TEMP", "CHECK"}
    failing = next(x for x in logs if x["kind"] == "TEMP")
    assert failing["status"] == "FAIL"
    assert float(failing["reading"]) == 9.5


@pytest.mark.asyncio
async def test_safety_invalid_kind_rejected(client, make_user, auth_header):
    admin = await make_user("a@nirai.com", Role.SUPER_ADMIN.value)
    resp = await client.post(
        "/api/safety/logs",
        headers=auth_header(admin),
        json={"kind": "BOGUS", "label": "x", "status": "OK"},
    )
    assert resp.status_code == 422
