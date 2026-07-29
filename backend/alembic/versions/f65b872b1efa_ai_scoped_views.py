"""ai_* views — the assistant's read surface, scoped by the database

Revision ID: f65b872b1efa
Revises: 48158cdb14ea

The assistant may write SQL, but only against these views. Each one filters on
`current_setting('app.hotel_id')`, so the tenant boundary lives in the DATABASE,
not in the model's query. That distinction is the whole point: a prompt cannot
argue with a view definition, and a forgotten WHERE clause leaks nothing.

Deliberately NOT exposed:
  users            — carries password_hash. Staff facts come from employees.
  hotels           — other tenants' rows.
  platform_*       — operator config.
  chats/chat_messages — hotel-to-hotel messaging; both sides' data.
  audit_events, ai_usage, assistant_* — internal plumbing, not business data.

Child tables (no hotel_id of their own) scope through their parent, so they
cannot be reached for another hotel by joining sideways.
"""
from alembic import op

from app.core.ai_views import create_statements, drop_statements

revision: str = "f65b872b1efa"
down_revision: str | None = "48158cdb14ea"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for stmt in create_statements():
        op.execute(stmt)


def downgrade() -> None:
    for stmt in drop_statements():
        op.execute(stmt)
