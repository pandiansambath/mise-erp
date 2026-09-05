"""A hotel's own sign-in page, customisable like its landing page.

    "actually i want thinking like why cant we give a specialised customisable
     login page for subdomain of hotel... let them design the page in setting
     like we did for hotel's customisable landing page. (as of now we're showing
     the same login page of dine ai — no need this) create a super special login
     page (with no register button) and this can be customisable... have as much
     as feature, animation, UI ux, designs so many that the super admin can
     customise."

Same shape as `landing`: a JSON bag on the hotel, empty by default, merged over
sensible defaults at read time. Empty {} means "the standard door", so nothing
changes for a hotel that never opens the settings panel.

Revision ID: 0e286e4a93fb
Revises: 44c82edf249b
"""
import sqlalchemy as sa

from alembic import op

revision: str = "0e286e4a93fb"
down_revision: str | None = "44c82edf249b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hotels",
        sa.Column(
            "login_page",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("hotels", "login_page")
