"""Party-order quote tests — persist, history, frozen prices, own prices, expiry lock."""
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
    # ...and that includes giving a line its own price — there is no other write
    # path, so the one lock covers it.
    own = {
        **payload,
        "lines": [{"name": "Biryani", "qty": 5, "unit_price": 9.0, "recipe_price": 12.0,
                   "unit_cost": 5.0}],
    }
    assert (await client.patch(f"/api/party-quotes/{qid}", headers=h, json=own)).status_code == 409
    frozen = (await client.get(f"/api/party-quotes/{qid}", headers=h)).json()
    assert frozen["lines"][0]["unit_price"] == 12.0
    assert frozen["lines"][0]["own_price"] is False
    assert (await client.delete(f"/api/party-quotes/{qid}", headers=h)).status_code == 409
    # ...but can still be downloaded (frozen).
    assert (await client.get(f"/api/party-quotes/{qid}.pdf", headers=h)).status_code == 200


# ── own prices: "default u can show the recipe price but it need to be configurable" ──
# Line order in a response is by uuid4 — random — so lines are looked up by name,
# never by position.


def _by_name(q: dict) -> dict:
    return {ln["name"]: ln for ln in q["lines"]}


@pytest.mark.asyncio
async def test_party_quote_own_price_drives_totals(client, make_user, auth_header):
    admin = await make_user("party3@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    payload = {
        "customer": "Iyer engagement",
        "event_date": "2099-01-01",
        "currency": "GBP ",
        "lines": [
            # recipe says 12, he charges 10 — an own price
            {"name": "Biryani", "qty": 20, "unit_price": 10.0, "recipe_price": 12.0,
             "unit_cost": 5.0},
            # the recipe was never priced, he priced it here — an own price
            {"name": "Naan", "qty": 10, "unit_price": 2.5, "recipe_price": None,
             "unit_cost": 0.5},
            # charged exactly the recipe price — NOT an own price
            {"name": "Rice", "qty": 5, "unit_price": 4.0, "recipe_price": 4.0,
             "unit_cost": 1.0},
        ],
    }
    created = await client.post("/api/party-quotes", headers=h, json=payload)
    assert created.status_code == 201
    q = created.json()
    # The total is what is CHARGED: 20*10 + 10*2.5 + 5*4, not 20*12 + ...
    assert q["total_price"] == 245.0
    assert q["total_cost"] == 110.0   # 20*5 + 10*0.5 + 5*1
    by = _by_name(q)
    assert by["Biryani"]["own_price"] is True
    assert by["Naan"]["own_price"] is True
    assert by["Rice"]["own_price"] is False
    assert by["Biryani"]["recipe_price"] == 12.0
    assert by["Naan"]["recipe_price"] is None
    assert by["Rice"]["recipe_price"] == 4.0
    assert by["Biryani"]["unit_price"] == 10.0
    assert by["Naan"]["unit_price"] == 2.5
    assert by["Rice"]["unit_price"] == 4.0
    qid = q["id"]

    # Persisted, not merely echoed back from the request.
    got = await client.get(f"/api/party-quotes/{qid}", headers=h)
    assert got.status_code == 200
    gby = _by_name(got.json())
    assert [gby[n]["own_price"] for n in ("Biryani", "Naan", "Rice")] == [True, True, False]
    assert gby["Biryani"]["recipe_price"] == 12.0

    # "use recipe price" — Biryani goes back to 12, and stops being an own price.
    payload["lines"][0]["unit_price"] = 12.0
    upd = await client.patch(f"/api/party-quotes/{qid}", headers=h, json=payload)
    assert upd.status_code == 200
    for body in (upd.json(), (await client.get(f"/api/party-quotes/{qid}", headers=h)).json()):
        # exactly the new lines — the replaced ones must not linger in the response
        assert len(body["lines"]) == 3
        b = _by_name(body)
        assert b["Biryani"]["own_price"] is False
        assert b["Biryani"]["unit_price"] == 12.0
        assert body["total_price"] == 285.0   # 240 + 25 + 20


@pytest.mark.asyncio
async def test_party_quote_line_without_recipe_price_is_recipe_priced(
    client, make_user, auth_header
):
    """A page from before own prices never sends recipe_price — and everything it
    could send was the recipe's price. Those lines must not read as own prices."""
    admin = await make_user("party4@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    payload = {
        "event_date": "2099-01-01",
        "lines": [{"name": "Biryani", "qty": 20, "unit_price": 12.0, "unit_cost": 5.0}],
    }
    created = await client.post("/api/party-quotes", headers=h, json=payload)
    assert created.status_code == 201
    ln = _by_name(created.json())["Biryani"]
    assert ln["own_price"] is False
    assert ln["recipe_price"] == 12.0


@pytest.mark.asyncio
async def test_party_quote_complimentary_and_unpriced_lines(client, make_user, auth_header):
    """£0 is a price (complimentary) and differs from the recipe's, so it is an own
    price; no price on either side is not — that line shows the 'no price' chip."""
    admin = await make_user("party5@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    payload = {
        "event_date": "2099-01-01",
        "lines": [
            {"name": "Kheer", "qty": 10, "unit_price": 0.0, "recipe_price": 3.0,
             "unit_cost": 1.0},
            {"name": "Water", "qty": 5, "unit_price": None, "recipe_price": None,
             "unit_cost": 0.2},
        ],
    }
    created = await client.post("/api/party-quotes", headers=h, json=payload)
    assert created.status_code == 201
    q = created.json()
    by = _by_name(q)
    assert by["Kheer"]["own_price"] is True
    assert by["Kheer"]["unit_price"] == 0.0
    assert by["Water"]["own_price"] is False
    assert by["Water"]["unit_price"] is None
    assert q["total_price"] == 0.0
    assert q["total_cost"] == 11.0   # 10*1 + 5*0.2
    assert q["profit"] == -11.0


@pytest.mark.asyncio
async def test_party_quote_total_is_sum_of_stored_lines(client, make_user, auth_header):
    """The line is stored at 2dp, so the total must be the sum of THOSE figures.
    12.345 a plate stores as 12.35; three plates are 37.05 — the old total, rounded
    from the raw floats, said 37.04."""
    admin = await make_user("party6@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    payload = {
        "event_date": "2099-01-01",
        "lines": [{"name": "Biryani", "qty": 3, "unit_price": 12.345, "unit_cost": 0.0}],
    }
    created = await client.post("/api/party-quotes", headers=h, json=payload)
    assert created.status_code == 201
    q = created.json()
    assert _by_name(q)["Biryani"]["unit_price"] == 12.35
    assert q["total_price"] == 37.05


@pytest.mark.asyncio
async def test_party_quote_rejects_negative_price(client, make_user, auth_header):
    admin = await make_user("party7@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    for bad in ({"unit_price": -1}, {"unit_price": 5.0, "recipe_price": -1}):
        payload = {
            "event_date": "2099-01-01",
            "lines": [{"name": "Biryani", "qty": 1, "unit_cost": 0.0, **bad}],
        }
        r = await client.post("/api/party-quotes", headers=h, json=payload)
        assert r.status_code == 422, bad


@pytest.mark.asyncio
async def test_another_hotel_cannot_touch_a_quote(client, db, make_user, auth_header):
    """A quote's own prices are a restaurant's private deal. Another hotel can
    neither see the quote nor re-price, download or delete it."""
    from app.hotels.models import Hotel

    owner = await make_user("party8@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    payload = {
        "customer": "Private deal",
        "event_date": "2099-01-01",
        "lines": [{"name": "Biryani", "qty": 20, "unit_price": 10.0, "recipe_price": 12.0,
                   "unit_cost": 5.0}],
    }
    created = await client.post("/api/party-quotes", headers=h, json=payload)
    assert created.status_code == 201
    qid = created.json()["id"]

    other = Hotel(name="Next Door", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    stranger = await make_user(
        "stranger@nextdoor.com", Role.SUPER_ADMIN.value, hotel_id=other.id
    )
    sh = auth_header(stranger)

    lst = await client.get("/api/party-quotes", headers=sh)
    assert lst.status_code == 200
    assert all(x["id"] != qid for x in lst.json())
    assert (await client.get(f"/api/party-quotes/{qid}", headers=sh)).status_code == 404
    assert (await client.get(f"/api/party-quotes/{qid}.pdf", headers=sh)).status_code == 404
    repriced = {**payload, "lines": [{**payload["lines"][0], "unit_price": 1.0}]}
    assert (
        await client.patch(f"/api/party-quotes/{qid}", headers=sh, json=repriced)
    ).status_code == 404
    assert (await client.delete(f"/api/party-quotes/{qid}", headers=sh)).status_code == 404

    # ...and the owner's quote is exactly as he left it.
    mine = (await client.get(f"/api/party-quotes/{qid}", headers=h)).json()
    assert mine["total_price"] == 200.0
    assert _by_name(mine)["Biryani"]["unit_price"] == 10.0
    assert _by_name(mine)["Biryani"]["own_price"] is True


async def test_party_cost_total_is_not_built_from_rounded_plates(client, make_user, auth_header):
    """A plate's cost has four decimals (recipes cost at 4dp). Rounding it to the
    penny BEFORE multiplying moved a 500-plate line's cost by £2.50."""
    admin = await make_user("party-cost@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)
    payload = {
        "customer": "Big function",
        "event_date": "2099-01-01",
        "currency": "GBP ",
        "lines": [{"name": "Rasam", "qty": 500, "unit_price": 1.0, "unit_cost": 0.125}],
    }
    r = await client.post("/api/party-quotes", headers=h, json=payload)
    assert r.status_code == 201, r.text
    assert r.json()["total_cost"] == 62.5  # 0.125 x 500 — not 0.13 x 500 = 65.00
    assert r.json()["total_price"] == 500.0


def test_party_prices_must_be_real_numbers() -> None:
    """Infinity and NaN pass `ge=0` unless refused, and then crash the 2dp
    rounding. Checked on the SCHEMA: over HTTP, FastAPI's own 422 body echoes
    the bad input back and cannot encode Infinity either — an edge only a
    hand-made API call can reach (the page cannot send it)."""
    import json

    import pytest
    from pydantic import ValidationError

    from app.party.schemas import PartyQuoteLineIn

    for field in ("unit_price", "recipe_price", "unit_cost"):
        for bad in (float("inf"), float("nan")):
            line = {"name": "Dosa", "qty": 2, "unit_price": 3.0, "unit_cost": 1.0, field: bad}
            with pytest.raises(ValidationError):
                PartyQuoteLineIn.model_validate_json(json.dumps(line, allow_nan=True))
