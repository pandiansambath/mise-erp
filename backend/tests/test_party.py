"""Party-order quote tests — persist, history, frozen prices, expiry lock."""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_party_quote_lifecycle(client, make_user, auth_header):
    admin = await make_user("party@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    payload = {
        "customer": "Sharma wedding",
        "event_date": "2099-01-01",
        "currency": "GBP ",
        "lines": [
            {"name": "Biryani", "qty": 20, "unit_price": 12.0, "unit_cost": 5.0},
            {"name": "Naan", "qty": 10, "unit_price": None, "unit_cost": 0.5},
        ],
    }
    created = await client.post("/api/party-quotes", headers=h, json=payload)
    assert created.status_code == 201
    q = created.json()
    assert q["customer"] == "Sharma wedding"
    assert q["total_price"] == 240.0  # 20*12 (Naan has no price -> excluded)
    assert q["total_cost"] == 105.0   # 20*5 + 10*0.5
    assert q["is_expired"] is False
    assert len(q["lines"]) == 2
    qid = q["id"]

    lst = await client.get("/api/party-quotes", headers=h)
    assert lst.status_code == 200
    assert any(x["id"] == qid for x in lst.json())

    pdf = await client.get(f"/api/party-quotes/{qid}.pdf", headers=h)
    assert pdf.status_code == 200
    assert pdf.content[:4] == b"%PDF"

    payload["customer"] = "Sharma reception"
    upd = await client.patch(f"/api/party-quotes/{qid}", headers=h, json=payload)
    assert upd.status_code == 200
    assert upd.json()["customer"] == "Sharma reception"

    d = await client.delete(f"/api/party-quotes/{qid}", headers=h)
    assert d.status_code == 204


@pytest.mark.asyncio
async def test_party_quote_expired_is_locked(client, make_user, auth_header):
    admin = await make_user("party2@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    payload = {
        "customer": "Old event",
        "event_date": "2020-01-01",
        "currency": "GBP ",
        "lines": [{"name": "Biryani", "qty": 5, "unit_price": 12.0, "unit_cost": 5.0}],
    }
    created = await client.post("/api/party-quotes", headers=h, json=payload)
    assert created.status_code == 201
    q = created.json()
    assert q["is_expired"] is True
    qid = q["id"]

    # Expired quotes are locked: no edit, no delete...
    assert (await client.patch(f"/api/party-quotes/{qid}", headers=h, json=payload)).status_code == 409
    assert (await client.delete(f"/api/party-quotes/{qid}", headers=h)).status_code == 409
    # ...but can still be downloaded (frozen).
    assert (await client.get(f"/api/party-quotes/{qid}.pdf", headers=h)).status_code == 200
