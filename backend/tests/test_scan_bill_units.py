"""A scanned bill only fills a field when it counts in the order's own unit.

A purchase order holds quantities and prices per BASE unit; a supplier's bill
is often per box. Writing "2" from a bill that means two boxes into a field
that means grams — or £120 a box as the price of a gram — corrupts stock and
prices. `_same_unit` is the gate the screen relies on.
"""

from app.purchasing.router import _same_unit


def test_the_same_unit_agrees_whatever_the_spelling():
    assert _same_unit("kg", "kg")
    assert _same_unit("kg", "KGs ")
    assert _same_unit("piece", "pieces")


def test_a_box_is_not_a_gram():
    assert not _same_unit("g", "box")
    assert not _same_unit("kg", "g")


def test_a_bill_that_names_no_unit_is_not_trusted():
    assert not _same_unit("kg", None)
    assert not _same_unit("kg", "")
    assert not _same_unit(None, None)
    assert not _same_unit("", "")
