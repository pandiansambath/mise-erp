"""custom_roles — hotel-named job titles pinned to a base archetype

Revision ID: ef4453d8b052
Revises: 4f27e3163bd8
"""
import sqlalchemy as sa

from alembic import op

revision: str = "ef4453d8b052"
down_revision: str | None = "4f27e3163bd8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_roles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("base_role", sa.String(length=50), nullable=False),
        sa.Column("overrides", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_custom_roles_hotel_id", "custom_roles", ["hotel_id"])

    # Nullable, so every existing user keeps working on their base role alone.
    op.add_column("users", sa.Column("custom_role_id", sa.Uuid(), nullable=True))
    op.create_index("ix_users_custom_role_id", "users", ["custom_role_id"])
    op.create_foreign_key(
        "fk_users_custom_role", "users", "custom_roles", ["custom_role_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_users_custom_role", "users", type_="foreignkey")
    op.drop_index("ix_users_custom_role_id", table_name="users")
    op.drop_column("users", "custom_role_id")
    op.drop_index("ix_custom_roles_hotel_id", table_name="custom_roles")
    op.drop_table("custom_roles")
