"""What the AI may do, on a role the hotel invented.

    "under ai we have so many features nah, like haiku, sonnet, voice model.
     i need a under ai what are all feature we gonna give"

The panel already existed for a PERSON and, after the last round, for a built-in
JOB. It did not exist on a role the hotel made itself — which is the sheet he
opened, and the reason he asked again. A role somebody invented is still a job;
the only thing that makes it different is that we did not name it.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "c93367a6ccbb"
down_revision: str | None = "cbb7aae08110"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "custom_roles",
        sa.Column("ai_settings", sa.JSON(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("custom_roles", "ai_settings")
