"""Room for a price per gram.

Purchase-order lines and stock movements now carry a price per BASE unit rather
than per pack — that is the fix for a purchase order for one lemon costing £30
because the supplier quotes £30 a bottle of thirty.

Dividing a pack price down makes the numbers small. £120 for a 15 000 g box is
£0.008 a gram, and `Numeric(12, 2)` stores that as £0.01 — a quarter more than
it costs, on every gram of every cheap ingredient, forever. `average_cost` was
already 12,4 for exactly this reason; these two were left behind.

Only the PER-UNIT columns move. `line_total` and `total_amount` stay at two
decimals because they are actual money changing hands, and a supplier invoices
in pennies.

⚠️ The AI views have to come off first. `ai_po_items` is `SELECT c.* FROM
po_items c`, and Postgres will not let you alter the type of a column a view
selects — "cannot alter type of a column used by a view or rule". They are
generated from `app.core.ai_views`, so dropping and rebuilding them is free;
the alternative is a column that can never change type again.

Revision ID: 9dd92364a74a
Revises: f2ffd115f408
"""

import sqlalchemy as sa

from alembic import op
from app.core.ai_views import create_statements, drop_statements

revision: str = "9dd92364a74a"
down_revision: str | None = "f2ffd115f408"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for stmt in drop_statements():
        op.execute(stmt)

    op.alter_column(
        "po_items",
        "unit_price",
        existing_type=sa.Numeric(12, 2),
        type_=sa.Numeric(12, 4),
        existing_nullable=False,
    )
    op.alter_column(
        "stock_movements",
        "unit_cost",
        existing_type=sa.Numeric(12, 2),
        type_=sa.Numeric(12, 4),
        existing_nullable=True,
    )

    for stmt in create_statements():
        op.execute(stmt)


def downgrade() -> None:
    for stmt in drop_statements():
        op.execute(stmt)

    # Narrowing rounds real values; Postgres does it rather than failing, which
    # is the right behaviour for a rollback but is worth knowing about.
    op.alter_column(
        "stock_movements",
        "unit_cost",
        existing_type=sa.Numeric(12, 4),
        type_=sa.Numeric(12, 2),
        existing_nullable=True,
    )
    op.alter_column(
        "po_items",
        "unit_price",
        existing_type=sa.Numeric(12, 4),
        type_=sa.Numeric(12, 2),
        existing_nullable=False,
    )

    for stmt in create_statements():
        op.execute(stmt)
