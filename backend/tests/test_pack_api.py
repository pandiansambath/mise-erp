"""Saving and reading back an item's buying chain, through the API.

The maths is covered in test_packs.py. This is about the plumbing: that the
chain survives a round trip, that `base_size` comes back worked out, and that
the two ways of NOT sending it mean different things.
"""

from decimal import Decimal

import pytest

from app.auth.models import Role

PEPPER = [
    {"name": "packet", "contains": "50"},
    {"name": "small box", "contains": "30"},
    {"name": "box", "contains": "10"},
]


@pytest.mark.asyncio
async def test_his_pepper_survives_a_round_trip(client, make_user, auth_header):
    """1 box = 10 small boxes = 300 packets = 15 kg, saved and read back."""
    user = await make_user("packs@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/inventory/items",
        headers=auth_header(user),
        json={"name": "Black Pepper", "unit": "g", "pack_levels": PEPPER},
    )
    assert r.status_code == 201, r.text
    levels = r.json()["pack_levels"]

    assert [lv["name"] for lv in levels] == ["packet", "small box", "box"]
    assert [lv["position"] for lv in levels] == [1, 2, 3]
    # base_size arrives already worked out, so no screen re-derives it and gets
    # it subtly different.
    assert [Decimal(str(lv["base_size"])) for lv in levels] == [
        Decimal("50.000"),
        Decimal("1500.000"),
        Decimal("15000.000"),
    ]


@pytest.mark.asyncio
async def test_the_chain_comes_back_on_the_list(client, make_user, auth_header):
    user = await make_user("packs2@x.com", Role.SUPER_ADMIN.value)
    h = auth_header(user)
    await client.post(
        "/inventory/items",
        headers=h,
        json={"name": "Black Pepper", "unit": "g", "pack_levels": PEPPER},
    )
    rows = (await client.get("/inventory/items", headers=h)).json()
    pepper = next(i for i in rows if i["name"] == "Black Pepper")
    assert len(pepper["pack_levels"]) == 3


@pytest.mark.asyncio
async def test_an_old_item_reads_as_a_one_rung_chain(client, make_user, auth_header):
    """Items from before the chain existed must not need re-entering."""
    user = await make_user("packs3@x.com", Role.SUPER_ADMIN.value)
    h = auth_header(user)
    r = await client.post(
        "/inventory/items",
        headers=h,
        json={"name": "Rice", "unit": "kg", "pack_unit": "sack", "pack_size": "25"},
    )
    assert r.status_code == 201, r.text
    levels = r.json()["pack_levels"]
    assert len(levels) == 1
    assert levels[0]["name"] == "sack"
    assert Decimal(str(levels[0]["base_size"])) == Decimal("25.000")


@pytest.mark.asyncio
async def test_not_mentioning_the_chain_leaves_it_alone(client, make_user, auth_header):
    """A rename must not wipe the chain — `exclude_unset` is doing real work."""
    user = await make_user("packs4@x.com", Role.SUPER_ADMIN.value)
    h = auth_header(user)
    created = (
        await client.post(
            "/inventory/items",
            headers=h,
            json={"name": "Black Pepper", "unit": "g", "pack_levels": PEPPER},
        )
    ).json()

    renamed = await client.patch(
        f"/inventory/items/{created['id']}", headers=h, json={"name": "Pepper, black"}
    )
    assert renamed.status_code == 200, renamed.text
    assert len(renamed.json()["pack_levels"]) == 3


@pytest.mark.asyncio
async def test_sending_an_empty_list_clears_it(client, make_user, auth_header):
    """The other half of the same rule: [] is a deliberate "no packs"."""
    user = await make_user("packs5@x.com", Role.SUPER_ADMIN.value)
    h = auth_header(user)
    created = (
        await client.post(
            "/inventory/items",
            headers=h,
            json={"name": "Black Pepper", "unit": "g", "pack_levels": PEPPER},
        )
    ).json()

    cleared = await client.patch(
        f"/inventory/items/{created['id']}", headers=h, json={"pack_levels": []}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["pack_levels"] == []


@pytest.mark.asyncio
async def test_a_zero_rung_is_refused(client, make_user, auth_header):
    """A rung of zero would silently zero everything above it."""
    user = await make_user("packs6@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/inventory/items",
        headers=auth_header(user),
        json={
            "name": "Broken",
            "unit": "g",
            "pack_levels": [{"name": "packet", "contains": "0"}],
        },
    )
    assert r.status_code == 422
