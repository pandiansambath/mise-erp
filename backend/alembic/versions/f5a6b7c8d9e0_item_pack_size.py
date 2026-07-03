"""items: pack_unit + pack_size (buy in packs, stock/cost in the base unit)

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-07-05

An item is stocked/costed/used in its base `unit` (kg, g, ml, piece). Optionally it
is BOUGHT in a pack: `1 <pack_unit> = <pack_size> <unit>` (e.g. 1 box = 5 kg). This
lets ordering/receiving convert packs -> base units while recipes + costing stay in
the base unit. Both nullable: no pack = the item is simply bought in its base unit.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "f5a6b7c8d9e0"
down_revision: str | None = "e4f5a6b7c8d9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("items", sa.Column("pack_unit", sa.String(length=20), nullable=True))
    op.add_column("items", sa.Column("pack_size", sa.Numeric(12, 3), nullable=True))


def downgrade() -> None:
    op.drop_column("items", "pack_size")
    op.drop_column("items", "pack_unit")
