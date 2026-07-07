"""price_history — append-only trail of every vendor-price change

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-07-07

Never lose a previous price: manual edits, PO receipts and bill scans each append
a (vendor, item, old→new, source, date) row here.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "d9e0f1a2b3c4"
down_revision: str | None = "c8d9e0f1a2b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "price_history",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        sa.Column("vendor_id", sa.Uuid(), nullable=False),
        sa.Column("item_id", sa.Uuid(), nullable=False),
        sa.Column("old_price", sa.Numeric(12, 2), nullable=True),
        sa.Column("new_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="manual"),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_price_history_hotel_id", "price_history", ["hotel_id"])
    op.create_index("ix_price_history_item_id", "price_history", ["item_id"])
    op.create_index("ix_price_history_vendor_id", "price_history", ["vendor_id"])


def downgrade() -> None:
    op.drop_index("ix_price_history_vendor_id", table_name="price_history")
    op.drop_index("ix_price_history_item_id", table_name="price_history")
    op.drop_index("ix_price_history_hotel_id", table_name="price_history")
    op.drop_table("price_history")
