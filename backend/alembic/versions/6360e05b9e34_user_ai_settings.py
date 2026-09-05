"""Per-person AI settings — which model, voice, and the spend ceiling.

    "here we don't have a feature to add or remove ai feature (under this we
     need to have some filter like whether to give haiku or sonnet, also whether
     to give our voice model, also what the max token max msg etc). please add
     this feature also for role section in superadmin login."

WHETHER someone gets AI at all is already a permission (`ai:use`), granted on
the same screen as every other permission — so it does not move here. What has
no home is everything UNDER that yes: which model their questions cost money on,
whether they may use voice, and how much they may spend before it stops.

That ceiling is the point rather than a nicety. The AI is the only surface in
this product whose cost has no natural upper bound — a page can be opened a
thousand times for free, a model cannot — so "who may use it" without "how
much" is only half a control.

Revision ID: 6360e05b9e34
Revises: 0e286e4a93fb
"""
import sqlalchemy as sa

from alembic import op

revision: str = "6360e05b9e34"
down_revision: str | None = "0e286e4a93fb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("ai_settings", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
    )


def downgrade() -> None:
    op.drop_column("users", "ai_settings")
