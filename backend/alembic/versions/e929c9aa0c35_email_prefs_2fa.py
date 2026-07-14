"""Email-alert preferences + email-OTP two-step sign-in.

Revision ID: e929c9aa0c35
Revises: f9d0e1f2a3b4
Create Date: 2026-07-14
"""
import sqlalchemy as sa

from alembic import op

revision: str = "e929c9aa0c35"
down_revision: str | None = "f9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email_prefs", sa.JSON(), nullable=True))
    op.add_column(
        "users",
        sa.Column("twofa_email", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("users", sa.Column("otp_code", sa.String(6), nullable=True))
    op.add_column("users", sa.Column("otp_expires", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "users",
        sa.Column("otp_attempts", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("users", "otp_attempts")
    op.drop_column("users", "otp_expires")
    op.drop_column("users", "otp_code")
    op.drop_column("users", "twofa_email")
    op.drop_column("users", "email_prefs")
