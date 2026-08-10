"""The pack chain maths, using his own pepper example.

Stock, cost and the whole price comparison sit on these functions, so they are
tested directly rather than through an endpoint.
"""

from decimal import Decimal

import pytest

from app.inventory.packs import (
    Level,
    base_size,
    describe,
    from_base,
    legacy_levels,
    price_per_base,
    to_base,
)

# "1 box of pepper, it will have 10 small box, each box will have 30 packets of
#  50g small small packets"
PEPPER = [
    Level(position=1, name="packet", contains=Decimal("50")),
    Level(position=2, name="small box", contains=Decimal("30")),
    Level(position=3, name="box", contains=Decimal("10")),
]


def test_his_pepper_example_resolves():
    assert base_size(PEPPER, 0) == Decimal("1.000")        # a gram is a gram
    assert base_size(PEPPER, 1) == Decimal("50.000")       # a packet
    assert base_size(PEPPER, 2) == Decimal("1500.000")     # 30 packets
    assert base_size(PEPPER, 3) == Decimal("15000.000")    # 10 small boxes = 15 kg


def test_ordering_thirty_packets_converts():
    """"he need only 30 small packets only, need to autocalculate" """
    assert to_base(30, PEPPER, 1) == Decimal("1500.000")   # 1.5 kg
    assert to_base(2, PEPPER, 3) == Decimal("30000.000")   # two boxes = 30 kg
    assert to_base("1.5", PEPPER, 2) == Decimal("2250.000")


def test_showing_stock_back_in_packs():
    assert from_base(1500, PEPPER, 1) == Decimal("30.000")
    assert from_base(15000, PEPPER, 3) == Decimal("1.000")
    assert from_base(0, PEPPER, 2) == Decimal("0.000")


def test_two_vendors_selling_different_shapes_become_comparable():
    """The reason the chain exists at all.

    Farm2Land sells a box for £120. SK sells packets at 45p. Before this, both
    had to be recorded as a price "per unit" and the comparison was nonsense.
    """
    farm2land = price_per_base(Decimal("120.00"), PEPPER, 3)   # per gram
    sk = price_per_base(Decimal("0.45"), PEPPER, 1)            # per gram

    assert farm2land == Decimal("0.0080")
    assert sk == Decimal("0.0090")
    assert farm2land < sk  # the box really is cheaper per gram


def test_price_per_base_of_a_base_unit_price_is_itself():
    assert price_per_base(Decimal("2.50"), PEPPER, 0) == Decimal("2.5000")


def test_no_chain_at_all_behaves():
    """Loose tomatoes: counted in pieces, bought in pieces."""
    assert base_size([], 0) == Decimal("1")
    assert base_size([], 3) == Decimal("1.000")
    assert to_base(7, [], 0) == Decimal("7.000")


def test_old_two_column_items_still_work():
    """`1 box = 5 kg` from before the chain existed, read as one rung."""
    levels = legacy_levels("box", Decimal("5"))
    assert base_size(levels, 1) == Decimal("5.000")
    assert to_base(3, levels, 1) == Decimal("15.000")
    assert legacy_levels(None, Decimal("5")) == []
    assert legacy_levels("box", Decimal("0")) == []


@pytest.mark.parametrize("bad", [Decimal("0"), Decimal("-4")])
def test_a_zero_or_negative_rung_is_dropped_not_trusted(bad):
    """A rung of zero would silently zero the value of everything above it."""
    broken = [
        Level(position=1, name="packet", contains=Decimal("50")),
        Level(position=2, name="small box", contains=bad),
    ]
    assert base_size(broken, 2) == Decimal("50.000")


def test_the_sentence_a_layman_reads():
    lines = describe(PEPPER, "g")
    assert lines[0] == "1 box = 10 small box = 300 packet = 15000 g"
    assert lines[1] == "1 small box = 30 packet = 1500 g"
    assert lines[2] == "1 packet = 50 g"


def test_describe_is_empty_without_a_chain():
    assert describe([], "kg") == []
