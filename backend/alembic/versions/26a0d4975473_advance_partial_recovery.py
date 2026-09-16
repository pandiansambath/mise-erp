"""salary advances can be recovered in part

An advance was all-or-nothing, and that produced a payslip in live data reading

    gross 0.00   deductions 3500.00   net -3500.00   PAID

Recovering an advance in full out of a payslip that cannot cover it is not a
rounding problem, it is a missing column: there was nowhere to record "£400 of
the £3,500 came back". So the run had two choices and both lost money — pay a
negative net, or floor the net and mark the advance recovered, which writes off
the remainder with no trace.

BACKFILL: every advance already flagged `is_deducted` is treated as fully
recovered, because that is exactly what the old code meant by the flag. Doing
this in the same migration matters — leaving `amount_recovered` at 0 for
historical advances would make every one of them look outstanding, and the next
payroll run would try to recover them all over again from people who already
paid them back.

Revision ID: 26a0d4975473
Revises: 5f17953ca95d
"""

from alembic import op
import sqlalchemy as sa

revision = "26a0d4975473"
down_revision = "5f17953ca95d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "salary_advances",
        sa.Column(
            "amount_recovered",
            sa.Numeric(12, 2),
            nullable=False,
            server_default="0",
        ),
    )
    # An advance the old code marked recovered WAS recovered in full, as far as
    # anything in this system ever knew. Say so explicitly rather than leaving
    # it to default to zero and be re-deducted from someone's next payslip.
    op.execute(
        """
        UPDATE salary_advances
           SET amount_recovered = amount
         WHERE is_deducted IS TRUE
        """
    )


def downgrade() -> None:
    op.drop_column("salary_advances", "amount_recovered")
