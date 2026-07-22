"""Recurring expenses carry forward: chain link column.

Revision ID: bea02e54b73d
Revises: e487e0cfa8e1
Create Date: 2026-07-15
"""
import sqlalchemy as sa

from alembic import op

revision: str = "bea02e54b73d"
down_revision: str | None = "e487e0cfa8e1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "expenses",
        sa.Column("recurred_from", sa.Uuid(), sa.ForeignKey("expenses.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("expenses", "recurred_from")
