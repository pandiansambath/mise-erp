"""Riders — the hotel's own delivery staff (Ph2b).

NOT ERP users: a rider signs into the lightweight /rider door with phone +
4-6 digit PIN the hotel issues. While on a delivery their phone posts GPS
every few seconds onto this row — that single stream powers the customer's
live map and the kitchen's view.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Rider(Base):
    __tablename__ = "riders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    pin_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # The live beacon — updated every few seconds during an active delivery.
    last_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    last_lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
