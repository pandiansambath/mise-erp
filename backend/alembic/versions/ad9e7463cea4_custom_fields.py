"""custom fields + the ready-made field marketplace, for staff AND suppliers

    "have a customisation button like — what if super admin wants one field
     like he wants to get staff's address... also from our side we give one
     more option, like ready-made field marketplace."
    "not only for employee field, but also for vendor page — here also we're
     collecting vendor details."

A restaurant keeps things no schema can predict: a locker number, a rep's
mobile, a share code, whose van it is. Without somewhere to put them they end
up in a free-text "notes" box that nothing can search, sort or warn on.

`custom_fields` holds the DEFINITIONS. The VALUES go in a JSONB column on the
record itself — one row, one SELECT, no pivot to render a form. The trade is
that a value whose definition is hidden becomes an unreferenced key in the
JSON, which is deliberate: hiding a field must not destroy what people typed,
and re-adding it brings the data straight back.

Revision ID: ad9e7463cea4
Revises: a2872869612a
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "ad9e7463cea4"
down_revision: str | None = "a2872869612a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_fields",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column("entity", sa.String(20), nullable=False),
        sa.Column("key", sa.String(60), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("type", sa.String(20), nullable=False, server_default="text"),
        sa.Column("group", sa.String(60)),
        sa.Column("hint", sa.Text()),
        sa.Column("options", sa.Text()),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("expires", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("from_catalogue", sa.String(60)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # One hotel cannot keep the same key twice on the same kind of record.
        # Scoped to the entity too, so "notes" on a supplier and "notes" on a
        # member of staff are different fields — different forms, no reason one
        # should block the other.
        sa.UniqueConstraint("hotel_id", "entity", "key", name="uq_custom_field_key"),
    )
    op.create_index(
        "ix_custom_fields_hotel_entity", "custom_fields", ["hotel_id", "entity"]
    )

    # The value side. `server_default` matters: without it every EXISTING row
    # gets NULL, and the API would then have to treat "no custom values yet"
    # and "this column is null" as separate cases forever.
    for table in ("employees", "vendors"):
        op.add_column(
            table,
            sa.Column(
                "custom",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
        )


def downgrade() -> None:
    for table in ("employees", "vendors"):
        op.drop_column(table, "custom")
    op.drop_index("ix_custom_fields_hotel_entity", table_name="custom_fields")
    op.drop_table("custom_fields")
