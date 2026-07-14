"""Online ordering: menu_items + orders + order_items.

Revision ID: 6cac12cb5eca
Revises: b98df018a96c
Create Date: 2026-07-14
"""
import sqlalchemy as sa

from alembic import op

revision: str = "6cac12cb5eca"
down_revision: str | None = "b98df018a96c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "menu_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("price", sa.Numeric(8, 2), nullable=False),
        sa.Column("category", sa.String(60), nullable=False, server_default="Mains"),
        sa.Column("emoji", sa.String(8), nullable=True),
        sa.Column("is_available", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("recipe_id", sa.Uuid(), sa.ForeignKey("recipes.id"), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )
    op.create_table(
        "orders",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("code", sa.String(12), nullable=False, index=True),
        sa.Column("customer_name", sa.String(120), nullable=False),
        sa.Column("phone", sa.String(30), nullable=False),
        sa.Column("email", sa.String(200), nullable=True),
        sa.Column("fulfilment", sa.String(12), nullable=False, server_default="PICKUP"),
        sa.Column("address_text", sa.Text(), nullable=True),
        sa.Column("address_lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("address_lng", sa.Numeric(9, 6), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="NEW", index=True),
        sa.Column("subtotal", sa.Numeric(10, 2), nullable=False),
        sa.Column("delivery_fee", sa.Numeric(8, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(10, 2), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "order_items",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("order_id", sa.Uuid(), sa.ForeignKey("orders.id"), nullable=False, index=True),
        sa.Column("menu_item_id", sa.Uuid(), sa.ForeignKey("menu_items.id"), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("unit_price", sa.Numeric(8, 2), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("line_total", sa.Numeric(10, 2), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("order_items")
    op.drop_table("orders")
    op.drop_table("menu_items")
