"""Job portal — postings + applications (public board, hotel hiring pipeline)

Revision ID: f8c9d0e1f2a3
Revises: f7b8c9d0e1f2
Create Date: 2026-07-13
"""
import sqlalchemy as sa

from alembic import op

revision: str = "f8c9d0e1f2a3"
down_revision: str | None = "f7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "job_postings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False, index=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("department", sa.String(100), nullable=True),
        sa.Column("employment_type", sa.String(20), nullable=False, server_default="FULL_TIME"),
        sa.Column("salary_text", sa.String(120), nullable=True),
        sa.Column("location", sa.String(120), nullable=True),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(10), nullable=False, server_default="OPEN", index=True),
        sa.Column("closes_on", sa.Date(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "job_applications",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "posting_id",
            sa.Uuid(),
            sa.ForeignKey("job_postings.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("hotel_id", sa.Uuid(), nullable=False, index=True),
        sa.Column("applicant_name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(200), nullable=False),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("cover_note", sa.Text(), nullable=True),
        sa.Column("resume_key", sa.String(300), nullable=True),
        sa.Column("resume_filename", sa.String(200), nullable=True),
        sa.Column("status", sa.String(15), nullable=False, server_default="NEW", index=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("job_applications")
    op.drop_table("job_postings")
