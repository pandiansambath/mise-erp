"""Order payments (Stripe one-time) + delivery verification (PIN + proof photo).

Revision ID: a6e3ceac091b
Revises: f281d1f9e6b8
Create Date: 2026-07-14
"""
import sqlalchemy as sa

from alembic import op

revision: str = "a6e3ceac091b"
down_revision: str | None = "f281d1f9e6b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("payment_method", sa.String(10), nullable=False, server_default="COD"))
    op.add_column("orders", sa.Column("payment_status", sa.String(10), nullable=False, server_default="UNPAID"))
    op.add_column("orders", sa.Column("stripe_session_id", sa.String(80), nullable=True))
    op.add_column("orders", sa.Column("delivery_pin", sa.String(6), nullable=True))
    op.add_column("orders", sa.Column("proof_key", sa.String(255), nullable=True))


def downgrade() -> None:
    for c in ["proof_key", "delivery_pin", "stripe_session_id", "payment_status", "payment_method"]:
        op.drop_column("orders", c)
