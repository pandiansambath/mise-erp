"""The same ingredient under a different name.

Spelling similarity cannot reach these. "Cottage cheese" and "paneer" share
almost no letters — his example, and the reason the layer exists.

An Indian-British kitchen hits this constantly: one supplier writes the Indian
name, another the British one, and they are the same sack of the same thing.
"""
import pytest

from app.inventory import matching


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("cottage cheese", "Paneer"),
        ("Brinjal", "aubergine"),
        ("eggplant", "Brinjal"),
        ("cilantro", "Coriander"),
        ("Bhindi", "okra"),
        ("ladies finger", "Okra"),
        ("prawns", "Shrimp"),
        ("besan", "Gram Flour"),
        ("curd", "Yoghurt"),
        ("maida", "Plain Flour"),
        ("courgette", "Zucchini"),
    ],
)
def test_the_same_ingredient_is_recognised_across_names(a: str, b: str) -> None:
    assert matching.same_ingredient(a, b)


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("paneer", "cheddar"),        # both cheese, NOT interchangeable
        ("coriander", "cumin"),       # both spices, different plants
        ("okra", "onion"),
        ("tomato", "potato"),
        ("chickpeas", "lentils"),     # adjacent, and a chef would object
    ],
)
def test_merely_related_things_are_not_treated_as_equal(a: str, b: str) -> None:
    """The dangerous direction.

    Being too generous here is worse than being too strict: a price landing on
    cheddar because somebody wrote paneer is silently wrong for ever, and the
    strict version only costs one extra tap.
    """
    assert not matching.same_ingredient(a, b)


def test_it_reads_through_the_same_normalisation_as_everything_else() -> None:
    """Casing, spacing and punctuation must not defeat it."""
    assert matching.same_ingredient("  COTTAGE   CHEESE ", "paneer")
    assert matching.same_ingredient("Lady-Finger", "bhindi")


def test_a_synonym_is_offered_but_never_assumed(monkeypatch) -> None:
    """Paneer and cottage cheese are near-equivalents, not identicals — paneer
    does not melt, cottage cheese is wetter — and a kitchen may stock both. So
    the layer proposes and a human still decides."""
    # Documented by the score the resolver assigns: high enough to sort first,
    # and returned under a status that forbids acting without confirmation.
    assert matching.MatchResult(status="unsure").certain is False
