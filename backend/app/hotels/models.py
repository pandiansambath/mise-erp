"""Hotel (tenant) model — the root of multi-tenancy.

Every domain row (users, items, vendors, recipes) carries a hotel_id and is
scoped to the logged-in user's hotel, so hotels never see each other's data.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Hotel(Base):
    __tablename__ = "hotels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="GB")  # ISO-2
    city: Mapped[str | None] = mapped_column(String(80))
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
