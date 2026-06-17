"""stock_movement vendor — track which vendor each lot came from

Revision ID: d7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-06-17
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d7e8f9a0b1c2"
down_revision: str | None = "c6d7e8f9a0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("stock_movements", sa.Column("vendor_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_stock_movements_vendor_id", "stock_movements", "vendors", ["vendor_id"], ["id"]
    )
    op.create_index("ix_stock_movements_vendor_id", "stock_movements", ["vendor_id"])


def downgrade() -> None:
    op.drop_index("ix_stock_movements_vendor_id", table_name="stock_movements")
    op.drop_constraint("fk_stock_movements_vendor_id", "stock_movements", type_="foreignkey")
    op.drop_column("stock_movements", "vendor_id")
