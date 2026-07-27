"""ai_usage — one row per AI call, so spend is attributable and capped

Revision ID: 4f27e3163bd8
Revises: 59d7a43b217b
"""
import sqlalchemy as sa

from alembic import op

revision: str = "4f27e3163bd8"
down_revision: str | None = "59d7a43b217b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("user_email", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("model", sa.String(length=80), nullable=False, server_default=""),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(10, 6), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_ai_usage_hotel_id", "ai_usage", ["hotel_id"])
    op.create_index("ix_ai_usage_created_at", "ai_usage", ["created_at"])
    # the quota checks always filter hotel + window together
    op.create_index("ix_ai_usage_hotel_time", "ai_usage", ["hotel_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_hotel_time", table_name="ai_usage")
    op.drop_index("ix_ai_usage_created_at", table_name="ai_usage")
    op.drop_index("ix_ai_usage_hotel_id", table_name="ai_usage")
    op.drop_table("ai_usage")
