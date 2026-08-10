"""Comparing suppliers who sell different shapes.

This was a live bug, not a missing feature. `compare_vendor_prices` sorted on
`price_per_unit` — the number in the price box — with no idea what that price
buys. So a £120 box sorted below a 45p packet and got called the expensive one,
while per gram it is the cheaper of the two. The page was recommending the
wrong supplier.
"""

from decimal import Decimal

import pytest

from app.inventory import pack_service
from app.inventory import service as inv
from app.vendors import service as ven
from app.vendors.service import compare_vendor_prices


async def _pepper_with_two_shapes(db, hotel_id):
    """His example: Farm2Land sells the box, SK only sells packets."""
    item = await inv.create_item(db, hotel_id, name="Black Pepper", unit="g")

    class _L:
        def __init__(self, name, contains):
            self.name, self.contains = name, contains

    await pack_service.set_levels(
        db,
        item,
        [_L("packet", Decimal("50")), _L("small box", Decimal("30")), _L("box", Decimal("10"))],
    )
    rows = (await pack_service.levels_for(db, [item.id]))[item.id]
    packet = next(r for r in rows if r.name == "packet")
    box = next(r for r in rows if r.name == "box")

    farm = await ven.create_vendor(db, hotel_id, name="Farm2Land")
    sk = await ven.create_vendor(db, hotel_id, name="SK")
    # £120 a box (15 000 g)  vs  45p a packet (50 g)
    await ven.upsert_vendor_item(
        db, farm.id, item.id, Decimal("120.00"), pack_level_id=box.id
    )
    await ven.upsert_vendor_item(
        db, sk.id, item.id, Decimal("0.45"), pack_level_id=packet.id
    )
    return item, farm, sk


@pytest.mark.asyncio
async def test_a_box_is_not_dearer_than_a_packet(db, hotel):
    item, farm, sk = await _pepper_with_two_shapes(db, hotel.id)

    out = await compare_vendor_prices(db, item.id, hotel.id)

    # £120 / 15000 g = £0.0080   vs   £0.45 / 50 g = £0.0090
    assert out["cheapest_vendor"]["vendor_name"] == "Farm2Land"
    assert out["most_expensive_vendor"]["vendor_name"] == "SK"
    assert out["cheapest_vendor"]["price_per_base"] == Decimal("0.0080")
    assert out["most_expensive_vendor"]["price_per_base"] == Decimal("0.0090")


@pytest.mark.asyncio
async def test_the_saving_is_per_base_unit(db, hotel):
    item, _, _ = await _pepper_with_two_shapes(db, hotel.id)
    out = await compare_vendor_prices(db, item.id, hotel.id)
    assert out["potential_saving_per_unit"] == Decimal("0.0010")  # per gram


@pytest.mark.asyncio
async def test_each_row_says_what_the_price_buys(db, hotel):
    item, _, _ = await _pepper_with_two_shapes(db, hotel.id)
    out = await compare_vendor_prices(db, item.id, hotel.id)
    names = {c["vendor_name"]: c["pack_level_name"] for c in out["comparisons"]}
    assert names == {"Farm2Land": "box", "SK": "packet"}


@pytest.mark.asyncio
async def test_prices_with_no_pack_still_compare_normally(db, hotel):
    """Every price before the chain existed meant "per base unit". Unchanged."""
    rice = await inv.create_item(db, hotel.id, name="Rice", unit="kg")
    a = await ven.create_vendor(db, hotel.id, name="A")
    b = await ven.create_vendor(db, hotel.id, name="B")
    await ven.upsert_vendor_item(db, a.id, rice.id, Decimal("5.50"))
    await ven.upsert_vendor_item(db, b.id, rice.id, Decimal("5.00"))

    out = await compare_vendor_prices(db, rice.id, hotel.id)
    assert out["cheapest_vendor"]["vendor_name"] == "B"
    assert out["potential_saving_per_unit"] == Decimal("0.5000")
    assert out["comparisons"][0]["pack_level_name"] is None


@pytest.mark.asyncio
async def test_a_mixed_case_still_sorts_right(db, hotel):
    """One supplier quotes per gram, another sells a box. Both must line up."""
    item, farm, _ = await _pepper_with_two_shapes(db, hotel.id)
    loose = await ven.create_vendor(db, hotel.id, name="Loose")
    await ven.upsert_vendor_item(db, loose.id, item.id, Decimal("0.02"))  # 2p a gram

    out = await compare_vendor_prices(db, item.id, hotel.id)
    assert out["cheapest_vendor"]["vendor_name"] == "Farm2Land"   # £0.0080/g
    assert out["most_expensive_vendor"]["vendor_name"] == "Loose"  # £0.0200/g
