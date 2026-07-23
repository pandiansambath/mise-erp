"""Public site endpoints — the Caddy on-demand-TLS ask hook that decides which
`<sub>.dineai.cloud` hostnames are allowed to get a certificate."""
import pytest

from app.core.config import settings
from app.hotels.models import Hotel


@pytest.mark.asyncio
async def test_tls_check_gates_cert_issuance(client, db, monkeypatch):
    # Pin the base domain so the test is independent of the CI default.
    monkeypatch.setattr(settings, "app_base_url", "https://dineai.cloud")

    async def code(host: str) -> int:
        r = await client.get(f"/api/public/tls-check?domain={host}")
        return r.status_code

    # apex + www + reserved function subdomains → allowed to mint a cert
    assert await code("dineai.cloud") == 200
    assert await code("www.dineai.cloud") == 200
    assert await code("careers.dineai.cloud") == 200
    assert await code("controlroom.dineai.cloud") == 200

    # an unknown subdomain with no matching hotel handle → refused
    assert await code("nosuchhotel.dineai.cloud") == 404

    # a live hotel @handle → allowed
    h = Hotel(
        name="Milagu HQ", country="GB", base_currency="GBP",
        city="London", username="milaguhandle",
    )
    db.add(h)
    await db.commit()
    assert await code("milaguhandle.dineai.cloud") == 200
    assert await code("MilaguHandle.dineai.cloud") == 200  # case-insensitive

    # not our domain / multi-level / empty → refused
    assert await code("evil.com") == 404
    assert await code("a.b.dineai.cloud") == 404
    assert await code("") == 400


@pytest.mark.asyncio
async def test_hotel_landing_public(client, db):
    from app.hotels.models import Hotel

    h = Hotel(
        name="Milagu Kitchen", country="GB", base_currency="GBP", city="London",
        username="milagukitchen",
        landing={"tagline": "Fire & spice", "accent": "#ff5500", "show_order": True},
    )
    db.add(h)
    await db.commit()

    r = await client.get("/api/public/hotel-landing/milagukitchen")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Milagu Kitchen"
    assert body["username"] == "milagukitchen"
    assert body["order_url"].endswith(f"/order/{body['hotel_id']}")
    # stored overrides + merged defaults
    assert body["landing"]["tagline"] == "Fire & spice"
    assert body["landing"]["accent"] == "#ff5500"
    assert body["landing"]["show_order"] is True
    assert body["landing"]["theme"] == "dark"  # default filled in

    # unknown handle → 404
    assert (await client.get("/api/public/hotel-landing/nope")).status_code == 404
