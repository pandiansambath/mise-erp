"""link an expense to the purchase order that caused it

He asked why receiving stock does not show up under Expenses, and assumed
something had broken it. Nothing had — it was never built. The consequence is
worse than a missing row in a list:

    reports.pnl():  cost_of_sales = exp["variable_total"]

Cost of sales comes ENTIRELY from the expenses table. So receiving £1,856 of
stock moved the stock, updated the weighted-average cost, and added nothing to
the cost side of the P&L. Gross profit came out £1,856 too high and the food
cost percentage too low, unless somebody also typed the same spend into
Expenses by hand.

This column is what makes posting it automatically safe: one expense per PO,
found by this link and UPDATED on a re-receive rather than inserted again. Part
deliveries are normal here — receive 30 of 100 today and the rest on Friday —
and without the link each of those would have posted its own expense.

Revision ID: f2ffd115f408
Revises: 2d26137a400a
"""

import sqlalchemy as sa

from alembic import op

revision: str = "f2ffd115f408"
down_revision: str | None = "2d26137a400a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "expenses",
        sa.Column(
            "purchase_order_id",
            sa.Uuid(),
            sa.ForeignKey("purchase_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_expenses_purchase_order_id", "expenses", ["purchase_order_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_expenses_purchase_order_id", table_name="expenses")
    op.drop_column("expenses", "purchase_order_id")
