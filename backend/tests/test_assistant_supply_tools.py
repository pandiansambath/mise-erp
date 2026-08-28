"""The twelve tools added so the assistant can see the supply side.

"voice model is not accessing the vendor related things... please add as much
tools as needed for vendors, suppliers, inventory, purchasing."

The failure these guard against is specific and it has bitten him repeatedly:
when a page has no tool, the model reaches for raw SQL, the SQL fails, and the
turn dies telling him it got tangled up. A tool that RAISES is indistinguishable
from a tool that does not exist — so the first thing worth asserting is that
every one of them survives both an empty hotel and a populated one, because an
empty restaurant is what a brand-new tenant is on day one.
"""

from decimal import Decimal

import pytest

from app.assistant import tools as T
from app.inventory import service as inv
from app.vendors import service as ven

# Everything added in the supply-side batch, with the least arguments the model
# would ever call them with.
READ_TOOLS = [
    ("rota_shifts", {}),
    ("attendance_summary", {}),
    ("payroll_summary", {}),
    ("purchase_orders", {}),
    ("waste_summary", {}),
    ("online_orders", {}),
    ("safety_checks", {}),
    ("indents", {}),
    ("price_changes", {}),
    ("vendor_detail", {"vendor": "RUDRA"}),
    ("price_comparison", {"item": "Guava"}),
    ("stock_history", {"item": "Guava"}),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args", READ_TOOLS)
async def test_a_new_tenant_does_not_break_any_tool(db, hotel, make_user, name, args):
    """Day one: no vendors, no stock, no rota. Nothing may raise."""
    owner = await make_user(f"empty-{name}@x.com", "SUPER_ADMIN")
    out = await T.EXECUTORS[name](db, owner, args)
    assert isinstance(out, dict), f"{name} returned {type(out).__name__}, not a dict"


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args", READ_TOOLS)
async def test_every_new_tool_is_wired_and_permissioned(db, hotel, name, args):
    """A tool in the list but missing from the registry is offered and then fails."""
    assert name in T.EXECUTORS, f"{name} is described to the model but has no executor"
    assert name in T.TOOL_PERMS, f"{name} reads hotel data with no permission gate"
    assert any(t["name"] == name for t in T.TOOLS), f"{name} exists but is never offered"


async def _guava_from_two_suppliers(db, hotel_id):
    item = await inv.create_item(db, hotel_id, name="Guava", unit="kg")
    cheap = await ven.create_vendor(db, hotel_id, name="Green Farm")
    dear = await ven.create_vendor(db, hotel_id, name="RUDRA EXIM")
    await ven.upsert_vendor_item(db, dear.id, item.id, Decimal("12"))
    await ven.upsert_vendor_item(db, cheap.id, item.id, Decimal("8"))
    return item, cheap, dear


@pytest.mark.asyncio
async def test_price_comparison_puts_the_cheapest_first(db, hotel, make_user):
    """"which vendor is cheapest for guava" — the question that had no tool."""
    await _guava_from_two_suppliers(db, hotel.id)
    owner = await make_user("owner@x.com", "SUPER_ADMIN")

    out = await T.price_comparison(db, owner, {"item": "guava"})

    assert out["cheapest"]["vendor"] == "Green Farm"
    assert [o["vendor"] for o in out["offers"]] == ["Green Farm", "RUDRA EXIM"]


@pytest.mark.asyncio
async def test_price_comparison_says_so_when_nobody_supplies_it(db, hotel, make_user):
    """It must say "nobody" rather than inventing a supplier."""
    await inv.create_item(db, hotel.id, name="Saffron", unit="g")
    owner = await make_user("owner2@x.com", "SUPER_ADMIN")

    out = await T.price_comparison(db, owner, {"item": "saffron"})

    assert out["offers"] == []
    assert out["note"], "an empty list with no note is how the model starts guessing"


@pytest.mark.asyncio
async def test_vendor_detail_returns_the_contact_and_what_they_supply(db, hotel, make_user):
    await _guava_from_two_suppliers(db, hotel.id)
    owner = await make_user("owner3@x.com", "SUPER_ADMIN")

    out = await T.vendor_detail(db, owner, {"vendor": "rudra"})

    assert out["name"] == "RUDRA EXIM"
    assert [s["item"] for s in out["supplies"]] == ["Guava"]


@pytest.mark.asyncio
async def test_an_unknown_supplier_is_an_error_not_an_empty_answer(db, hotel, make_user):
    owner = await make_user("owner4@x.com", "SUPER_ADMIN")
    out = await T.vendor_detail(db, owner, {"vendor": "nobody at all"})
    assert "error" in out


@pytest.mark.asyncio
async def test_stock_history_reports_what_is_on_hand(db, hotel, make_user):
    item, _, _ = await _guava_from_two_suppliers(db, hotel.id)
    owner = await make_user("owner5@x.com", "SUPER_ADMIN")

    out = await T.stock_history(db, owner, {"item": "guava"})

    assert out["item"] == "Guava"
    assert out["unit"] == "kg"
    assert isinstance(out["movements"], list)


@pytest.mark.asyncio
async def test_general_staff_cannot_read_supplier_prices_through_the_assistant(db, hotel, make_user):
    """The model proposes; the tool still checks. Both, or neither is real."""
    await _guava_from_two_suppliers(db, hotel.id)
    floor = await make_user("floor@x.com", "STAFF")

    out = await T.price_comparison(db, floor, {"item": "guava"})

    assert "error" in out, "general staff just read the supplier price list"
    assert "offers" not in out
