"""Money set aside is not money spent — a flag on expense categories.

His August report, page 3: "RESERVES / CASH-FLOW ITEMS — NOT P&L EXPENSE".
Rent reserve £8,500 and chef salary reserve £1,300, each marked "Reserve /
transfer — not added to August P&L expense". Until now an expense category had
no way to say that, so a reserve logged on Expenses landed in profit as cost —
and the rent was then counted again when it was actually paid.

Deliberately a column the owner sets, NOT a guess from the category's name.

⚠️ THE AI VIEW HAS TO BE REBUILT. `ai_expense_categories` is `SELECT * FROM
expense_categories`, and Postgres expands that `*` ONCE, when the view is made —
a column added afterwards is invisible to it. Without the rebuild the assistant
could still sum expenses into a profit figure but could never see which of them
are set-aside money. Only this one view is rebuilt, from the same definitions
the test suite uses (`app.core.ai_views`), so nothing else it exposes changes.

Downgrade drops the view first: Postgres refuses to drop a column a view uses.

Revision ID: d72b0b20f521
Revises: 8c43d7871e59
"""
import sqlalchemy as sa

from alembic import op
from app.core.ai_views import create_statements

revision: str = "d72b0b20f521"
down_revision: str | None = "8c43d7871e59"
branch_labels = None
depends_on = None

_VIEW = "ai_expense_categories"


def _create_view() -> str:
    return next(s for s in create_statements() if f" VIEW {_VIEW} AS " in s)


def upgrade() -> None:
    op.add_column(
        "expense_categories",
        sa.Column("is_transfer", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute(f"DROP VIEW IF EXISTS {_VIEW}")
    op.execute(_create_view())


def downgrade() -> None:
    op.execute(f"DROP VIEW IF EXISTS {_VIEW}")
    op.drop_column("expense_categories", "is_transfer")
    op.execute(_create_view())
