"""Menu photo uploads + delivery fee / minimum order.

Revision ID: 589b21c1f730
Revises: a6e3ceac091b
Create Date: 2026-07-14
"""
import sqlalchemy as sa

from alembic import op

revision: str = "589b21c1f730"
down_revision: str | None = "a6e3ceac091b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("menu_items", sa.Column("photo_key", sa.String(255), nullable=True))
    op.add_column(
        "hotels", sa.Column("delivery_fee", sa.Numeric(8, 2), nullable=False, server_default="0")
    )
    op.add_column(
        "hotels",
        sa.Column("delivery_min_order", sa.Numeric(8, 2), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("hotels", "delivery_min_order")
    op.drop_column("hotels", "delivery_fee")
    op.drop_column("menu_items", "photo_key")
