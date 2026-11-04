"""When each dish on a ticket was finished.

    "STILL TO DO on this page: stage lanes and item-level ticking, which needs a
     backend field." (32.30)

A ticket moves as a whole, but a table's biryani and its lassi do not finish
together, and until now the only record that one was done was in the chef's
head. Nullable: every existing line simply has not been ticked.

Revision ID: 8fe5478fb0e8
"""
import sqlalchemy as sa

from alembic import op

revision = "8fe5478fb0e8"
down_revision = "9824b96c5d1a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "order_items", sa.Column("done_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("order_items", "done_at")
