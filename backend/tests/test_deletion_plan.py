"""The delete plan for a hotel, exercised against the shapes that broke it.

Deleting a restaurant failed in production with foreign-key errors, and the
three causes were all the same thing: a hand-written table list that had
drifted from the schema. These tests pin the shapes that caused it, so the
next table somebody adds cannot quietly reintroduce the fault.

`_predicate` and `_order` are pure, so this needs no database — which matters,
because the code under test is the code that only ever runs while irreversibly
destroying somebody's data.
"""

from app.platform_admin import deletion


def _plan(hotel_cols, edges):
    """Mirror `_delete_plan`'s reachability walk without a database.

    `_fk_graph` drops NEVER_DELETE tables as it reads the catalogue, so the
    mirror has to drop them here or it tests a laxer rule than the real one.
    """
    hotel_cols = {k: v for k, v in hotel_cols.items() if k not in deletion.NEVER_DELETE}
    doomed = set(hotel_cols)
    changed = True
    while changed:
        changed = False
        for child, links in edges.items():
            if child in doomed or child in deletion.NEVER_DELETE:
                continue
            if any(p in doomed for _c, p, _pc in links):
                doomed.add(child)
                changed = True
    out = []
    for tbl in deletion._order(doomed, edges):
        where = deletion._predicate(tbl, hotel_cols, edges, doomed)
        if where:
            out.append((tbl, where))
    return out


def test_a_hotel_to_hotel_chat_is_found_by_both_of_its_owner_columns():
    """`chats` has hotel_a and hotel_b and NO hotel_id.

    The old purge only ever wrote `WHERE hotel_id = :h`, so this table was
    skipped entirely and the hotel delete died on `chats_hotel_a_fkey`.
    """
    plan = dict(_plan({"chats": {"hotel_a", "hotel_b"}}, {}))
    assert "chats" in plan
    assert "hotel_a = :h" in plan["chats"]
    assert "hotel_b = :h" in plan["chats"]


def test_the_other_partys_messages_go_too():
    """A chat between A and B holds messages sent BY B.

    Deleting hotel A by column alone leaves those rows behind, pointing at a
    chat that is about to vanish — so the transaction fails. They have to be
    reached through the parent.
    """
    plan = dict(
        _plan(
            {"chats": {"hotel_a", "hotel_b"}, "chat_messages": {"sender_hotel_id"}},
            {"chat_messages": [("chat_id", "chats", "id")]},
        )
    )
    where = plan["chat_messages"]
    assert "sender_hotel_id = :h" in where, "direct ownership still counts"
    assert "chat_id IN (SELECT id FROM chats WHERE" in where, "and the parent's rows"


def test_children_are_deleted_before_their_parents():
    """`menu_items.recipe_id -> recipes.id`.

    The old list put `recipes` twenty places BEFORE `menu_items` while calling
    itself "deepest children first", and the delete failed on
    `menu_items_recipe_id_fkey` for any hotel that had linked a dish to a
    recipe.
    """
    order = [t for t, _ in _plan(
        {"recipes": {"hotel_id"}, "menu_items": {"hotel_id"}},
        {"menu_items": [("recipe_id", "recipes", "id")]},
    )]
    assert order.index("menu_items") < order.index("recipes")


def test_a_table_nobody_listed_is_still_deleted():
    """Sixteen tables were missing from the hand-written list.

    Reachability is computed from the real foreign keys, so a table added
    tomorrow needs no edit to `ORDERED_TABLES`.
    """
    plan = dict(_plan({"dining_tables": {"hotel_id"}}, {}))
    assert plan["dining_tables"] == "hotel_id = :h"


def test_a_grandchild_is_reached_through_two_hops():
    plan = dict(
        _plan(
            {"orders": {"hotel_id"}},
            {
                "order_items": [("order_id", "orders", "id")],
                "order_item_notes": [("order_item_id", "order_items", "id")],
            },
        )
    )
    assert "order_item_notes" in plan
    assert "order_items" in plan["order_item_notes"]


def test_the_deletion_ledger_is_never_touched():
    """Erasing the record of a deletion as part of that deletion would be a
    tidy way to lose the audit trail."""
    assert "deleted_hotels" in deletion.NEVER_DELETE
    assert "hotels" in deletion.NEVER_DELETE
    plan = dict(_plan({"deleted_hotels": {"hotel_id"}}, {}))
    assert "deleted_hotels" not in plan


def test_a_self_referencing_table_does_not_recurse_forever():
    """A category with a parent_id, say. Without the `seen` guard this hangs
    the deletion of a live restaurant, which is the worst possible place."""
    plan = dict(
        _plan(
            {"expense_categories": {"hotel_id"}},
            {"expense_categories": [("parent_id", "expense_categories", "id")]},
        )
    )
    assert plan["expense_categories"] == "hotel_id = :h"


def test_two_tables_pointing_at_each_other_terminate():
    plan = dict(
        _plan(
            {"a": {"hotel_id"}},
            {"a": [("b_id", "b", "id")], "b": [("a_id", "a", "id")]},
        )
    )
    assert "a" in plan and "b" in plan
