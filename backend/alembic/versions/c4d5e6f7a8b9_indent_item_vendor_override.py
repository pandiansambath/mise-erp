"""indent_items: per-line vendor override (picked > preferred > cheapest)

Revision ID: c4d5e6f7a8b9
Revises: b2c3d4e5f6a7
Create Date: 2026-06-12
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c4d5e6f7a8b9"
down_revision: str | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("indent_items", sa.Column("vendor_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_indent_items_vendor_id_vendors",
        "indent_items",
        "vendors",
        ["vendor_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_indent_items_vendor_id_vendors", "indent_items", type_="foreignkey")
    op.drop_column("indent_items", "vendor_id")
