"""multi-tenancy: hotels table + hotel_id on users/items/vendors/recipes

Revision ID: 0005
Revises: e08eeafc037d
Create Date: 2026-06-07
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0005"
down_revision: str | None = "e08eeafc037d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Fixed id so existing NIRAI data can be backfilled to a known hotel.
NIRAI_ID = "d0000000-0000-0000-0000-000000000001"
_SCOPED_TABLES = ["users", "items", "vendors", "recipes"]


def upgrade() -> None:
    op.create_table(
        "hotels",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("country", sa.String(length=2), nullable=False),
        sa.Column("city", sa.String(length=80), nullable=True),
        sa.Column("base_currency", sa.String(length=3), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Seed the existing restaurant as the first hotel.
    op.execute(
        f"INSERT INTO hotels (id, name, country, base_currency, is_active, created_at) "
        f"VALUES ('{NIRAI_ID}', 'NIRAI', 'GB', 'GBP', true, now())"
    )

    # Add hotel_id to every scoped table, backfill to NIRAI, then enforce NOT NULL.
    for tbl in _SCOPED_TABLES:
        op.add_column(tbl, sa.Column("hotel_id", sa.Uuid(), nullable=True))
        op.execute(f"UPDATE {tbl} SET hotel_id = '{NIRAI_ID}'")
        op.alter_column(tbl, "hotel_id", nullable=False)
        op.create_index(f"ix_{tbl}_hotel_id", tbl, ["hotel_id"])
        op.create_foreign_key(f"fk_{tbl}_hotel_id", tbl, "hotels", ["hotel_id"], ["id"])


def downgrade() -> None:
    for tbl in _SCOPED_TABLES:
        op.drop_constraint(f"fk_{tbl}_hotel_id", tbl, type_="foreignkey")
        op.drop_index(f"ix_{tbl}_hotel_id", table_name=tbl)
        op.drop_column(tbl, "hotel_id")
    op.drop_table("hotels")
