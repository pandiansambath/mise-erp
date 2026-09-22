"""His stock file must import as stock, and never as suppliers.

    "i used thsi csv file..here whenever i upload the csv it added to
     supplier..again if uoload it saying like it arelady added but i thought
     it will add in inventory items...its really confusing bro"

The file:

    Item Name,Category,Unit,Quantity,Unit Cost,Supplier
    Rice,Grains,kg,25,60,Local Supplier

The inventory spec did not accept "Item Name" as a spelling of "Name", so it
failed to match. The page then tried the next list, and VENDORS matched —
because a supplier list legitimately calls its name column "Supplier". So his
stock became five suppliers named after the supplier column, each filed under
the item's category. Nothing on screen said which section it had gone to.

Two things are asserted here, and the second matters more than the first:
the file now reads as stock, AND a file that still does not match can be
MAPPED BY HAND rather than silently matching something else.
"""
from app.core import lists
from app.core.template_io import inspect_upload, parse_upload

HIS_FILE = b"""Item Name,Category,Unit,Quantity,Unit Cost,Supplier
Rice,Grains,kg,25,60,Local Supplier
Chicken,B meat,kg,10,220,Fresh Foods
Tomato,Vegetables,kg,8,45,Local Market
Onion,Vegetables,kg,10,35,Local Market
Cooking Oil,Oil,liter,15,140,Wholesale Supplier
"""


def _parse(spec, data=HIS_FILE, **kw):
    return parse_upload(data, "stock.csv", "text/csv", spec.template(), **kw)


def test_his_stock_file_reads_as_stock():
    rows, errors = _parse(lists.ITEMS)
    assert errors == []
    assert len(rows) == 5
    assert rows[0]["name"] == "Rice"
    assert rows[0]["unit"] == "kg"
    assert rows[0]["current_stock"] == 25
    assert rows[0]["supplier"] == "Local Supplier"


def test_the_names_are_the_items_not_the_suppliers():
    """THE ACTUAL BUG. Five rows arrived, and every name was a supplier."""
    rows, _ = _parse(lists.ITEMS)
    names = [r["name"] for r in rows]
    assert names == ["Rice", "Chicken", "Tomato", "Onion", "Cooking Oil"]
    assert "Local Supplier" not in names


def test_item_name_is_an_accepted_spelling():
    """It is what his file said, and what most stock sheets say."""
    rows, errors = _parse(lists.ITEMS, b"Item Name,Unit\nRice,kg\n")
    assert errors == [] and rows[0]["name"] == "Rice"


def test_a_file_nothing_recognises_is_a_question_not_a_dead_end():
    """Before the mapping screen this was either an error or, worse, a match
    against a different list."""
    odd = b"Widget,Lot,How much,Where from\nRice,kg,25,Local Supplier\n"
    info = inspect_upload(odd, "odd.csv", "text/csv", lists.ITEMS.template())

    assert info["readable"] is True
    assert info["headers"] == ["Widget", "Lot", "How much", "Where from"]
    # The first data row travels with the headers so a person maps what they
    # can SEE, rather than a word they have to remember the meaning of.
    assert info["sample"] == ["Rice", "kg", "25", "Local Supplier"]
    assert "Name" in info["missing"] and "Unit" in info["missing"]


def test_a_confirmed_mapping_beats_the_guess():
    odd = b"Widget,Lot,How much,Where from\nRice,kg,25,Local Supplier\nDal,kg,12,Fresh Foods\n"
    rows, errors = parse_upload(
        odd, "odd.csv", "text/csv", lists.ITEMS.template(),
        mapping={"name": 0, "unit": 1, "current_stock": 2, "supplier": 3},
    )
    assert errors == []
    assert [r["name"] for r in rows] == ["Rice", "Dal"]
    assert rows[0]["supplier"] == "Local Supplier"


def test_a_mapping_cannot_invent_fields():
    """It is client input. Keys outside the spec are dropped, not trusted."""
    rows, _ = parse_upload(
        HIS_FILE, "stock.csv", "text/csv", lists.ITEMS.template(),
        mapping={"name": 0, "unit": 2, "hotel_id": 1, "id": 3},
    )
    assert rows and "hotel_id" not in rows[0] and "id" not in rows[0]


def test_rubbish_in_the_mapping_falls_back_to_the_guess():
    """The worst case must be where we already were, not a failed upload."""
    rows, errors = parse_upload(
        HIS_FILE, "stock.csv", "text/csv", lists.ITEMS.template(),
        mapping={"name": "not-a-number"},
    )
    assert errors == [] and rows[0]["name"] == "Rice"


def test_supplier_is_still_a_supplier_name_on_the_vendor_list():
    """The vendors spec is not wrong to accept "Supplier" — a supplier list
    calls its name column that. What was wrong was GUESSING which list a file
    was. Section by section, the answer is already known."""
    rows, errors = _parse(lists.VENDORS, b"Supplier,Phone\nFresh Foods,07700900111\n")
    assert errors == [] and rows[0]["name"] == "Fresh Foods"


# ── one restaurant cannot see another's rows ──────────────────────────────
#
#     "i uploaeded vendor list but it sayibg 1 vendor is already there but
#      this is fresh account i guess its analysing gloablly inseated of hotel
#      speicfic"
#
# It is hotel-specific, and this proves it rather than asserting it. The
# duplicate check runs against whatever list the ROUTER passes in, and every
# router passes `user.hotel_id`; `classify` itself has no database access at
# all, so there is nowhere for another restaurant's rows to enter.
#
# (What he actually hit: his account already had four suppliers from an
# earlier step, and one name in the new file matched one of them.)

def test_a_duplicate_is_only_a_duplicate_within_your_own_list():
    from app.core.list_io import classify

    class V:
        def __init__(self, name):
            self.name = name
            self.category = self.contact_person = self.mobile = None
            self.email = self.address = self.vat_number = None

    mine = [V("Fresh Foods")]
    rows = [{"name": "Fresh Foods"}, {"name": "Local Market"}]

    plan = classify(rows, lists.VENDORS, mine)
    assert [r.verdict for r in plan.rows] == ["duplicate", "new"]

    # The same file against a restaurant that holds nothing: everything new.
    fresh = classify(rows, lists.VENDORS, [])
    assert [r.verdict for r in fresh.rows] == ["new", "new"]
    assert fresh.as_dict()["counts"]["duplicates"] == 0
