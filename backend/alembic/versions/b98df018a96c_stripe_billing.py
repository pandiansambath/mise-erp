"""Stripe billing columns on hotels (test mode).

Revision ID: b98df018a96c
Revises: e929c9aa0c35
Create Date: 2026-07-14
"""
import sqlalchemy as sa

from alembic import op

revision: str = "b98df018a96c"
down_revision: str | None = "e929c9aa0c35"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hotels", sa.Column("stripe_customer_id", sa.String(64), nullable=True))
    op.create_index("ix_hotels_stripe_customer_id", "hotels", ["stripe_customer_id"])
    op.add_column("hotels", sa.Column("stripe_subscription_id", sa.String(64), nullable=True))
    op.add_column(
        "hotels",
        sa.Column(
            "subscription_status", sa.String(20), nullable=False, server_default="free"
        ),
    )


def downgrade() -> None:
    op.drop_column("hotels", "subscription_status")
    op.drop_column("hotels", "stripe_subscription_id")
    op.drop_index("ix_hotels_stripe_customer_id", "hotels")
    op.drop_column("hotels", "stripe_customer_id")
