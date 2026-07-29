"""hotels.timezone — which day a sale, shift or P&L belongs to

Revision ID: 5c78ab0f594f
Revises: f65b872b1efa

Timestamps stay stored in UTC. This column changes how they are READ, so a
hotel switching zone never rewrites its history — the same instants simply fall
into different local days from that point on.

Default Europe/London rather than UTC: every existing hotel is a UK restaurant,
and defaulting them to UTC would silently move their late-evening trade onto the
wrong day for half the year (BST is UTC+1).
"""
import sqlalchemy as sa

from alembic import op

revision: str = "5c78ab0f594f"
down_revision: str | None = "f65b872b1efa"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column(
            "timezone",
            sa.String(length=64),
            nullable=False,
            server_default="Europe/London",
        ),
    )


def downgrade() -> None:
    op.drop_column("hotels", "timezone")
