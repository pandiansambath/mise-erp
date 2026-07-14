"""Riders (delivery staff) + orders.rider_id.

Revision ID: f281d1f9e6b8
Revises: 082cd5140b11
Create Date: 2026-07-14
"""
import sqlalchemy as sa

from alembic import op

revision: str = "f281d1f9e6b8"
down_revision: str | None = "082cd5140b11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "riders",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("phone", sa.String(30), nullable=False, index=True),
        sa.Column("pin_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("online", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("last_lng", sa.Numeric(9, 6), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.add_column(
        "orders", sa.Column("rider_id", sa.Uuid(), sa.ForeignKey("riders.id"), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("orders", "rider_id")
    op.drop_table("riders")
