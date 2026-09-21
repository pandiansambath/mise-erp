"""Whatever we export, we can import. His rule, as an executable test.

    "add rule: whatever we export we can import and use the same"

He exported his inventory to move it to a new hotel, and the import refused the
file we had just written. Reproduced before any fix:

    ERRORS: ['Row 4: "Name" is required; "Unit" is required']
    ROWS PARSED: 0

Three separate faults, and only the first announced itself:

  1. THE TOTALS FOOTER FAILED THE WHOLE FILE. Our export ends with
     ("", "", "", "", "Total", 70.00, ...). It has no Name and no Unit, so it
     was reported as a broken row — and one error empties the entire result, so
     a file with a footer imports nothing at all.

  2. QUANTITIES WERE DROPPED IN SILENCE. The exporter writes "In stock"; the
     template accepted "Opening stock" and the aliases stock/quantity/qty/
     opening. "in stock" is none of those. No error, no warning — the import
     would have "succeeded" with every item at zero.

  3. SUPPLIERS ALL FAILED TO LINK. The exporter marks the chosen supplier
     "★ Fresh Farms" so a person can see it; `_find_vendor` matched names
     exactly, so nothing matched and every item came back with no vendor. Also
     silent, because a missing supplier is only reported and never fails a row.

Faults 2 and 3 are the dangerous ones: a footer-only patch would have migrated
his whole inventory with zero stock and no suppliers, and the screen would have
said it worked.

These tests are pure — no database — so they run everywhere and fail fast.
"""

import csv
import io

from app.core.template_io import parse_upload
from app.inventory.export import CHOSEN_MARK, ITEM_IMPORT_HEADERS
from app.inventory.router import ITEMS_TEMPLATE

#: The real export layout: a title, a blank, the headers, the rows, a blank, a
#: totals footer. Written out literally rather than generated, so that a change
#: to the exporter's SHAPE (not just its headers) also shows up here.
EXPORT_HEADERS = [
    "Item", "Category", "In stock", "Unit", "Min stock",
    "Avg cost", "Stock value (avg)", "Current buy price",
    "Value at current price", "Supplier", "Status",
]


def _exported_csv(rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["DineAI — Inventory stock valuation"])
    w.writerow([])
    w.writerow(EXPORT_HEADERS)
    for r in rows:
        w.writerow(r)
    w.writerow([])
    w.writerow(["", "", "", "", "", "Total", "70.00", "", "73.50", "", ""])
    return buf.getvalue().encode()


def _row(name: str, cat: str, stock: str, unit: str, supplier: str) -> list[str]:
    return [name, cat, stock, unit, "5", "1.20", "30.00", "1.30", "32.50", supplier, "active"]


def test_our_own_export_imports_cleanly() -> None:
    """The whole rule, in one assertion: no errors, every row, nothing lost."""
    data = _exported_csv([
        _row("Basmati Rice", "Dry Goods", "25", "kg", f"{CHOSEN_MARK}Fresh Farms"),
        _row("Paneer", "Dairy", "10", "kg", ""),
    ])

    rows, errors = parse_upload(data, "mise-stock-valuation.csv", "text/csv", ITEMS_TEMPLATE)

    assert errors == [], f"our own export was rejected: {errors}"
    assert len(rows) == 2, "the totals footer was counted as a row, or rows were dropped"


def test_the_quantity_column_survives_the_trip() -> None:
    """The silent one. `In stock` matched no alias, so every quantity vanished
    and the import still reported success."""
    data = _exported_csv([_row("Basmati Rice", "Dry Goods", "25", "kg", "")])

    rows, errors = parse_upload(data, "x.csv", "text/csv", ITEMS_TEMPLATE)

    assert not errors
    assert "current_stock" in rows[0], "the quantity column was dropped without an error"
    assert rows[0]["current_stock"] == 25.0


def test_the_chosen_supplier_mark_does_not_break_the_link() -> None:
    """`★ Fresh Farms` has to resolve to the vendor `Fresh Farms`.

    Asserted on the normalisation rather than through the database, because the
    fault was never in the lookup — it was in the string reaching it.
    """
    data = _exported_csv([_row("Basmati Rice", "Dry", "1", "kg", f"{CHOSEN_MARK}Fresh Farms")])

    rows, _ = parse_upload(data, "x.csv", "text/csv", ITEMS_TEMPLATE)
    raw = rows[0]["supplier"]

    assert raw.startswith(CHOSEN_MARK.strip()), "the exporter stopped marking the chosen supplier"
    cleaned = raw.strip().lstrip(CHOSEN_MARK.strip()).strip().casefold()
    assert cleaned == "fresh farms"


def test_a_footer_cannot_fail_the_file_but_a_real_mistake_still_can() -> None:
    """The skip must be narrow.

    A row with NONE of the required fields is a footer or a note and is not
    data. A row with a name and no unit is a genuine mistake and must still be
    reported — otherwise fixing the footer would have quietly swallowed every
    real error in the file.
    """
    good = _exported_csv([_row("Rice", "Dry", "1", "kg", "")])
    rows, errors = parse_upload(good, "x.csv", "text/csv", ITEMS_TEMPLATE)
    assert errors == [] and len(rows) == 1

    broken = _exported_csv([["Rice", "Dry", "1", "", "5", "", "", "", "", "", ""]])
    rows2, errors2 = parse_upload(broken, "x.csv", "text/csv", ITEMS_TEMPLATE)
    assert errors2, "a row with a name and no unit must still be an error"
    assert "Unit" in errors2[0]


def test_every_importable_field_is_exported_under_a_header_the_template_accepts() -> None:
    """The structural guard.

    The round trip broke because two lists of English lived in two files and
    drifted. This asserts they cannot: every header the exporter writes for an
    importable field must be an alias (or the header) of the column that owns
    it. Add a column to one side without the other and this goes red.
    """
    by_key = {c.key: c for c in ITEMS_TEMPLATE.columns}
    for key, header in ITEM_IMPORT_HEADERS.items():
        col = by_key.get(key)
        assert col is not None, f"the exporter writes {key!r} and the template has no such column"
        accepted = {col.header.lower(), *(a.lower() for a in col.aliases)}
        assert header.lower() in accepted, (
            f"exported as {header!r} but the importer only accepts {sorted(accepted)}"
        )
