"""Phase 0 smoke tests — app boots and health endpoints respond."""
import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_root(client: AsyncClient):
    resp = await client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["name"] == "Mise API"


@pytest.mark.asyncio
async def test_health_liveness(client: AsyncClient):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_health_db_readiness(client: AsyncClient):
    resp = await client.get("/api/health/db")
    assert resp.status_code == 200
    assert resp.json()["db"] == "reachable"
