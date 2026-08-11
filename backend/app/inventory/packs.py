"""Turning "30 packets" into grams, and a box price into a price per gram.

Every screen that touches buying goes through here, so it is written as plain
functions over plain data — no database, no ORM — and tested directly. If this
is wrong, stock is wrong, cost is wrong and the price comparison is wrong, so
it gets to be the boring, obvious, well-covered file.

The chain, as he described it:

    base                       g
    position 1   packet        contains 50     -> 50 g
    position 2   small box     contains 30     -> 1 500 g
    position 3   box           contains 10     -> 15 000 g

Each rung stores the STEP ("a box holds ten small boxes"), not the total. A
level's size in base units is the product of every `contains` up to and
including it. Storing the step is what lets a chef enter this without doing any
arithmetic, which is the entire reason the feature exists.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# Quantities keep three decimals to match Numeric(12,3) on the columns; money
# keeps four here so a per-base price stays useful for a 50 g packet — rounding
# to pennies first would flatten every cheap ingredient to £0.00 per gram and
# make the comparison meaningless.
_Q = Decimal("0.001")
_MONEY = Decimal("0.0001")


@dataclass(frozen=True)
class Level:
    """One rung. `position` is 1-based; 1 sits directly on the base unit."""

    position: int
    name: str
    contains: Decimal


def _dec(value) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def normalise(levels: list[Level]) -> list[Level]:
    """Sorted by position, with anything unusable dropped.

    A rung containing zero or less would make a box worth nothing and silently
    zero the stock value of everything above it, so it is removed rather than
    trusted.
    """
    return sorted(
        (lv for lv in levels if _dec(lv.contains) > 0),
        key=lambda lv: lv.position,
    )


def base_size(levels: list[Level], position: int) -> Decimal:
    """How many base units are in ONE of the level at `position`.

    position 0 means the base unit itself, which is 1 of itself.
    """
    if position <= 0:
        return Decimal("1")
    size = Decimal("1")
    for lv in normalise(levels):
        if lv.position > position:
            break
        size *= _dec(lv.contains)
    return size.quantize(_Q)


def to_base(quantity, levels: list[Level], position: int) -> Decimal:
    """"30 packets" -> 1500 g. The conversion stock and recipes care about."""
    return (_dec(quantity) * base_size(levels, position)).quantize(_Q)


def from_base(quantity, levels: list[Level], position: int) -> Decimal:
    """1500 g -> "30 packets". The inverse, for showing a stock level in packs."""
    size = base_size(levels, position)
    if size <= 0:
        return Decimal("0")
    return (_dec(quantity) / size).quantize(_Q)


def price_per_base(price, levels: list[Level], position: int) -> Decimal:
    """A £120 box -> £0.008 per gram.

    This is what makes suppliers comparable at all. Before the chain, a vendor
    selling boxes and a vendor selling packets both had to record a price "per
    unit", so Price Comparison was putting a box price next to a packet price
    and calling one of them cheaper.
    """
    size = base_size(levels, position)
    if size <= 0:
        return Decimal("0")
    return (_dec(price) / size).quantize(_MONEY)


def legacy_levels(pack_unit: str | None, pack_size) -> list[Level]:
    """Read the old two-column `1 pack = N base` as a one-rung chain.

    Every item created before the chain existed keeps working, and nobody has to
    re-enter anything on the day this ships.
    """
    if not pack_unit or _dec(pack_size) <= 0:
        return []
    return [Level(position=1, name=pack_unit.strip(), contains=_dec(pack_size))]


def tidy(value: Decimal) -> str:
    """Public: other modules need this to print a size in a sentence."""
    return _tidy(value)


def _tidy(value: Decimal) -> str:
    """1500.000 -> "1500", 1.500 -> "1.5". Trailing zeros read as a bug.

    `format(..., "f")` matters: `Decimal("10.000").normalize()` is `1E+1`, so
    without it the sentence meant for a layman came out as
    "1 box = 1E+1 small box = 3E+2 packet". Scientific notation is the last
    thing this particular screen should ever produce.
    """
    return format(value.quantize(_Q).normalize(), "f")


def describe(levels: list[Level], base_unit: str) -> list[str]:
    """The plain-English echo shown under the editor, biggest first.

    "1 box = 10 small boxes = 300 packets = 15000 g"

    This is the safety net for a layman: the sentence is built from what they
    just typed, so a wrong number is visible while they are entering it rather
    than a month later in the stock value.
    """
    chain = normalise(levels)
    out: list[str] = []
    for lv in reversed(chain):
        parts = [f"1 {lv.name}"]
        below = [b for b in chain if b.position < lv.position]
        for b in reversed(below):
            n = base_size(chain, lv.position) / base_size(chain, b.position)
            parts.append(f"{_tidy(n.quantize(_Q))} {b.name}")
        parts.append(f"{_tidy(base_size(chain, lv.position))} {base_unit}")
        out.append(" = ".join(parts))
    return out
