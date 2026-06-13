"""dish_sales — manual per-dish sales counts (menu-engineering bridge)

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-06-13
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e2f3a4b5c6d7"
down_revision: str | None = "d1e2f3a4b5c6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "dish_sales",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        sa.Column("recipe_id", sa.Uuid(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("qty_sold", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["hotel_id"], ["hotels.id"]),
        sa.ForeignKeyConstraint(["recipe_id"], ["recipes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hotel_id", "recipe_id", "date", name="uq_dishsale_hotel_recipe_date"),
    )
    op.create_index("ix_dish_sales_hotel_id", "dish_sales", ["hotel_id"])
    op.create_index("ix_dish_sales_recipe_id", "dish_sales", ["recipe_id"])
    op.create_index("ix_dish_sales_date", "dish_sales", ["date"])


def downgrade() -> None:
    op.drop_index("ix_dish_sales_date", table_name="dish_sales")
    op.drop_index("ix_dish_sales_recipe_id", table_name="dish_sales")
    op.drop_index("ix_dish_sales_hotel_id", table_name="dish_sales")
    op.drop_table("dish_sales")
