"""a conversation between a table and the counter

Revision ID: 184c8778d258
Revises: 8407e01770df
Create Date: 2026-09-10

  "if customer send msg I can't able to see the reply or the persistent history
   of that time. Please show previous msg too until this table is cleared — it
   should be interactive between both."

A guest message used to be one column on the live order, which holds exactly one
sentence and travels in one direction: it appeared on the pass, and from the
diner's side nothing had visibly happened. Asking twice overwrote the first ask.

A conversation needs rows. Scoped to the TABLE rather than an order, because the
things people ask for — water, the bill, a highchair — are not about a dish and
often come before anything has been ordered.

`cleared_at` bounds the sitting. Releasing a table ends its thread rather than
deleting it: what a table asked for is worth keeping, it simply stops being THIS
party's conversation, so the next people to sit down never read the last ones'.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "184c8778d258"
down_revision: str | None = "8407e01770df"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "table_messages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "hotel_id",
            sa.Uuid(),
            sa.ForeignKey("hotels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "table_id",
            sa.Uuid(),
            sa.ForeignKey("dining_tables.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("from_staff", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("staff_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("cleared_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_table_messages_hotel_id", "table_messages", ["hotel_id"])
    # The read this table exists for: "the open thread for one table, oldest
    # first". Indexed on the columns that query filters by, so a busy room does
    # not scan every message ever sent to serve one panel.
    op.create_index(
        "ix_table_messages_open",
        "table_messages",
        ["table_id", "cleared_at", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_table_messages_open", table_name="table_messages")
    op.drop_index("ix_table_messages_hotel_id", table_name="table_messages")
    op.drop_table("table_messages")
