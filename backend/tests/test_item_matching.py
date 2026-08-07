"""Matching a supplier's wording to our own items (#6).

Worth testing carefully because the failure mode is silent and expensive: a
wrong match attaches a price to the wrong ingredient, and every recipe using it
is costed wrong from then on. Nobody notices until the margins look strange.
"""
import pytest

from app.vendors import matching


def test_normalise_folds_what_never_matters() -> None:
    """Case, punctuation and spacing are never a real difference in a name."""
    assert matching.normalise("  Tomato  ") == "tomato"
    assert matching.normalise("Bell-Pepper (Red)") == "bell pepper red"
    assert matching.normalise("OLIVE   OIL") == "olive oil"


def test_normalise_survives_junk() -> None:
    assert matching.normalise("") == ""
    assert matching.normalise("!!!") == ""


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("tomato", "tomatos"),   # the exact case he hit
        ("tomato", "tomatoes"),
        ("olive oil", "oliveoil"),
        ("bell pepper", "bell peper"),
    ],
)
def test_close_wordings_score_above_the_floor(a: str, b: str) -> None:
    """These are the same ingredient and must be offered as candidates."""
    assert matching._ratio(a, b) >= matching.FUZZY_FLOOR


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("tomato", "potato"),      # one letter apart and NOT the same thing
        ("chicken", "chickpeas"),
        ("salt", "sultanas"),
    ],
)
def test_different_ingredients_are_not_confidently_matched(a: str, b: str) -> None:
    """The dangerous direction.

    A near-miss that scores above FUZZY_SURE would be attached WITHOUT anyone
    confirming it — tomato priced as potato, silently. These must stay below
    that line so a person is asked.
    """
    assert matching._ratio(a, b) < matching.FUZZY_SURE


async def test_an_exact_name_matches_whatever_the_casing(db, hotel) -> None:
    from app.inventory.models import Item

    db.add(Item(hotel_id=hotel.id, name="Tomato", unit="kg"))
    await db.commit()

    m = await matching.resolve(db, hotel.id, "  TOMATO ")
    assert m.how == "exact"
    assert m.name == "Tomato"


async def test_an_unknown_name_asks_rather_than_inventing(db, hotel) -> None:
    """It must never create an item.

    "Tomatos" quietly added beside "Tomato" splits one ingredient's stock over
    two rows and corrupts costing everywhere it is used — worse than the error
    it replaces, because nothing tells you.
    """
    from app.inventory.models import Item

    db.add(Item(hotel_id=hotel.id, name="Tomato", unit="kg"))
    await db.commit()

    m = await matching.resolve(db, hotel.id, "Sparkling Water 330ml")
    assert m.item_id is None
    items = (await db.execute(__import__("sqlalchemy").select(Item))).scalars().all()
    assert len(items) == 1, "resolve() must not create anything"


async def test_a_learned_alias_wins_and_ends_the_question(db, hotel) -> None:
    """The half that compounds: answered once, never asked again."""
    from app.inventory.models import Item
    from app.vendors.models import ItemAlias

    item = Item(hotel_id=hotel.id, name="Aubergine", unit="kg")
    db.add(item)
    await db.commit()
    await db.refresh(item)

    # "Brinjal" is the same vegetable and shares almost no letters — exactly
    # the case fuzzy matching cannot solve and an alias can.
    db.add(ItemAlias(hotel_id=hotel.id, item_id=item.id, alias="brinjal"))
    await db.commit()

    m = await matching.resolve(db, hotel.id, "Brinjal")
    assert m.how == "alias"
    assert m.item_id == item.id
    assert m.score == 1.0
