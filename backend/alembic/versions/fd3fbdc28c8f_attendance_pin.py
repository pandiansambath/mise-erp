"""A PIN that unlocks the attendance screen.

The tablet by the door no longer needs its own login. A manager opens the
attendance view on any signed-in device, types the restaurant's PIN, and the
tab drops to attendance-only until the PIN is typed again.

Hashed, never stored in the clear — it is short and typed in public, so it is
exactly the kind of secret that gets shoulder-surfed. Hashing it means a
database leak does not hand somebody the door code as well.

Revision ID: fd3fbdc28c8f
Revises: 059be9056234
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "fd3fbdc28c8f"
down_revision: str | None = "059be9056234"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "hotels", sa.Column("attendance_pin_hash", sa.String(length=255), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("hotels", "attendance_pin_hash")
