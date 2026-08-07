"""What a supplier calls one of your items.

Prices were attached by EXACT name, so a vendor writing "Tomatos" against your
"Tomato" failed with "item not found" — one character rejecting a whole price
list on document upload.

Confirmed matches are written here, so the same wording is never asked about
twice. `vendor_id` is nullable on purpose: an alias learned from one supplier
applies to them alone by default, because two suppliers can use the same word
for different things; a null vendor means anyone writing this means that.

Also enables pg_trgm, which does the fuzzy scoring in the database rather than
in Python — see app/vendors/matching.py, which falls back gracefully if the
extension cannot be created.

Revision ID: f2d339f28192
Revises: 354d5cbe6181
"""
import sqlalchemy as sa

from alembic import op

revision = "f2d339f28192"
down_revision = "354d5cbe6181"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Needs superuser on some managed Postgres; the matcher works without it.
    try:
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    except Exception:  # noqa: BLE001
        pass

    op.create_table(
        "item_aliases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("item_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("vendor_id", sa.Uuid(), nullable=True, index=True),
        sa.Column("alias", sa.String(length=160), nullable=False, index=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now()
        ),
    )
    # The lookup is always "this hotel, this wording".
    op.create_index("ix_item_aliases_hotel_alias", "item_aliases", ["hotel_id", "alias"])


def downgrade() -> None:
    op.drop_index("ix_item_aliases_hotel_alias", table_name="item_aliases")
    op.drop_table("item_aliases")
