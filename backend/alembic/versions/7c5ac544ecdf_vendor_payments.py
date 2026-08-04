"""vendor_payments — what has actually been paid to each supplier

Revision ID: 7c5ac544ecdf
Revises: 343f156cdaf4

You buy daily and settle weekly, monthly or every ten days. The app knew what
every delivery cost and nothing about what had been paid, so "how much do I owe
them?" was answerable only on paper — which is exactly the kind of number that
quietly drifts.

Recorded against the VENDOR rather than individual purchase orders, because one
transfer covers a fortnight of deliveries. Splitting each payment across POs is
bookkeeping precision that makes people stop entering anything, and the balance
comes out identical either way.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "7c5ac544ecdf"
down_revision: str | None = "343f156cdaf4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "vendor_payments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column(
            "vendor_id",
            sa.Uuid(),
            sa.ForeignKey("vendors.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("date", sa.Date(), nullable=False, index=True),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("method", sa.String(length=20), nullable=False, server_default="BANK"),
        sa.Column("reference", sa.String(length=120), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    # The statement view asks "this hotel, this vendor, in date order" every
    # time it loads; the two single-column indexes cannot serve that as well.
    op.create_index(
        "ix_vendor_payments_hotel_vendor_date",
        "vendor_payments",
        ["hotel_id", "vendor_id", "date"],
    )


def downgrade() -> None:
    op.drop_index("ix_vendor_payments_hotel_vendor_date", table_name="vendor_payments")
    op.drop_table("vendor_payments")
