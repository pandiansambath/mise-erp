"""Hotel (tenant) model — the root of multi-tenancy.

Every domain row (users, items, vendors, recipes) carries a hotel_id and is
scoped to the logged-in user's hotel, so hotels never see each other's data.
"""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, DateTime, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.platform_admin.features import feature_enabled


class Hotel(Base):
    __tablename__ = "hotels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="GB")  # ISO-2
    city: Mapped[str | None] = mapped_column(String(80))
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")
    # Attendance policy (configurable by Super Admin):
    # paid break minutes allowed per shift; minutes beyond it are penalised.
    break_allowance_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    break_penalty_per_min: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, default=Decimal("0")
    )
    # Statutory minimum hourly wage floor — payroll rejects rates below it.
    # Configurable per hotel (differs by country/year). UK 2024 default.
    min_hourly_rate: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, default=Decimal("11.44")
    )
    # Uploaded brand logo (storage key). When set, replaces the default Mise mark.
    logo_key: Mapped[str | None] = mapped_column(String(255))
    # Per-hotel feature entitlements (key -> bool). Missing key = default (enabled).
    # Managed by the platform operator from the Control Room.
    features: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    @property
    def has_logo(self) -> bool:
        return bool(self.logo_key)

    def feature_on(self, key: str) -> bool:
        """Whether a feature is enabled for this hotel (defaults to on)."""
        return feature_enabled(self.features, key)
