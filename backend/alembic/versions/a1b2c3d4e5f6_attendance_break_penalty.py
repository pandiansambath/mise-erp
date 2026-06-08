"""attendance break_end + hotel break-allowance & per-minute penalty config

Revision ID: a1b2c3d4e5f6
Revises: e3bdff467d96
Create Date: 2026-06-08
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "e3bdff467d96"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column("break_allowance_minutes", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "hotels",
        sa.Column(
            "break_penalty_per_min", sa.Numeric(8, 2), nullable=False, server_default="0"
        ),
    )
    op.add_column(
        "attendance", sa.Column("break_end", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("attendance", "break_end")
    op.drop_column("hotels", "break_penalty_per_min")
    op.drop_column("hotels", "break_allowance_minutes")
