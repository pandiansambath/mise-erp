"""What the attendance screen may show beyond clocking in and out.

Two switches, set by the owner at the moment they generate the PIN — the one
moment they are already thinking about what that screen is for.

Both default FALSE on purpose. A tablet by the door is read by everyone who
walks past it, and who is on leave today is information some kitchens will not
want on display. Off is the choice you can always reverse; on is not.

Revision ID: 5cf6b0d68f26
Revises: 794cc9d0f1a9
"""
import sqlalchemy as sa
from alembic import op

revision = "5cf6b0d68f26"
down_revision = "794cc9d0f1a9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column("kiosk_show_rota", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "hotels",
        sa.Column("kiosk_show_leave", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("hotels", "kiosk_show_leave")
    op.drop_column("hotels", "kiosk_show_rota")
