"""Saved party-order quotes. Prices are FROZEN at confirm time (snapshotted per
line) so a quote a customer was given never silently changes — and once it expires
it becomes read-only. Hotel-scoped."""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PartyQuote(Base):
    __tablename__ = "party_quotes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    customer: Mapped[str | None] = mapped_column(String(120))
    event_date: Mapped[date | None] = mapped_column(Date)
    # Editable until this date; after it the quote is locked (frozen prices, view-only).
    valid_until: Mapped[date | None] = mapped_column(Date)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="GBP ")
    total_price: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    total_cost: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    lines: Mapped[list["PartyQuoteLine"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="PartyQuoteLine.id"
    )


class PartyQuoteLine(Base):
    __tablename__ = "party_quote_lines"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    quote_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("party_quotes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Kept loose (no FK) so deleting a recipe never corrupts an old quote's history.
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    name: Mapped[str] = mapped_column(String(120), nullable=False)  # frozen dish name
    qty: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))  # frozen; None = no price
    unit_cost: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
