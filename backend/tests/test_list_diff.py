"""Re-importing your own export must report NO changes.

    "add rule: whatever we export we can import and use the same"

Found on the live site, not here: a restaurant exported its 17 dishes,
re-uploaded the file untouched, and was told "17 already here but different".
Every one was flagged on the same field, and the popup showed "— vs —" for it,
so there was no way to tell what had supposedly changed. Nothing had.

TWO CAUSES, both worth their own test:

  * every kind="number" column is parsed as `float(Decimal(...))`, and
    `servings_default` is an INTEGER column — so 25 came back 25.0 and a
    string comparison called that an edit;
  * the difference was reported as a column HEADER the popup then had to
    resolve back to a key, and "Serves" never resolves to "servings_default".

These are pure functions, so they run without a database.
"""
import pytest

from app.core import lists
from app.core.list_io import classify


class Dish:
    """Stands in for the ORM row: ints where the column is Integer."""

    def __init__(self, name, category="Mains", servings_default=1,
                 selling_price=12.50, is_active=True):
        self.name = name
        self.category = category
        self.servings_default = servings_default
        self.selling_price = selling_price
        self.is_active = is_active


def _as_parsed(**over):
    """A row exactly as `parse_upload` hands it over — numbers as floats."""
    row = {
        "name": "Butter Chicken",
        "category": "Mains",
        "servings_default": 1.0,
        "selling_price": 12.50,
        "is_active": True,
    }
    row.update(over)
    return row


def test_reimporting_an_untouched_export_reports_no_change():
    """THE ACCEPTANCE TEST, in his words. This is the one that failed live."""
    plan = classify([_as_parsed()], lists.RECIPES, [Dish("Butter Chicken")])
    row = plan.rows[0]

    assert row.verdict == "duplicate"
    assert row.differences == [], f"nothing changed, but it reported {row.differences}"
    assert "identical" in (row.reason or "")


def test_an_integer_column_does_not_differ_from_its_own_float():
    """The mechanism, pinned on its own so a future number column cannot
    quietly reintroduce this. 25 -> 25.0 is a parsing artefact, not an edit."""
    plan = classify(
        [_as_parsed(servings_default=25.0)], lists.RECIPES, [Dish("Butter Chicken", servings_default=25)]
    )
    assert plan.rows[0].differences == []


def test_a_real_edit_is_still_caught():
    """The loosening must not blind the comparison — that would be worse than
    the false alarm, because an overwrite would go through unannounced."""
    plan = classify(
        [_as_parsed(servings_default=4.0, selling_price=13.95)],
        lists.RECIPES,
        [Dish("Butter Chicken", servings_default=1, selling_price=12.50)],
    )
    fields = {d["field"] for d in plan.rows[0].differences}
    assert fields == {"servings_default", "selling_price"}


def test_each_difference_carries_both_values_and_a_readable_label():
    """The popup renders these directly. It used to be handed the header alone
    and had to find the key by swapping underscores for spaces, so the one
    field it flagged displayed as an em-dash on both sides."""
    plan = classify(
        [_as_parsed(servings_default=4.0)], lists.RECIPES, [Dish("Butter Chicken", servings_default=1)]
    )
    (diff,) = plan.rows[0].differences

    assert diff["field"] == "servings_default"
    assert diff["label"] == "Serves"
    assert diff["ours"] == "1", "and NOT '1.0' — that is a parsing artefact"
    assert diff["theirs"] == "4"


def test_a_blank_cell_reads_as_a_dash_not_as_none():
    plan = classify(
        [_as_parsed(category="")], lists.RECIPES, [Dish("Butter Chicken", category="Mains")]
    )
    (diff,) = plan.rows[0].differences
    assert diff["ours"] == "Mains"
    assert diff["theirs"] == "—"


@pytest.mark.parametrize("ours,theirs", [(12.50, 12.5), (12.5, "12.50"), (0, 0.0)])
def test_numbers_that_are_equal_are_equal_however_they_are_written(ours, theirs):
    plan = classify(
        [_as_parsed(selling_price=theirs)],
        lists.RECIPES,
        [Dish("Butter Chicken", selling_price=ours)],
    )
    assert plan.rows[0].differences == []


def test_a_genuinely_new_dish_is_still_new():
    plan = classify([_as_parsed(name="Chicken 65")], lists.RECIPES, [Dish("Butter Chicken")])
    assert plan.rows[0].verdict == "new"


def test_vendors_round_trip_clean_too():
    """The list that DID pass live, asserted here so it stays passing."""

    class Vendor:
        def __init__(self):
            self.name = "Fresh Farms"
            self.category = "Produce"
            self.contact_person = "Raja"
            self.mobile = "07700900111"
            self.email = "raja@fresh.example"
            self.address = "12 Market St"
            self.vat_number = "GB123"

    parsed = {
        "name": "Fresh Farms", "category": "Produce", "contact_person": "Raja",
        "mobile": "07700900111", "email": "raja@fresh.example",
        "address": "12 Market St", "vat_number": "GB123",
    }
    plan = classify([parsed], lists.VENDORS, [Vendor()])
    assert plan.rows[0].differences == []


# ── stock: the same bug, on a field that is not a column ──────────────────
#
# Found on live immediately after the recipes fix shipped, in the list that
# had only just joined this screen. Every item with a chosen supplier was
# flagged as changed, on every re-import:
#
#     Bay Leaves   Supplier: — → ★ Exotic
#     Red Onion    Supplier: — → ★ Exotic
#
# `supplier` is not a column on Item. The exporter resolves it through
# `best_vendors` and marks the chosen one with a ★; `classify` read
# `getattr(item, "supplier", None)` and got None every time. Two different
# sources for the two sides of one comparison — the same shape as
# `servings_default`, which is why both live in this file.

STAR = "\u2605 "


class Item:
    """`supplier` is set by the router from `best_vendors`, exactly as the
    exporter does. The real ORM row has no such column."""

    def __init__(self, name="Bay Leaves", unit="kg", category="Spices",
                 current_stock=2.0, supplier=None):
        self.name = name
        self.unit = unit
        self.category = category
        self.current_stock = current_stock
        self.supplier = supplier


def _stock_row(**over):
    row = {"name": "Bay Leaves", "unit": "kg", "category": "Spices",
           "current_stock": 2.0, "supplier": STAR + "Exotic"}
    row.update(over)
    return row


def test_a_starred_supplier_matches_the_plain_one_we_hold():
    """THE REGRESSION. The export writes "★ Exotic" so a person can see which
    supplier is chosen; the comparison must not read the decoration as data."""
    plan = classify([_stock_row()], lists.ITEMS, [Item(supplier="Exotic")])
    assert plan.rows[0].differences == []


def test_a_real_supplier_change_is_still_caught():
    plan = classify(
        [_stock_row(supplier=STAR + "Farm2Land")], lists.ITEMS, [Item(supplier="Exotic")]
    )
    (diff,) = plan.rows[0].differences
    assert (diff["label"], diff["ours"], diff["theirs"]) == ("Supplier", "Exotic", "Farm2Land")


def test_no_supplier_either_side_is_not_a_change():
    plan = classify([_stock_row(supplier="")], lists.ITEMS, [Item(supplier=None)])
    assert plan.rows[0].differences == []


def test_assigning_a_supplier_to_an_item_that_had_none_is_a_change():
    plan = classify([_stock_row()], lists.ITEMS, [Item(supplier=None)])
    (diff,) = plan.rows[0].differences
    assert diff["ours"] == "—" and diff["theirs"] == "Exotic"


def test_a_whole_untouched_stock_export_comes_back_unchanged():
    """The acceptance test, for the list he actually managed to export."""
    held = [
        Item("Bay Leaves", "kg", "Spices", 2.0, "Exotic"),
        Item("Red Onion", "kg", "Vegetables", 12.0, "Exotic"),
        Item("Paneer", "kg", "Dairy", 10.0, None),
    ]
    rows = [
        _stock_row(),
        _stock_row(name="Red Onion", category="Vegetables", current_stock=12.0),
        _stock_row(name="Paneer", category="Dairy", current_stock=10.0, supplier=""),
    ]
    plan = classify(rows, lists.ITEMS, held)
    assert all(r.verdict == "duplicate" for r in plan.rows)
    assert all(r.differences == [] for r in plan.rows), [
        (r.values["name"], r.differences) for r in plan.rows if r.differences
    ]
