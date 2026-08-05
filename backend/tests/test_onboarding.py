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
    # Stock comes first: everything downstream reads from it, and doing this
    # last produces recipes that cannot be costed.
    assert out["next_key"] == "items"


async def test_the_next_step_moves_on_as_work_gets_done(db, hotel) -> None:
    """One next step, not six. "You have six things to do" is paralysing."""
    db.add(Item(hotel_id=hotel.id, name="Tomato", unit="kg", current_stock=Decimal("4")))
    await db.commit()

    out = await onboarding.status(db, hotel.id)
    assert out["next_key"] == "vendors"
    assert out["fresh"] is False
    assert next(s for s in out["steps"] if s["key"] == "items")["done"] is True


async def test_progress_is_counted_not_remembered(db, hotel) -> None:
    """A stored flag can be wrong. Rows cannot — so deleting the data brings
    the guidance back, which is correct: that restaurant IS at the start."""
    item = Item(hotel_id=hotel.id, name="Onion", unit="kg", current_stock=Decimal("1"))
    db.add(item)
    await db.commit()
    assert (await onboarding.status(db, hotel.id))["next_key"] == "vendors"

    await db.delete(item)
    await db.commit()
    assert (await onboarding.status(db, hotel.id))["next_key"] == "items"


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


async def test_the_bulk_import_kinds_are_ones_the_assistant_understands(db, hotel) -> None:
    """The panel offers "import from a file instead" for these. Naming a kind
    the ingest pipeline does not know would open a file chooser that leads
    nowhere — the most dispiriting possible outcome for a first-time user."""
    from app.assistant.ingest import KINDS

    out = await onboarding.status(db, hotel.id)
    for step in out["steps"]:
        if step["import_kind"] is not None:
            assert step["import_kind"] in KINDS, step["key"]


async def test_the_endpoint_is_readable_by_any_signed_in_user(
    client, make_user, auth_header, hotel
) -> None:
    """A manager filling in stock is exactly who this is for, not only the
    owner."""
    staff = await make_user("staffer@test.com", Role.STAFF.value)
    res = await client.get("/api/hotels/onboarding", headers=auth_header(staff))
    assert res.status_code == 200
    assert res.json()["next_key"] == "items"


async def test_it_reports_complete_once_every_step_has_something(db, hotel) -> None:
    """It removes itself. A setup panel that never goes away becomes furniture."""
    from datetime import date

    from app.employees.models import Employee
    from app.expenses.models import Expense, ExpenseCategory
    from app.recipes.models import Recipe
    from app.sales.models import DailySales

    db.add(Item(hotel_id=hotel.id, name="Rice", unit="kg", current_stock=Decimal("10")))
    db.add(Vendor(hotel_id=hotel.id, name="Best Foods"))
    db.add(Recipe(hotel_id=hotel.id, name="Biryani", servings_default=1))
    db.add(
        Employee(
            hotel_id=hotel.id, employee_code="E9", full_name="Test Person", salary_type="MONTHLY"
        )
    )
    db.add(DailySales(hotel_id=hotel.id, date=date.today(), opening_cash=Decimal("100")))
    cat = ExpenseCategory(hotel_id=hotel.id, name="Rent", kind="FIXED")
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    db.add(
        Expense(
            hotel_id=hotel.id,
            category_id=cat.id,
            date=date.today(),
            amount=Decimal("1200"),
        )
    )
    await db.commit()

    out = await onboarding.status(db, hotel.id)
    assert out["complete"] is True
    assert out["next_key"] is None
    assert out["done_count"] == out["total"]
