"""Vendor domain models: Vendor + VendorItem (per-vendor item pricing)."""
import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class VendorCategory(str, enum.Enum):
    FOOD = "FOOD"
    BEVERAGE = "BEVERAGE"
    BAR = "BAR"
    UTILITY = "UTILITY"
    SERVICE = "SERVICE"
    PROPERTY = "PROPERTY"


class Vendor(Base):
    __tablename__ = "vendors"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    category: Mapped[str | None] = mapped_column(String(40))
    sub_category: Mapped[str | None] = mapped_column(String(60))
    contact_person: Mapped[str | None] = mapped_column(String(120))
    mobile: Mapped[str | None] = mapped_column(String(30))
    email: Mapped[str | None] = mapped_column(String(255))
    address: Mapped[str | None] = mapped_column(Text)
    vat_number: Mapped[str | None] = mapped_column(String(40))  # UK VAT
    payment_type: Mapped[str | None] = mapped_column(String(20))  # CASH | CREDIT
    payment_frequency: Mapped[str | None] = mapped_column(String(20))  # WEEKLY | MONTHLY | ...
    credit_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    bank_account_no: Mapped[str | None] = mapped_column(String(20))
    bank_sort_code: Mapped[str | None] = mapped_column(String(10))  # XX-XX-XX
    rating: Mapped[Decimal] = mapped_column(Numeric(2, 1), nullable=False, default=Decimal("5.0"))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class VendorItem(Base):
    """A vendor's current price for an item — the data the comparison engine reads."""

    __tablename__ = "vendor_items"
    __table_args__ = (UniqueConstraint("vendor_id", "item_id", name="uq_vendor_item"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    price_per_unit: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    last_updated: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    is_preferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
