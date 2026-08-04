"""cash control: petty cash, an append-only cash history, and drawer close state

Revision ID: 013a2f80395b
Revises: 43e5de6d9b86

The point of the whole product, in the owner's words: no money should get lost.
Three gaps stopped that being true.

1. Nothing recorded money leaving the till in someone's hand. A staff member
   takes 50 for greens, spends 10 and returns 40; until they are back the
   drawer is 50 light and the count cannot balance. `petty_cash` holds the
   three amounts SEPARATELY because they are known at different times.

2. Cash figures could be edited days later with no record. Cash is the one
   thing that cannot be reconstructed from anywhere else, so `cash_events` is
   append-only: corrections are new rows, never edits.

3. A day left open never closed, so the running total drifted forward for ever.
   `closed_at` / `auto_closed` let the midnight job settle a day while keeping
   an assumed figure visibly different from a counted one.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "013a2f80395b"
down_revision: str | None = "43e5de6d9b86"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daily_sales", sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "daily_sales",
        sa.Column("auto_closed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.create_table(
        "cash_events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("date", sa.Date(), nullable=False, index=True),
        sa.Column("field", sa.String(length=20), nullable=False),
        sa.Column("old_value", sa.Numeric(12, 2), nullable=True),
        sa.Column("new_value", sa.Numeric(12, 2), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("changed_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("source", sa.String(length=12), nullable=False, server_default="user"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "petty_cash",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("date", sa.Date(), nullable=False, index=True),
        sa.Column("taken_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("spent_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("returned_amount", sa.Numeric(12, 2), nullable=True),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("taken_by", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=10), nullable=False, server_default="OPEN"),
        sa.Column("expense_id", sa.Uuid(), sa.ForeignKey("expenses.id"), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
    )
    # The drawer view asks "what is open for this hotel on this day" on every
    # load; without this it is a full scan once a busy site has a year of rows.
    op.create_index("ix_petty_cash_hotel_date", "petty_cash", ["hotel_id", "date"])


def downgrade() -> None:
    op.drop_index("ix_petty_cash_hotel_date", table_name="petty_cash")
    op.drop_table("petty_cash")
    op.drop_table("cash_events")
    op.drop_column("daily_sales", "auto_closed")
    op.drop_column("daily_sales", "closed_at")
