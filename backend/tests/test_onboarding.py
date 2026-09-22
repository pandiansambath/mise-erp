"""What a new restaurant still has to set up.

The guidance is COUNTED, never stored, and these tests are mostly about why
that matters: a progress flag can disagree with reality, rows cannot. Somebody
who imported 200 items from a spreadsheet has done the items step just as much
as somebody who typed them, and somebody who deleted everything genuinely is
back at the start.
"""
from decimal import Decimal

import pytest

from app.auth.models import Role
from app.hotels import onboarding
from app.inventory.models import Item
from app.vendors.models import Vendor


@pytest.fixture
async def owner(make_user):
    return await make_user("newowner@test.com", Role.SUPER_ADMIN.value)


async def test_a_brand_new_restaurant_has_everything_to_do(db, hotel) -> None:
    out = await onboarding.status(db, hotel.id)

    assert out["fresh"] is True
    assert out["complete"] is False
    assert out["done_count"] == 0
    # SUPPLIERS COME FIRST, and the order is the dependency order rather than
    # a preference. A stock row names its supplier, so doing stock first
    # guarantees every one of those names has nothing to match against —
    # which is the whole of the matching step he asked for.
    assert out["next_key"] == "vendors"


async def test_the_next_step_moves_on_as_work_gets_done(db, hotel) -> None:
    """One next step, not five. "You have five things to do" is paralysing."""
    db.add(Vendor(hotel_id=hotel.id, name="Fresh Farms"))
    await db.commit()

    out = await onboarding.status(db, hotel.id)
    assert out["next_key"] == "items"
    assert out["fresh"] is False
    assert next(s for s in out["steps"] if s["key"] == "vendors")["done"] is True


async def test_progress_is_counted_not_remembered(db, hotel) -> None:
    """A stored flag can be wrong. Rows cannot — so deleting the data brings
    the guidance back, which is correct: that restaurant IS at the start."""
    vendor = Vendor(hotel_id=hotel.id, name="Fresh Farms")
    db.add(vendor)
    await db.commit()
    assert (await onboarding.status(db, hotel.id))["next_key"] == "items"

    await db.delete(vendor)
    await db.commit()
    assert (await onboarding.status(db, hotel.id))["next_key"] == "vendors"


async def test_another_hotels_setup_does_not_count_as_yours(db, hotel) -> None:
    """Every count is hotel-scoped. A busy neighbour must not make an empty
    restaurant look ready."""
    from app.hotels.models import Hotel

    other = Hotel(name="Busy Place", country="GB", base_currency="GBP", city="York")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    db.add(Item(hotel_id=other.id, name="Theirs", unit="kg", current_stock=Decimal("9")))
    await db.commit()

    assert (await onboarding.status(db, hotel.id))["done_count"] == 0
    assert (await onboarding.status(db, other.id))["done_count"] == 1


async def test_every_step_names_a_page_to_open(db, hotel) -> None:
    """A step you cannot act on is a complaint, not guidance."""
    out = await onboarding.status(db, hotel.id)
    for step in out["steps"]:
        assert step["href"].startswith("/")
        assert step["why"], step["key"]
        assert step["title"]


async def test_every_step_that_offers_an_import_actually_has_one(db, hotel) -> None:
    """A step naming a list must name one with a real importer behind it.

    Otherwise "import from a file instead" opens a file chooser that leads
    nowhere, which is the most dispiriting possible outcome for a first-time
    user — and it is not hypothetical: that button spent weeks dispatching an
    event nothing listened for, and he clicked it four times.
    """
    from app.core.lists import EXPORTABLE

    out = await onboarding.status(db, hotel.id)
    offered = [s for s in out["steps"] if s["list"]]
    assert offered, "at least one step must take a file"
    for step in offered:
        assert step["list"] in EXPORTABLE, step["key"]


async def test_menu_and_recipes_are_one_step_not_two(db, hotel) -> None:
    """They are one TABLE, so two steps asked the same question twice.

        "that menu and recipe in onbaoding is confusing...u keep recipe
         alnoe..menu afterward we can import from recipe nah"

    A stepper whose fourth and fifth entries are indistinguishable leaves
    somebody wondering which one they already did — and the fifth had no
    importer behind it either, so it could only ever be hand-entry.
    """
    out = await onboarding.status(db, hotel.id)
    keys = [s["key"] for s in out["steps"]]

    assert keys == ["vendors", "items", "employees", "recipes"]
    assert "recipe_lines" not in keys
    assert out["total"] == 4


async def test_the_stock_step_knows_it_matches_against_suppliers(db, hotel) -> None:
    """This is the link that makes step 2 possible, and it is why suppliers
    come first: "match inventory items with the name in vendor"."""
    out = await onboarding.status(db, hotel.id)
    stock = next(s for s in out["steps"] if s["key"] == "items")
    assert stock["matches"] == "vendors"


async def test_the_endpoint_is_readable_by_any_signed_in_user(
    client, make_user, auth_header, hotel
) -> None:
    """A manager filling in stock is exactly who this is for, not only the
    owner."""
    staff = await make_user("staffer@test.com", Role.STAFF.value)
    res = await client.get("/api/hotels/onboarding", headers=auth_header(staff))
    assert res.status_code == 200
    assert res.json()["next_key"] == "vendors"


async def test_it_reports_complete_once_every_step_has_something(db, hotel) -> None:
    """It removes itself. A setup panel that never goes away becomes furniture."""
    from app.employees.models import Employee
    from app.recipes.models import Recipe

    db.add(Item(hotel_id=hotel.id, name="Rice", unit="kg", current_stock=Decimal("10")))
    db.add(Vendor(hotel_id=hotel.id, name="Best Foods"))
    db.add(Recipe(hotel_id=hotel.id, name="Biryani", servings_default=1))
    db.add(
        Employee(
            hotel_id=hotel.id, employee_code="E9", full_name="Test Person", salary_type="MONTHLY"
        )
    )
    await db.commit()

    # FOUR ROWS, FOUR STEPS, DONE. Sales and expenses are no longer steps —
    # they are what you do every day once you are set up, not setup — and
    # ingredient lines folded into the recipes step rather than standing as a
    # fifth one nobody could tell apart from the fourth.
    out = await onboarding.status(db, hotel.id)
    assert out["complete"] is True
    assert out["next_key"] is None
    assert out["next_key"] is None
    assert out["done_count"] == out["total"]
