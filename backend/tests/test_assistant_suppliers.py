"""The assistant said "no suppliers have been linked" about items with five.

`item_detail` read `cmp["vendors"]` from a payload whose key is `comparisons`,
so the supplier list was ALWAYS empty and the model, told only that, dutifully
explained how to add supplier prices that were already there. Nothing raised,
nothing logged, and the answer read as helpful — which is why it survived.

The second half matters as much: what the tool hands over is the price per BASE
unit. One supplier's £50 is a 5kg box and another's is 100kg, so passing the
quoted prices to a model that will happily rank them is how you get told the
dearest supplier is the cheapest.
"""

from decimal import Decimal

import pytest

from app.assistant.tools import item_detail
from app.inventory import pack_service
from app.inventory import service as inv
from app.vendors import service as ven


async def _guava_from_two_suppliers(db, hotel_id):
    """Same money, wildly different boxes — the case the UI exists to catch."""
    item = await inv.create_item(db, hotel_id, name="Guava", unit="kg")

    class _L:
        def __init__(self, name, contains):
            self.name, self.contains = name, contains

    await pack_service.set_levels(db, item, [_L("box", Decimal("5"))])
    box = (await pack_service.levels_for(db, [item.id]))[item.id][0]

    exotic = await ven.create_vendor(db, hotel_id, name="Exotic Fruits")
    rudra = await ven.create_vendor(db, hotel_id, name="Rudra Exim")
    # £50 for a 5kg box = £10/kg.
    await ven.upsert_vendor_item(db, exotic.id, item.id, Decimal("50"), pack_level_id=box.id)
    # £50 too — but THIS supplier's box is 100kg, so 50p/kg.
    await ven.upsert_vendor_item(
        db,
        rudra.id,
        item.id,
        Decimal("50"),
        pack_level_id=box.id,
        pack_size_override=Decimal("100"),
    )
    return item


@pytest.mark.asyncio
async def test_the_assistant_can_see_the_suppliers(db, hotel, make_user):
    await _guava_from_two_suppliers(db, hotel.id)
    owner = await make_user("owner@x.com", "SUPER_ADMIN")

    out = await item_detail(db, owner, {"name": "Guava"})

    names = {s["vendor"] for s in out["suppliers"]}
    assert names == {"Exotic Fruits", "Rudra Exim"}, "the empty list bug is back"


@pytest.mark.asyncio
async def test_the_price_it_reports_is_per_kg_not_per_box(db, hotel, make_user):
    await _guava_from_two_suppliers(db, hotel.id)
    owner = await make_user("owner2@x.com", "SUPER_ADMIN")

    out = await item_detail(db, owner, {"name": "Guava"})
    by_vendor = {s["vendor"]: s for s in out["suppliers"]}

    def per_kg(vendor: str) -> Decimal:
        shown = by_vendor[vendor]["price_per_unit"]
        assert shown.endswith(" per kg"), shown
        return Decimal(shown.removesuffix(" per kg"))

    # Both quote £50. Only the per-kg figure tells them apart.
    assert per_kg("Exotic Fruits") == Decimal("10")
    assert per_kg("Rudra Exim") == Decimal("0.5")
    # And the quote is still shown, so it can be checked against a real bill.
    assert "box" in by_vendor["Rudra Exim"]["quoted"]


@pytest.mark.asyncio
async def test_a_chef_without_vendor_access_sees_no_prices(db, hotel, make_user):
    """Supplier pricing is not the kitchen's to see; the item still resolves."""
    await _guava_from_two_suppliers(db, hotel.id)
    chef = await make_user("chef@x.com", "KITCHEN_MANAGER")

    out = await item_detail(db, chef, {"name": "Guava"})

    assert out["name"] == "Guava"
    assert out["suppliers"] == []


@pytest.mark.asyncio
async def test_a_near_miss_still_finds_the_item(db, hotel, make_user):
    """"Look for near matches. A supplier writing 'Tomatos' is normal, not an
    error." Exact-match-or-nothing is how an assistant dead-ends on a typo."""
    await _guava_from_two_suppliers(db, hotel.id)
    owner = await make_user("owner3@x.com", "SUPER_ADMIN")

    out = await item_detail(db, owner, {"name": "guav"})

    assert out["name"] == "Guava"


@pytest.mark.asyncio
async def test_an_item_we_do_not_stock_says_so_plainly(db, hotel, make_user):
    """No stock item, no invented one. The model must be told the truth so it
    can offer to add it rather than describing one that does not exist."""
    owner = await make_user("owner4@x.com", "SUPER_ADMIN")

    out = await item_detail(db, owner, {"name": "Dragon Fruit"})

    assert "No stock item" in out["note"]
    assert "suppliers" not in out


@pytest.mark.asyncio
async def test_it_asks_which_item_rather_than_guessing(db, hotel, make_user):
    owner = await make_user("owner5@x.com", "SUPER_ADMIN")

    assert await item_detail(db, owner, {}) == {"error": "Which item?"}


@pytest.mark.asyncio
async def test_the_chosen_supplier_is_flagged(db, hotel, make_user):
    """The star matters: it is the price every recipe cost is built on, so the
    assistant has to know which of the five is actually being bought."""
    item = await _guava_from_two_suppliers(db, hotel.id)
    vendors = await ven.list_vendors(db, hotel.id)
    rudra = next(v for v in vendors if v.name == "Rudra Exim")
    await ven.upsert_vendor_item(db, rudra.id, item.id, Decimal("50"), is_preferred=True)
    owner = await make_user("owner6@x.com", "SUPER_ADMIN")

    out = await item_detail(db, owner, {"name": "Guava"})

    chosen = [s["vendor"] for s in out["suppliers"] if s["chosen"]]
    assert chosen == ["Rudra Exim"]
