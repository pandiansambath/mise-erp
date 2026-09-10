"""two conversations per table: the counter, and the assistant

Revision ID: 1489a62151a3
Revises: 476907f28307
Create Date: 2026-09-10

  "if I close and open, it's not showing the previous history... make the
   history persistent until owner clear that table. Both normal chat and ai
   chat be persistent."

The assistant's exchange lived only in React state, so it died with the popup: a
diner who asked what was in a dish, closed the sheet to go and look at it, and
came back had nothing.

Separate threads rather than one, because they are separate conversations.
Mixing "more water please" into a discussion about what is in the biryani makes
both harder to read — and worse, the staff reply box would then look like it was
answering the assistant.

Existing rows are all counter messages, which is what the default says.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "1489a62151a3"
down_revision: str | None = "476907f28307"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "table_messages",
        sa.Column(
            "channel",
            sa.String(length=12),
            nullable=False,
            server_default="counter",
        ),
    )
    # The read this serves is "the open thread for one table on one channel".
    op.create_index(
        "ix_table_messages_channel",
        "table_messages",
        ["table_id", "channel", "cleared_at", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_table_messages_channel", table_name="table_messages")
    op.drop_column("table_messages", "channel")
