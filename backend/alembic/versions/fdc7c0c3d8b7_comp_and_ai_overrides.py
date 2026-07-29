"""hotels: is_comp + per-hotel AI allowance overrides

Revision ID: fdc7c0c3d8b7
Revises: c76fd15201d3
"""
import sqlalchemy as sa

from alembic import op

revision: str = "fdc7c0c3d8b7"
down_revision: str | None = "c76fd15201d3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Defaults matter here: every existing hotel must stay a NORMAL, billable
    # account. Defaulting is_comp to true would silently make everyone free.
    op.add_column(
        "hotels",
        sa.Column("is_comp", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    # Null = use the plan's numbers, so nobody's allowance changes on migration.
    op.add_column("hotels", sa.Column("ai_daily_override", sa.Integer(), nullable=True))
    op.add_column("hotels", sa.Column("ai_monthly_override", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("hotels", "ai_monthly_override")
    op.drop_column("hotels", "ai_daily_override")
    op.drop_column("hotels", "is_comp")
