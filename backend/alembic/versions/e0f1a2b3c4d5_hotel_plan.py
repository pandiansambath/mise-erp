"""hotels: plan (subscription tier)

Revision ID: e0f1a2b3c4d5
Revises: d9e0f1a2b3c4
Create Date: 2026-07-07

Each hotel is on a subscription plan (starter | pro | enterprise) — a named bundle
of features + a user limit. Existing hotels default to 'pro' so nothing is lost.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "e0f1a2b3c4d5"
down_revision: str | None = "d9e0f1a2b3c4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column("plan", sa.String(length=20), nullable=False, server_default="pro"),
    )


def downgrade() -> None:
    op.drop_column("hotels", "plan")
