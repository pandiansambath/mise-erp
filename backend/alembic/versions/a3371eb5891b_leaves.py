"""leaves — planned time off, as a range

Revision ID: a3371eb5891b
Revises: 7c5ac544ecdf

Leave existed only as an attendance status on one day, which cannot answer the
question anyone actually asks: "is anybody off next Tuesday?" You had to open
each day in turn, so in practice rotas were built without knowing, and the clash
appeared when somebody did not turn up.

A range rather than a row per day, because that is how leave is requested and
how people think about it — "the 14th to the 20th", not seven separate facts.
end_date is INCLUSIVE; an exclusive end reads as an off-by-one to everyone who
is not a programmer.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "a3371eb5891b"
down_revision: str | None = "7c5ac544ecdf"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "leaves",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column(
            "employee_id",
            sa.Uuid(),
            sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("start_date", sa.Date(), nullable=False, index=True),
        sa.Column("end_date", sa.Date(), nullable=False, index=True),
        sa.Column("kind", sa.String(length=20), nullable=False, server_default="ANNUAL"),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="APPROVED"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("approved_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    # Every clash check asks "this hotel, overlapping this range" — the
    # single-column indexes cannot serve that as well.
    op.create_index("ix_leaves_hotel_range", "leaves", ["hotel_id", "start_date", "end_date"])


def downgrade() -> None:
    op.drop_index("ix_leaves_hotel_range", table_name="leaves")
    op.drop_table("leaves")
