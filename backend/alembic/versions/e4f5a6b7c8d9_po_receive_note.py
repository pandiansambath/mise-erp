"""purchase_orders: receive_note + received_at

Revision ID: e4f5a6b7c8d9
Revises: b6c7d8e9f0a1
Create Date: 2026-07-04

Partial receive: a PO can be received with edited quantities (e.g. ordered 100, got
30). We persist a free-text reason + the time it was received so the expected-vs-
received difference is explainable on the received PDF long after the fact.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "e4f5a6b7c8d9"
down_revision: str | None = "b6c7d8e9f0a1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("purchase_orders", sa.Column("receive_note", sa.Text(), nullable=True))
    op.add_column(
        "purchase_orders",
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("purchase_orders", "received_at")
    op.drop_column("purchase_orders", "receive_note")
