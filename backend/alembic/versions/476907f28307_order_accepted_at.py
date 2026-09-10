"""when the kitchen accepted an order

Revision ID: 476907f28307
Revises: 184c8778d258
Create Date: 2026-09-10

The diner's countdown ran from `updated_at`, which is `onupdate=func.now()` and
so moves whenever ANY column on the order changes. "Need someone" writes
`help_requested_at` on that same row — so asking for a waiter restarted the
clock, and a two-day-old order showed "9 minutes away" again.

Asking for water must not make the food look newly cooked. A dedicated column
records the one moment the countdown is actually about.

Backfilled from `updated_at` for orders already past NEW: imperfect for any that
were touched after acceptance, but far closer than the alternative of leaving
every existing ticket with no start at all.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "476907f28307"
down_revision: str | None = "184c8778d258"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        """
        UPDATE orders
           SET accepted_at = COALESCE(updated_at, created_at)
         WHERE status NOT IN ('NEW', 'REJECTED', 'CANCELLED')
        """
    )


def downgrade() -> None:
    op.drop_column("orders", "accepted_at")
