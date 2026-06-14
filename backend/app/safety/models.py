"""Food-safety log — temperature readings + daily cleaning/opening/closing checks.
A single flexible row covers both, so the EHO audit pack is one timeline."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SafetyLog(Base):
    __tablename__ = "safety_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hotels.id"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # TEMP | CHECK
    label: Mapped[str] = mapped_column(String(120), nullable=False)  # appliance / task
    reading: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))  # °C for TEMP
    status: Mapped[str] = mapped_column(String(10), nullable=False)  # OK | FAIL | DONE
    notes: Mapped[str | None] = mapped_column(Text)
    logged_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
