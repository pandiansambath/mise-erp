"""Payroll flexibility: custom pay ranges + overlap guard + pay schedules.

pay_period grows to 30 chars so a custom range label ("2026-07-05→2026-08-04")
fits; period_start/end make overlap ("already paid") checks exact; employees
gain their personal pay schedule (pay_day for monthly, pay_weekday for weekly).

Revision ID: e487e0cfa8e1
Revises: 589b21c1f730
Create Date: 2026-07-15
"""
import sqlalchemy as sa

from alembic import op

revision: str = "e487e0cfa8e1"
down_revision: str | None = "589b21c1f730"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("payroll", "pay_period", type_=sa.String(30))
    op.add_column("payroll", sa.Column("period_start", sa.Date(), nullable=True))
    op.add_column("payroll", sa.Column("period_end", sa.Date(), nullable=True))
    op.add_column("employees", sa.Column("pay_day", sa.Integer(), nullable=True))
    op.add_column("employees", sa.Column("pay_weekday", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("employees", "pay_weekday")
    op.drop_column("employees", "pay_day")
    op.drop_column("payroll", "period_end")
    op.drop_column("payroll", "period_start")
    op.alter_column("payroll", "pay_period", type_=sa.String(10))
