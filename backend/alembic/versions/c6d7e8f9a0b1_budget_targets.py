"""budget_targets — per-hotel monthly goals

Revision ID: c6d7e8f9a0b1
Revises: b5c6d7e8f9a0
Create Date: 2026-06-14
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c6d7e8f9a0b1"
down_revision: str | None = "b5c6d7e8f9a0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "budget_targets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        sa.Column("monthly_sales", sa.Numeric(12, 2), nullable=True),
        sa.Column("food_cost_pct", sa.Numeric(5, 2), nullable=True),
        sa.Column("labour_pct", sa.Numeric(5, 2), nullable=True),
        sa.Column("net_margin_pct", sa.Numeric(5, 2), nullable=True),
        sa.ForeignKeyConstraint(["hotel_id"], ["hotels.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hotel_id", name="uq_budget_hotel"),
    )


def downgrade() -> None:
    op.drop_table("budget_targets")
