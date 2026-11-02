"""receive now, pay later: a purchase order knows whether it has been paid

    "receive stock into our stock but payment is still pending so that it wont
     added in expense ..but in PO it need to show like payment pending..even in
     that vendor page also it need to show payment pending"

Four columns on purchase_orders: `payment_status` (NULL until received, then
PENDING or PAID), `paid_on`, `paid_method`, and `payment_id` — the vendor
payment that settled it.

THE BACKFILL. Every order already RECEIVED becomes PAID with `paid_on` left
NULL, which means "booked on receipt" — exactly what those rows have always
been. No expense row and no payment row is touched, so every past month's P&L
reads the same after this migration as before it. Whether those suppliers were
actually paid is a question the vendor ledger already answers (delivered minus
paid), and this does not change it.

Deliberately NOT here: a unique index on expenses.purchase_order_id. Live data
cannot be checked for existing duplicates from where this was written, and a
migration that fails on deploy crashes the container. One-expense-per-PO rests
on a row lock plus the existing lookup until a read-only count says the index
is safe.

Revision ID: 4f17f04452ef
Revises: ad09329a5455
"""

import sqlalchemy as sa

from alembic import op

revision: str = "4f17f04452ef"
down_revision: str | None = "ad09329a5455"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("purchase_orders", sa.Column("payment_status", sa.String(10), nullable=True))
    op.add_column("purchase_orders", sa.Column("paid_on", sa.Date(), nullable=True))
    op.add_column("purchase_orders", sa.Column("paid_method", sa.String(10), nullable=True))
    op.add_column(
        "purchase_orders",
        sa.Column(
            "payment_id",
            sa.Uuid(),
            sa.ForeignKey("vendor_payments.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Same name as the model's __table_args__ — the tests build the schema from
    # the model, not from here, so the two have to agree by hand.
    op.create_index(
        "ix_purchase_orders_vendor_payment",
        "purchase_orders",
        ["vendor_id", "payment_status"],
        unique=False,
    )
    op.execute("UPDATE purchase_orders SET payment_status = 'PAID' WHERE status = 'RECEIVED'")


def downgrade() -> None:
    op.drop_index("ix_purchase_orders_vendor_payment", table_name="purchase_orders")
    op.drop_column("purchase_orders", "payment_id")
    op.drop_column("purchase_orders", "paid_method")
    op.drop_column("purchase_orders", "paid_on")
    op.drop_column("purchase_orders", "payment_status")
