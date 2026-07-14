"""Email verification — verified flag + verify/reset tokens.
Existing users are grandfathered as verified (they predate real email).

Revision ID: f9d0e1f2a3b4
Revises: f8c9d0e1f2a3
Create Date: 2026-07-14
"""
import sqlalchemy as sa

from alembic import op

revision: str = "f9d0e1f2a3b4"
down_revision: str | None = "f8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("users", sa.Column("verify_token", sa.String(64), nullable=True, index=True))
    op.add_column("users", sa.Column("reset_token", sa.String(64), nullable=True, index=True))
    op.add_column("users", sa.Column("reset_expires", sa.DateTime(timezone=True), nullable=True))
    # everyone who already exists keeps working exactly as before
    op.execute("UPDATE users SET email_verified = TRUE")


def downgrade() -> None:
    op.drop_column("users", "reset_expires")
    op.drop_column("users", "reset_token")
    op.drop_column("users", "verify_token")
    op.drop_column("users", "email_verified")
