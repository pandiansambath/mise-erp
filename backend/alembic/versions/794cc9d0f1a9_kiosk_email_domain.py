"""Move kiosk accounts off the .local domain.

`.local` is a reserved special-use name and email-validator refuses it, so
`UserOut.email` (an EmailStr) could not serialise a kiosk account: GET
/auth/me answered 500 for every kiosk session. The PIN was accepted and the
token minted, but the reload could not resolve the session, so the keypad came
straight back — the tablet flow was unusable for anyone not already signed in.

Existing rows have to move with the code, or the accounts already created stay
broken. The lookup is by hotel_id + role, never by address, so rewriting the
domain cannot orphan anything.

Revision ID: 794cc9d0f1a9
Revises: fd3fbdc28c8f
"""
from alembic import op

revision = "794cc9d0f1a9"
down_revision = "fd3fbdc28c8f"
branch_labels = None
depends_on = None

OLD = "@kiosk.dineai.local"
NEW = "@kiosk.dineai.cloud"


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE users
           SET email = REPLACE(email, '{OLD}', '{NEW}')
         WHERE role = 'KIOSK'
           AND email LIKE '%{OLD}'
        """
    )


def downgrade() -> None:
    op.execute(
        f"""
        UPDATE users
           SET email = REPLACE(email, '{NEW}', '{OLD}')
         WHERE role = 'KIOSK'
           AND email LIKE '%{NEW}'
        """
    )
