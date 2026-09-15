"""money dashboard: usage_daily, cloud_cost_daily, telemetry_sync, aws_credits

Revision ID: 5f17953ca95d
Revises: ad9e7463cea4

One migration for the whole money dashboard. Nothing is backfilled: request
counts before this point do not exist anywhere we can cheaply read (recovering
them would mean CloudWatch Logs Insights, which needs IAM the app does not have
and is billed per GB scanned), so the page says "not recorded before <date>"
rather than drawing a confident zero.
"""

import sqlalchemy as sa

from alembic import op

revision = "5f17953ca95d"
down_revision = "ad9e7463cea4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "platform_config",
        sa.Column("aws_credits", sa.JSON(), nullable=False, server_default="{}"),
    )

    op.create_table(
        "usage_daily",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        # No FK to hotels, deliberately: deletion.py derives its plan from the
        # live FK graph, so this table is untouched when a tenant is deleted.
        # Deleting a restaurant must not rewrite last month's bill.
        sa.Column("hotel_id", sa.Uuid(), nullable=False),
        sa.Column("method", sa.String(length=8), nullable=False),
        sa.Column("endpoint", sa.String(length=160), nullable=False),
        sa.Column("requests", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors_4xx", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors_5xx", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_ms", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("db_selects", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("db_writes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("db_ms", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "flushed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        # The ON CONFLICT target for the five-minute flush.
        sa.UniqueConstraint("day", "hotel_id", "method", "endpoint", name="uq_usage_daily_key"),
    )
    op.create_index("ix_usage_daily_day", "usage_daily", ["day"])
    op.create_index("ix_usage_daily_hotel_day", "usage_daily", ["hotel_id", "day"])

    op.create_table(
        "cloud_cost_daily",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("service", sa.String(length=80), nullable=False),
        sa.Column("usage_type", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("record_type", sa.String(length=20), nullable=False, server_default="Usage"),
        sa.Column("amount_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False, server_default="0"),
        sa.Column("source", sa.String(length=12), nullable=False, server_default="ce"),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "fetched_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("is_estimate", sa.Boolean(), nullable=False, server_default="false"),
        # UPSERT target. AWS restates the last few days; appending would
        # double-count and the page would drift upward on every refresh.
        sa.UniqueConstraint(
            "day", "service", "usage_type", "record_type", name="uq_cloud_cost_key"
        ),
    )
    op.create_index("ix_cloud_cost_daily_day", "cloud_cost_daily", ["day"])

    op.create_table(
        "telemetry_sync",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("job", sa.String(length=24), nullable=False),
        sa.Column(
            "started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("ok", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("rows_written", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("api_calls", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("api_cost_usd", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.Column("covers_from", sa.Date()),
        sa.Column("covers_to", sa.Date()),
        sa.Column("error", sa.Text()),
        sa.Column("detail", sa.JSON(), nullable=False, server_default="{}"),
    )
    op.create_index("ix_telemetry_sync_job", "telemetry_sync", ["job", "started_at"])


def downgrade() -> None:
    op.drop_index("ix_telemetry_sync_job", table_name="telemetry_sync")
    op.drop_table("telemetry_sync")
    op.drop_index("ix_cloud_cost_daily_day", table_name="cloud_cost_daily")
    op.drop_table("cloud_cost_daily")
    op.drop_index("ix_usage_daily_hotel_day", table_name="usage_daily")
    op.drop_index("ix_usage_daily_day", table_name="usage_daily")
    op.drop_table("usage_daily")
    op.drop_column("platform_config", "aws_credits")
