"""Keep typed-but-unsaved takings, per person, so a reload does not lose them.

    "once we entered the number store that in db (persistent) so that even if
     we unsaved also it will be persistent for reloads and all even login
     logout also we can still see unsaved entries safely"

A draft is not a sale: nothing reads this table except the takings cards.

Revision ID: 4b877dcec454
"""
import sqlalchemy as sa

from alembic import op

revision = "4b877dcec454"
down_revision = "d37abc8c04c1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_drafts",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("entries", sa.JSON(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("hotel_id", "date", "user_id", name="uq_sales_draft"),
    )
    op.create_index("ix_sales_drafts_hotel_id", "sales_drafts", ["hotel_id"])


def downgrade() -> None:
    op.drop_index("ix_sales_drafts_hotel_id", table_name="sales_drafts")
    op.drop_table("sales_drafts")
