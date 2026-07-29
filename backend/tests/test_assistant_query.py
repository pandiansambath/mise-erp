"""The validator for model-written SQL.

This is the highest-risk code in the product: a mistake here is a cross-tenant
data leak, not a broken screen. An earlier draft relied on a session variable
for scoping — with no row-level security on this database that filtered nothing,
and `SELECT * FROM items` would have returned every hotel's stock. These tests
exist so that class of mistake cannot come back quietly.
"""
import pytest

from app.assistant.query import READABLE, UnsafeQuery, validate


def test_base_tables_are_unreachable() -> None:
    """The whole design: only the ai_* views, never the tables behind them.
    A base table has no hotel filter, so reaching one IS the leak."""
    for sql in (
        "select * from items",
        "select * from users",
        "select * from hotels",
        "select * from employees e join items i on true",
    ):
        with pytest.raises(UnsafeQuery):
            validate(sql)


def test_a_plain_read_over_a_view_is_allowed() -> None:
    assert validate("select name from ai_items where current_stock < 5")
    assert validate(
        "select e.full_name, a.status from ai_employees e "
        "join ai_attendance a on a.employee_id = e.id"
    )


def test_writes_are_rejected() -> None:
    for sql in (
        "insert into ai_items values (1)",
        "update ai_items set name='x'",
        "delete from ai_items",
        "drop view ai_items",
        "truncate ai_items",
    ):
        with pytest.raises(UnsafeQuery):
            validate(sql)


def test_a_second_statement_cannot_ride_along() -> None:
    """The classic way past a naive 'starts with select' check."""
    with pytest.raises(UnsafeQuery):
        validate("select * from ai_items; drop table items")


def test_comments_are_rejected() -> None:
    """A comment can hide a second statement from a reviewer and a validator."""
    with pytest.raises(UnsafeQuery):
        validate("select * from ai_items -- ; delete from items")
    with pytest.raises(UnsafeQuery):
        validate("select * from ai_items /* sneaky */")


def test_the_scope_setting_cannot_be_touched() -> None:
    """current_setting/set_config are how a query would read or spoof the very
    thing the views depend on."""
    for sql in (
        "select current_setting('app.hotel_id')",
        "select set_config('app.hotel_id','00000000-0000-0000-0000-000000000000',true)",
    ):
        with pytest.raises(UnsafeQuery):
            validate(sql)


def test_ctes_are_allowed_but_still_bounded_to_views() -> None:
    assert validate(
        "with low as (select * from ai_items where current_stock < 5) select * from low"
    )
    with pytest.raises(UnsafeQuery):
        validate("with sneaky as (select * from users) select * from sneaky")


def test_every_readable_name_is_a_view_not_a_table() -> None:
    """If a bare table name ever appears in the allow-list, the scoping is gone."""
    for name in READABLE:
        assert name.startswith("ai_"), name
