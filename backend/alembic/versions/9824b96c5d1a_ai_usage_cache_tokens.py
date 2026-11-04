"""Store the prompt-cache tokens every AI call already reports.

    "ALSO SHOW HOTEL WISE TOO..WHO COST HOW MUHC N WHY WITH PROOFs"

`ai_usage` read 41% of AWS's Bedrock bill over 30 days (§43.8). One reason is
that Bedrock's `input_tokens` is only the UNCACHED part of a prompt: the cached
system prompt and tool list come back as separate cache-write and cache-read
counts, which the meter captured and nothing stored. Two columns, both
defaulting to 0, so every existing row keeps meaning exactly what it meant.

Revision ID: 9824b96c5d1a
"""
import sqlalchemy as sa

from alembic import op

revision = "9824b96c5d1a"
down_revision = "d72b0b20f521"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "ai_usage",
        sa.Column("cache_read_tokens", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "ai_usage",
        sa.Column("cache_write_tokens", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("ai_usage", "cache_write_tokens")
    op.drop_column("ai_usage", "cache_read_tokens")
