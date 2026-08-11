"""A purchase order for one lemon must not cost the price of a bottle of thirty.

He found this on the Inventory screen — leomon3 showing an average cost of
£30.00 for something that costs £1 — and was right that it was not a display
problem:

    "not only here its reflecting all place like expense, pnl etcetc all the
     area its wrongly showing we need solve"

The shape of it: an indent line's `required_qty` is in BASE units (1 piece),
while a supplier's `price_per_unit` is for whatever size THEY sell (£30 a
bottle). Multiplying one by the other made a £30 purchase order for a single
lemon. Receiving it wrote £30 as the unit cost, which became the item's average
cost, which is what values stock, posts the expense and feeds the P&L. One
missing division, four wrong numbers.

The same mistake was in recipe costing, so a dish using one lemon was costed at
a bottle. Both go through `pack_service.per_base_prices` now.
"""

from decimal import Decimal

import pytest

from app.inventory import pack_service
from app.inventory import service as inv
from app.purchasing import service as purch
from app.vendors import service as ven


class _L:
    def __init__(self, name, contains):
        self.name, self.contains = name, contains


async def _lemons_by_the_bottle(db, hotel_id):
    """His data: a lemon is a piece; Farm2Land sells bottles of thirty for £30."""
    item = await inv.create_item(db, hotel_id, name="leomon3", unit="piece")
    await pack_service.set_levels(db, item, [_L("bottle", Decimal("30"))])
    rows = (await pack_service.levels_for(db, [item.id]))[item.id]
    bottle = next(r for r in rows if r.name == "bottle")

    farm = await ven.create_vendor(db, hotel_id, name="Farm2Land")
    await ven.upsert_vendor_item(
        db, farm.id, item.id, Decimal("30.00"), pack_level_id=bottle.id
    )
    return item, farm, bottle


@pytest.mark.asyncio
async def test_one_lemon_costs_one_pound_not_thirty(db, hotel):
    item, farm, _ = await _lemons_by_the_bottle(db, hotel.id)

    indent = await purch.create_indent(
        db, hotel.id, [{"item_id": item.id, "required_qty": Decimal("1")}]
    )
    out = await purch.generate_pos(db, indent)
    po = out["purchase_orders"][0]
    # £30 a bottle of thirty is £1 a piece. One piece is £1.
    assert Decimal(po.total_amount) == Decimal("1.00")


@pytest.mark.asyncio
async def test_a_whole_bottle_still_costs_thirty(db, hotel):
    """The division must not make packs cheap — thirty pieces is still £30."""
    item, _, _ = await _lemons_by_the_bottle(db, hotel.id)

    indent = await purch.create_indent(
        db, hotel.id, [{"item_id": item.id, "required_qty": Decimal("30")}]
    )
    out = await purch.generate_pos(db, indent)
    po = out["purchase_orders"][0]
    assert Decimal(po.total_amount) == Decimal("30.00")


@pytest.mark.asyncio
async def test_a_price_with_no_pack_is_unchanged(db, hotel):
    """Every price recorded before the chain existed meant "per base unit"."""
    rice = await inv.create_item(db, hotel.id, name="Rice", unit="kg")
    a = await ven.create_vendor(db, hotel.id, name="A")
    await ven.upsert_vendor_item(db, a.id, rice.id, Decimal("5.00"))

    indent = await purch.create_indent(
        db, hotel.id, [{"item_id": rice.id, "required_qty": Decimal("3")}]
    )
    out = await purch.generate_pos(db, indent)
    po = out["purchase_orders"][0]
    assert Decimal(po.total_amount) == Decimal("15.00")


@pytest.mark.asyncio
async def test_cheapest_supplier_is_cheapest_per_piece(db, hotel):
    """A £30 bottle of thirty beats a £3 single, even though 30 > 3.

    The resolver used to order by the raw quote, so it picked the supplier with
    the smaller NUMBER rather than the better price.
    """
    item, farm, _ = await _lemons_by_the_bottle(db, hotel.id)
    pricey = await ven.create_vendor(db, hotel.id, name="Pricey")
    await ven.upsert_vendor_item(db, pricey.id, item.id, Decimal("3.00"))

    indent = await purch.create_indent(
        db, hotel.id, [{"item_id": item.id, "required_qty": Decimal("1")}]
    )
    out = await purch.generate_pos(db, indent)
    po = out["purchase_orders"][0]
    assert po.vendor_id == farm.id
    assert Decimal(po.total_amount) == Decimal("1.00")
