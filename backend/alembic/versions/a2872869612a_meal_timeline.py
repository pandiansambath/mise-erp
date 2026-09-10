"""the diner's meal, remembered: when food landed, and what a question was about

Two things a single page could not answer.

1. "what he ordered before, whether it served, after that what he ordered,
   with time too."
   The diner's order list excluded COMPLETED, so a round vanished off their
   screen at the moment it arrived. Showing served rounds needs a boundary that
   is not the status — hence `sitting_ended_at`, stamped when the table is
   released, exactly like `table_messages.cleared_at`. And "how long did that
   take?" needs real marks, not `updated_at`, which moves on every write to
   the row.

2. "I clicked Chettinad but the suggestions are showing for Masala Dosa."
   The AI thread was one flat conversation per table, so a dish-scoped sheet
   replayed whatever was asked last. `topic` records which dish each turn was
   about, so the sheet opens on its own dish and keeps the rest a tap away.

Backfill: `served_at` is left NULL on rows already completed. It would have to
be guessed from `updated_at`, and a fabricated "arrived 8:14pm" is worse than
an honest silence — the UI simply omits the timing for those. New orders carry
real marks from the next transition onward.

Revision ID: a2872869612a
Revises: 1489a62151a3
"""

import sqlalchemy as sa

from alembic import op

revision: str = "a2872869612a"
down_revision: str | None = "1489a62151a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("ready_at", sa.DateTime(timezone=True)))
    op.add_column("orders", sa.Column("served_at", sa.DateTime(timezone=True)))
    op.add_column("orders", sa.Column("sitting_ended_at", sa.DateTime(timezone=True)))
    # Every order that predates this migration belongs to a sitting that is
    # long over. Without the stamp the next diner to scan an old table's code
    # would open the page on months of somebody else's dinners, because the
    # list now returns completed rounds instead of filtering them out.
    op.execute(
        "UPDATE orders SET sitting_ended_at = COALESCE(updated_at, created_at) "
        "WHERE status IN ('COMPLETED', 'REJECTED', 'CANCELLED')"
    )
    op.add_column("table_messages", sa.Column("topic", sa.String(120)))
    # The diner's page reads this list on every poll: table, still-open sitting.
    op.create_index(
        "ix_orders_table_sitting",
        "orders",
        ["table_id", "sitting_ended_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_orders_table_sitting", table_name="orders")
    op.drop_column("table_messages", "topic")
    op.drop_column("orders", "sitting_ended_at")
    op.drop_column("orders", "served_at")
    op.drop_column("orders", "ready_at")
