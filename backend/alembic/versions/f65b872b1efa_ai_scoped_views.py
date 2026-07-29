"""ai_* views — the assistant's read surface, scoped by the database

Revision ID: f65b872b1efa
Revises: 48158cdb14ea

The assistant may write SQL, but only against these views. Each one filters on
`current_setting('app.hotel_id')`, so the tenant boundary lives in the DATABASE,
not in the model's query. That distinction is the whole point: a prompt cannot
argue with a view definition, and a forgotten WHERE clause leaks nothing.

Deliberately NOT exposed:
  users            — carries password_hash. Staff facts come from employees.
  hotels           — other tenants' rows.
  platform_*       — operator config.
  chats/chat_messages — hotel-to-hotel messaging; both sides' data.
  audit_events, ai_usage, assistant_* — internal plumbing, not business data.

Child tables (no hotel_id of their own) scope through their parent, so they
cannot be reached for another hotel by joining sideways.
"""
from alembic import op

revision: str = "f65b872b1efa"
down_revision: str | None = "48158cdb14ea"
branch_labels = None
depends_on = None

# hotel_id lives on the row itself.
DIRECT = [
    "items", "vendors", "recipes", "indents", "purchase_orders",
    "expenses", "expense_categories", "daily_sales", "dish_sales",
    "menu_items", "orders", "employees", "attendance", "payroll",
    "salary_advances", "shifts", "documents", "safety_logs",
    "party_quotes", "budget_targets", "price_history",
    "job_postings", "job_applications", "sales_channels",
]

# (view, table, join to a parent that DOES carry hotel_id)
CHILD = [
    ("vendor_items", "vendor_items", "vendors", "vendor_id"),
    ("recipe_ingredients", "recipe_ingredients", "recipes", "recipe_id"),
    ("indent_items", "indent_items", "indents", "indent_id"),
    ("po_items", "po_items", "purchase_orders", "po_id"),
    ("order_items", "order_items", "orders", "order_id"),
    ("party_quote_lines", "party_quote_lines", "party_quotes", "quote_id"),
]

_SCOPE = "current_setting('app.hotel_id', true)::uuid"


def upgrade() -> None:
    for t in DIRECT:
        op.execute(
            f"CREATE OR REPLACE VIEW ai_{t} AS "
            f"SELECT * FROM {t} WHERE hotel_id = {_SCOPE}"
        )
    for view, table, parent, fk in CHILD:
        op.execute(
            f"CREATE OR REPLACE VIEW ai_{view} AS "
            f"SELECT c.* FROM {table} c "
            f"JOIN {parent} p ON p.id = c.{fk} "
            f"WHERE p.hotel_id = {_SCOPE}"
        )


def downgrade() -> None:
    for view, *_ in CHILD:
        op.execute(f"DROP VIEW IF EXISTS ai_{view}")
    for t in DIRECT:
        op.execute(f"DROP VIEW IF EXISTS ai_{t}")
