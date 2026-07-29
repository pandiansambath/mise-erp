"""The assistant's read surface, defined once.

Both the migration and the test fixture build these. Keeping the definitions in
one place matters more here than usual: if the test suite ever rebuilt views
that differed from production's, it would be proving the safety of something
that isn't what ships.

Each view filters on `current_setting('app.hotel_id')`, so the tenant boundary
is enforced by the database rather than by whatever SQL the model wrote.
"""
from __future__ import annotations

# hotel_id lives on the row itself.
DIRECT = [
    "items", "vendors", "recipes", "indents", "purchase_orders",
    "expenses", "expense_categories", "daily_sales", "dish_sales",
    "menu_items", "orders", "employees", "attendance", "payroll",
    "salary_advances", "shifts", "documents", "safety_logs",
    "party_quotes", "budget_targets", "price_history",
    "job_postings", "job_applications", "sales_channels",
]

# Child rows carry no hotel_id; they scope through a parent that does, so they
# cannot be reached for another hotel by joining sideways.
CHILD = [
    ("vendor_items", "vendors", "vendor_id"),
    ("recipe_ingredients", "recipes", "recipe_id"),
    ("indent_items", "indents", "indent_id"),
    ("po_items", "purchase_orders", "po_id"),
    ("order_items", "orders", "order_id"),
    ("party_quote_lines", "party_quotes", "quote_id"),
]

_SCOPE = "current_setting('app.hotel_id', true)::uuid"


def create_statements() -> list[str]:
    out = [
        f"CREATE OR REPLACE VIEW ai_{t} AS SELECT * FROM {t} WHERE hotel_id = {_SCOPE}"
        for t in DIRECT
    ]
    out += [
        f"CREATE OR REPLACE VIEW ai_{child} AS SELECT c.* FROM {child} c "
        f"JOIN {parent} p ON p.id = c.{fk} WHERE p.hotel_id = {_SCOPE}"
        for child, parent, fk in CHILD
    ]
    return out


def drop_statements() -> list[str]:
    names = [f"ai_{c}" for c, _, _ in CHILD] + [f"ai_{t}" for t in DIRECT]
    return [f"DROP VIEW IF EXISTS {n} CASCADE" for n in names]


async def create_ai_views(conn) -> None:
    """Build them on an open async connection (used by the test fixture)."""
    from sqlalchemy import text

    for stmt in create_statements():
        try:
            await conn.execute(text(stmt))
        except Exception:  # noqa: BLE001
            # A table this view needs may not exist in a partial test schema.
            # Skipping keeps the suite runnable; the migration is where a
            # genuinely missing table must fail loudly.
            continue
