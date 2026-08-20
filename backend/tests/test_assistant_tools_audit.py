"""What the assistant is actually handed, section by section.

The audit that prompted this file found a tool returning a confident, fluent,
WRONG answer while every status check stayed green (see
`test_assistant_suppliers`). So these tests do not check that a tool runs —
they check the shape and truth of what it hands the model, because that payload
is the entire basis of the reply a restaurant owner then trusts.

The permission cases are here for the same reason. A chef asking about payroll
must be refused by the TOOL, not by a sentence in the prompt asking nicely.
"""

from decimal import Decimal

import pytest

from app.assistant.tools import low_stock, money_snapshot, search_items
from app.inventory import service as inv


async def _pantry(db, hotel_id):
    """One item safely stocked, one under its line, one with no line at all."""
    await inv.create_item(
        db, hotel_id, name="Basmati Rice", unit="kg",
        current_stock=Decimal("40"), min_stock_level=Decimal("10"),
    )
    await inv.create_item(
        db, hotel_id, name="Red Onion", unit="kg",
        current_stock=Decimal("2"), min_stock_level=Decimal("15"),
    )
    await inv.create_item(
        db, hotel_id, name="Star Anise", unit="g", current_stock=Decimal("0"),
    )


@pytest.mark.asyncio
async def test_low_stock_lists_only_what_is_actually_low(db, hotel, make_user):
    """Star Anise is at zero but has no reorder level, so nobody has said what
    'low' means for it. Guessing would put noise on the buying list."""
    await _pantry(db, hotel.id)
    owner = await make_user("o1@x.com", "SUPER_ADMIN")

    out = await low_stock(db, owner, {})

    assert [r["name"] for r in out["items"]] == ["Red Onion"]
    assert out["low_stock_count"] == 1


@pytest.mark.asyncio
async def test_low_stock_offers_the_page_that_fixes_it(db, hotel, make_user):
    """"Your suggestions should mean ONE TAP." A low-stock list with no way to
    order is a chore, not an answer."""
    await _pantry(db, hotel.id)
    owner = await make_user("o2@x.com", "SUPER_ADMIN")

    out = await low_stock(db, owner, {})

    assert any(a["href"] == "/purchasing" for a in out["actions"])


@pytest.mark.asyncio
async def test_a_partial_name_finds_the_item(db, hotel, make_user):
    await _pantry(db, hotel.id)
    owner = await make_user("o3@x.com", "SUPER_ADMIN")

    out = await search_items(db, owner, {"query": "onio"})

    assert [m["name"] for m in out["matches"]] == ["Red Onion"]
    assert out["matches"][0]["is_low"] is True


@pytest.mark.asyncio
async def test_a_miss_says_so_instead_of_returning_the_whole_pantry(db, hotel, make_user):
    """The dangerous failure is not an empty list — it is a full one. Handing
    back every item for an unmatched query invites the model to pick one."""
    await _pantry(db, hotel.id)
    owner = await make_user("o4@x.com", "SUPER_ADMIN")

    out = await search_items(db, owner, {"query": "wagyu"})

    assert out["matches"] == []
    assert "wagyu" in out["note"]


@pytest.mark.asyncio
async def test_the_kitchen_is_never_handed_the_money(db, hotel, make_user):
    """A chef asking "how are we doing" must be refused by the tool. The reply
    can be warm; the payload must be empty."""
    chef = await make_user("chef2@x.com", "KITCHEN_MANAGER")

    out = await money_snapshot(db, chef, {})

    assert "error" in out
    assert not any(k.endswith("sales") or k.endswith("profit") for k in out)


@pytest.mark.asyncio
async def test_a_waiter_cannot_read_the_stock_room(db, hotel, make_user):
    await _pantry(db, hotel.id)
    waiter = await make_user("staff2@x.com", "STAFF")

    assert "error" in await low_stock(db, waiter, {})
    assert "error" in await search_items(db, waiter, {"query": "rice"})
