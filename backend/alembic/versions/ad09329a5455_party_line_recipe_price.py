"""A party-order line remembers the recipe's price beside the price charged.

    "in party order section i need a flexibility to change the price of recipe
     whenever i needed default u can show the recipe price but it need to be
     configurable i will give different price also as per my wish.....so both
     price flexibility i need"

`unit_price` STAYS the price charged per plate. The quote PDF, the preview PDF,
the history table and the assistant's `ai_party_quote_lines` all read it as
exactly that, so turning it into "the recipe price" with an override column on
top would have made every one of them quietly wrong on an overridden line.
The new `recipe_price` is the recipe's own price when the line was saved,
frozen in the quote's currency; when the two differ, the owner priced the line
himself. That fact is derived, never stored.

Revision ID: ad09329a5455
Revises: 4b877dcec454
"""
import sqlalchemy as sa

from alembic import op
from app.core.ai_views import create_statements

revision: str = "ad09329a5455"
down_revision: str | None = "4b877dcec454"
branch_labels = None
depends_on = None

_VIEW = "ai_party_quote_lines"


def _view_sql() -> str:
    # The assistant's view is `SELECT c.*`, and Postgres freezes a view's column
    # list when it is created — without re-issuing it, the AI never sees the new
    # column. Only THIS view: refreshing all of them would quietly widen what the
    # assistant can read on every other table.
    return next(s for s in create_statements() if s.startswith(f"CREATE OR REPLACE VIEW {_VIEW} "))


def upgrade() -> None:
    op.add_column("party_quote_lines", sa.Column("recipe_price", sa.Numeric(12, 2), nullable=True))
    # Every existing line was priced from its recipe — the page had no other way —
    # so this is the truth for them, not a guess. Without it, every old priced line
    # would read as an own price.
    op.execute("UPDATE party_quote_lines SET recipe_price = unit_price")
    op.execute(_view_sql())


def downgrade() -> None:
    op.execute(f"DROP VIEW IF EXISTS {_VIEW}")  # it selects the column; Postgres will not drop it otherwise
    op.drop_column("party_quote_lines", "recipe_price")
    op.execute(_view_sql())
