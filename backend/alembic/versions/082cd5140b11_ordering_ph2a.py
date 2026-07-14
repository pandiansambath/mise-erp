"""Ordering Ph2a: prep-time estimate + busy-mode pause on hotels.

Revision ID: 082cd5140b11
Revises: 6cac12cb5eca
Create Date: 2026-07-14
"""
import sqlalchemy as sa

from alembic import op

revision: str = "082cd5140b11"
down_revision: str | None = "6cac12cb5eca"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels", sa.Column("prep_minutes", sa.Integer(), nullable=False, server_default="20")
    )
    op.add_column(
        "hotels",
        sa.Column("ordering_paused", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("hotels", "ordering_paused")
    op.drop_column("hotels", "prep_minutes")
