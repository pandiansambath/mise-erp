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
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
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
    # One row per vendor+item+FORM. A supplier may quote a box AND a loose
    # kilo at rates that are not multiples of each other — the case is cheap
    # because it is a case. Enforced by two PARTIAL unique indexes (migration
    # 40c6a64f0525) rather than a constraint here, because NULL pack_level_id
    # means "loose" and Postgres treats NULLs as distinct: a plain constraint
    # over the triple would allow any number of loose prices per vendor.
    __table_args__ = ()

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # What this price BUYS. NULL = one base unit, which is what every existing
    # row means, so nothing had to be rewritten. Set = one of that pack level.
    #
    # This is the half that makes the chain real: suppliers do not all sell the
    # same shape. Farm2Land sells the box, SK only sells packets. Without this
    # the app had to pretend every vendor quoted per base unit, and Price
    # Comparison was quietly comparing a box price against a packet price.
    pack_level_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("item_pack_levels.id", ondelete="SET NULL"), nullable=True
    )
    price_per_unit: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    last_updated: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    is_preferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text)

    #: How many BASE units THIS vendor's pack holds, when it differs from the
    #: item's own chain. "Some vendor will have 1 bottle = 30 piece, some vendor
    #: will have 1 bottle = 20 piece" — and the chain belongs to the item, so
    #: without this the model could not say it. NULL = use the item's size.
    pack_size_override: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 3), nullable=True
    )


class PriceHistory(Base):
    """Append-only trail of EVERY vendor-price change (item × vendor over time).

    So we never lose a previous price: manual edits, PO receipts and (future) bill
    scans all write a row here → the item price timeline + honest cost history."""

    __tablename__ = "price_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    vendor_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    item_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    old_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))  # None = first-ever price
    new_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # source: manual | po | invoice
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    note: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class VendorPayment(Base):
    """Money paid to a supplier.

    You buy daily and settle weekly, monthly, or every ten days. Between those
    two rhythms sits a balance that nothing in the app could show: it knew what
    every delivery cost and had no idea what had been paid, so "how much do I
    owe Chennai Fresh?" was answerable only on paper.

    Payments are recorded against the VENDOR, not against individual purchase
    orders, because that is how the money actually moves — one transfer covers
    a fortnight of deliveries. Forcing each payment to be split across POs is
    the sort of bookkeeping precision that makes people stop entering anything,
    and the balance is identical either way.

    What is owed is therefore: total of RECEIVED orders, minus total paid. Only
    received, because an order that has not arrived is not yet a debt.
    """

    __tablename__ = "vendor_payments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # CASH matters beyond bookkeeping: a cash payment also leaves the till, so
    # the drawer has to know about it.
    method: Mapped[str] = mapped_column(String(20), nullable=False, default="BANK")
    reference: Mapped[str | None] = mapped_column(String(120))
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

