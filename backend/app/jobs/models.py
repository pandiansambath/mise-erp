"""Job portal — hotels post vacancies; the public board lists them; anyone
can apply with a resume. Applications live with the hotel (hotel_id-scoped),
postings are also readable publicly (no auth) via the public router."""
import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class JobStatus(str, enum.Enum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"


class ApplicationStatus(str, enum.Enum):
    NEW = "NEW"
    SHORTLISTED = "SHORTLISTED"
    INTERVIEWED = "INTERVIEWED"
    HIRED = "HIRED"
    REJECTED = "REJECTED"


class JobPosting(Base):
    __tablename__ = "job_postings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    department: Mapped[str | None] = mapped_column(String(100))
    employment_type: Mapped[str] = mapped_column(String(20), nullable=False, default="FULL_TIME")
    salary_text: Mapped[str | None] = mapped_column(String(120))  # "£12.50/hr", "£28k"…
    location: Mapped[str | None] = mapped_column(String(120))  # defaults to the hotel's city
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default=JobStatus.OPEN.value, index=True
    )
    closes_on: Mapped[date | None] = mapped_column(Date)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class JobApplication(Base):
    __tablename__ = "job_applications"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    posting_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("job_postings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    hotel_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    applicant_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40))
    cover_note: Mapped[str | None] = mapped_column(Text)
    resume_key: Mapped[str | None] = mapped_column(String(300))
    resume_filename: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(
        String(15), nullable=False, default=ApplicationStatus.NEW.value, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
