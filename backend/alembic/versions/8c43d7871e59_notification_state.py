"""Remember what each person has read or put away on the bell — and nothing else.

    32.13: "Notification state needs a row, but NOT a notifications table."

The feed stays computed from the rows the features already write. This holds
only state ABOUT a notification: one row per (user, key), keyed on the id the
API already emits. It buys dismiss, mark-all-read that sticks, and
read-on-any-device — none of which a localStorage seen-set can do.

Revision ID: 8c43d7871e59
"""
import sqlalchemy as sa

from alembic import op

revision = "8c43d7871e59"
down_revision = "4f17f04452ef"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "notification_state",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("key", sa.String(length=160), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("user_id", "key", name="uq_notification_state_user_key"),
    )
    op.create_index("ix_notification_state_hotel_id", "notification_state", ["hotel_id"])


def downgrade() -> None:
    op.drop_index("ix_notification_state_hotel_id", table_name="notification_state")
    op.drop_table("notification_state")
