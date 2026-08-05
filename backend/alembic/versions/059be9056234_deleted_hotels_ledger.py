"""A record of every restaurant deleted, that outlives the restaurant.

The obvious place for this was the hotel's own audit log — and that is exactly
why it could not go there. `purge()` empties `audit_logs` for the hotel it is
removing, so a deletion recorded in it would be destroyed by the very act it
was recording. The only place a deletion note can survive is a table with no
hotel_id foreign key at all.

Revision ID: 059be9056234
Revises: a3371eb5891b
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "059be9056234"
down_revision: str | None = "a3371eb5891b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "deleted_hotels",
        sa.Column("id", sa.Uuid(), primary_key=True),
        # Deliberately NOT a foreign key: the row it would point at is gone.
        sa.Column("hotel_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("hotel_name", sa.String(length=160), nullable=False),
        sa.Column("handle", sa.String(length=40), nullable=True),
        sa.Column("city", sa.String(length=80), nullable=True),
        sa.Column("country", sa.String(length=80), nullable=True),
        sa.Column("plan", sa.String(length=20), nullable=True),
        # Who did it, why, and where the copy went. Without the archive key the
        # "everything is archived first" promise is unverifiable after the fact.
        sa.Column("deleted_by", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("archive_key", sa.String(length=255), nullable=True),
        sa.Column("total_rows", sa.Integer(), nullable=False, server_default="0"),
        # The per-table counts, so "113 records" can be broken down later.
        sa.Column("removed", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("deleted_hotels")
