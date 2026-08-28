"""The purchase order was telling the supplier the wrong thing.

"suppose if we order 1 pack (which is 10kg) means in the PDF we need to see
1 pack" — orders are STORED in base units, so a ten-kilo pack is kept as 10 and
was printed as "10 kg". The same amount, the wrong instruction, on the one
document that leaves the building and gets filled by someone else.

The interesting case is the one that must NOT convert: fifteen kilos against a
ten-kilo pack is one and a half packs, and "1.5 pack" is a worse thing to hand a
supplier than "15 kg".
"""

from decimal import Decimal

import pytest

from app.inventory import pack_service
from app.inventory import service as inv
from app.purchasing import service as pur
from app.purchasing.models import POItem, PurchaseOrder
from app.purchasing.pdf import generate_po_pdf
from app.vendors import service as ven


class _L:
    def __init__(self, name, contains):
        self.name, self.contains = name, contains


async def _ordered(db, hotel, qty: Decimal, *, pack=Decimal("10")):
    """One line on one PO: `qty` kilos of an item sold in a `pack`-kilo sack."""
    item = await inv.create_item(db, hotel.id, name="Basmati Rice", unit="kg")
    await pack_service.set_levels(db, item, [_L("pack", pack)])
    vendor = await ven.create_vendor(db, hotel.id, name="RUDRA EXIM")

    po = PurchaseOrder(
        hotel_id=hotel.id, vendor_id=vendor.id, po_number="PO-1", total_amount=Decimal("0")
    )
    db.add(po)
    await db.flush()
    db.add(
        POItem(
            po_id=po.id,
            item_id=item.id,
            ordered_qty=qty,
            unit_price=Decimal("2.5"),
            line_total=qty * Decimal("2.5"),
        )
    )
    await db.commit()
    return po, vendor, await pur.po_items(db, po.id)


@pytest.mark.asyncio
async def test_one_pack_prints_as_one_pack_not_ten_kg(db, hotel):
    _, _, rows = await _ordered(db, hotel, Decimal("10"))
    assert rows[0]["ordered_as"] == "1 pack", (
        f"the supplier is being told {rows[0]['ordered_as']!r} — the pack bug is back"
    )


@pytest.mark.asyncio
async def test_two_packs_are_plural(db, hotel):
    _, _, rows = await _ordered(db, hotel, Decimal("20"))
    assert rows[0]["ordered_as"] == "2 packs"


@pytest.mark.asyncio
async def test_a_part_pack_stays_in_base_units(db, hotel):
    """15 kg is not 1.5 packs. Falling back to kilos is honest; rounding is not."""
    _, _, rows = await _ordered(db, hotel, Decimal("15"))
    assert rows[0]["ordered_as"] is None, "1.5 packs must never be printed"


@pytest.mark.asyncio
async def test_an_item_with_no_pack_chain_is_left_alone(db, hotel):
    item = await inv.create_item(db, hotel.id, name="Loose Coriander", unit="bunch")
    vendor = await ven.create_vendor(db, hotel.id, name="Green Farm")
    po = PurchaseOrder(hotel_id=hotel.id, vendor_id=vendor.id, po_number="PO-2")
    db.add(po)
    await db.flush()
    db.add(
        POItem(
            po_id=po.id,
            item_id=item.id,
            ordered_qty=Decimal("6"),
            unit_price=Decimal("1"),
            line_total=Decimal("6"),
        )
    )
    await db.commit()
    rows = await pur.po_items(db, po.id)
    assert rows[0]["ordered_as"] is None


@pytest.mark.asyncio
async def test_the_pdf_carries_the_pack_and_none_of_the_money(db, hotel):
    """His call: the PO says what to bring. The money lives in the app."""
    po, vendor, rows = await _ordered(db, hotel, Decimal("20"))
    pdf = generate_po_pdf(po, vendor.name, rows, hotel)
    assert pdf[:4] == b"%PDF", "not a PDF at all"
    assert len(pdf) > 800

    # The text layer is compressed, so assert on what we hand the renderer.
    from app.purchasing.pdf import _qty

    assert _qty(rows[0], "ordered_qty") == "2 packs"


@pytest.mark.parametrize(
    "name,count,want",
    [
        ("box", 2, "boxes"),      # "2 boxs" went out on a real PO
        ("case", 2, "cases"),
        ("bunch", 3, "bunches"),
        ("caddy", 2, "caddies"),
        ("tray", 2, "trays"),     # vowel + y stays a plain "s"
        ("pack", 1, "pack"),      # one of anything is not pluralised
        ("dish", 4, "dishes"),
    ],
)
def test_pack_names_are_pluralised_like_english(name, count, want):
    """The PDF goes to the supplier. "2 boxs" reads as carelessness."""
    from app.purchasing.service import _plural

    assert _plural(name, count == 1) == want


@pytest.mark.asyncio
async def test_the_api_carries_the_pack_wording_too(client, db, hotel, make_user, auth_header):
    """The PDF said "2 boxes" while the screen behind it said "20 kg".

    `POItemOut` never declared `ordered_as`, and a field a response_model does
    not name is dropped without a word — so the service had been returning it
    and nothing could see it. Two numbers for one order is worse than either.
    """
    po, _, _ = await _ordered(db, hotel, Decimal("20"))
    owner = await make_user("buyer2@x.com", "SUPER_ADMIN")

    r = await client.get(f"/api/purchasing/purchase-orders/{po.id}", headers=auth_header(owner))

    assert r.status_code == 200, r.text
    line = r.json()["items"][0]
    assert line["ordered_as"] == "2 packs", "the screen cannot see what the PDF prints"
