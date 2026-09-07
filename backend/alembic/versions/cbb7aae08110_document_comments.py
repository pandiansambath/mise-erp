"""Comments on a document request.

    "here i need comment feature. superadmin and staff can comment on that doc.
     suppose anything is missing or needed he can comment and superadmin can
     read and request again nah. keep comment persistent."

A table of its own rather than a reuse. The point of these is that they are
ATTACHED to the request: "this photo is blurred, send another" belongs beside
the photo, not scrolling away in a chat room where tomorrow it is forty messages
up. Six months later, when somebody asks why a document was re-requested three
times, the answer has to sit with the document.
"""
import sqlalchemy as sa

from alembic import op

revision: str = "cbb7aae08110"
down_revision: str | None = "190818a6ac22"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_comments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column(
            "request_id",
            sa.Uuid(),
            sa.ForeignKey("document_requests.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("author_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        # Kept as a name too: the reason a document was rejected outlives the
        # login of whoever rejected it.
        sa.Column("author_name", sa.String(120), nullable=False),
        # Recorded at WRITE time, not derived from the role later — somebody
        # promoted from staff to manager must not retrospectively have been
        # speaking as a manager.
        sa.Column("from_staff", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("document_comments")
