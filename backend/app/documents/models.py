"""Document model — file metadata + expiry tracking. Hotel-scoped."""
import enum
import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DocType(str, enum.Enum):
    EMPLOYEE_DOC = "EMPLOYEE_DOC"
    VENDOR_CONTRACT = "VENDOR_CONTRACT"
    LICENSE = "LICENSE"
    INSURANCE = "INSURANCE"
    UTILITY_BILL = "UTILITY_BILL"
    OTHER = "OTHER"


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    doc_type: Mapped[str] = mapped_column(String(30), nullable=False, default=DocType.OTHER.value)
    related_entity_type: Mapped[str | None] = mapped_column(String(20))  # employee|vendor|system
    related_entity_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    expiry_date: Mapped[date | None] = mapped_column(Date, index=True)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(120))
    file_size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
