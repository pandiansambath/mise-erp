"""hotels: min_hourly_rate (configurable minimum wage)

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-07-07

The statutory minimum wage differs by country/year, so each hotel sets its own
floor. Payroll blocks any hourly rate below it. Defaults to the UK 2024 rate.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "c8d9e0f1a2b3"
down_revision: str | None = "b7c8d9e0f1a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column(
            "min_hourly_rate", sa.Numeric(8, 2), nullable=False, server_default="11.44"
        ),
    )


def downgrade() -> None:
    op.drop_column("hotels", "min_hourly_rate")
