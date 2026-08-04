"""vendor_item_aliases — remember which item a supplier's name refers to

Revision ID: 343f156cdaf4
Revises: 013a2f80395b

A vendor writes "Tomatos 1kg Box"; the inventory says "Tomato". Exact matching
fails and the import dies with "item not found". Normalising helps, but only a
remembered decision fixes it permanently — and remembering is what stops the
same forty questions being asked on every weekly price list.

Scoped to a vendor when known: suppliers name things differently, and one shop's
shorthand must not answer for another's. A NULL vendor_id is a hotel-wide alias,
consulted only when no vendor-specific one exists.

The unique constraint is what makes confirming twice a correction rather than a
duplicate — two rows for the same text could later disagree, and there would be
no principled way to pick between them.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "343f156cdaf4"
down_revision: str | None = "013a2f80395b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vendor_item_aliases",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column(
            "vendor_id",
            sa.Uuid(),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=True,
        ),
        # The normalised form: what lookups compare against.
        sa.Column("alias_text", sa.String(length=200), nullable=False, index=True),
        # What the supplier actually wrote, so the review list is readable.
        sa.Column("original_text", sa.String(length=200), nullable=True),
        sa.Column(
            "item_id", sa.Uuid(), sa.ForeignKey("items.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("hotel_id", "vendor_id", "alias_text", name="uq_alias_hotel_vendor_text"),
    )


def downgrade() -> None:
    op.drop_table("vendor_item_aliases")
