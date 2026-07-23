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
