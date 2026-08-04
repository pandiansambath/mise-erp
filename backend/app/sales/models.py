"""Daily sales & cash models: SalesChannel, DailySales, SalesLine.

Channels are per-hotel and configurable (each hotel sets its own commission %),
so the gross→commission→net split is correct for that restaurant.
"""
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


class PaymentMethod(str, enum.Enum):
    CASH = "CASH"
    CARD = "CARD"
    ONLINE = "ONLINE"  # delivery apps pay out by bank transfer / online
    BANK = "BANK"


class SalesChannel(Base):
    __tablename__ = "sales_channels"
    __table_args__ = (UniqueConstraint("hotel_id", "name", name="uq_channel_hotel_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    commission_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("0")
    )
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DailySales(Base):
    """One per hotel per day — the cash header; channel amounts live in SalesLine."""

    __tablename__ = "daily_sales"
    __table_args__ = (UniqueConstraint("hotel_id", "date", name="uq_dailysales_hotel_date"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False)
    opening_cash: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    cash_counted: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))  # physical count at close
    # When the drawer was closed, and whether a human did it. A day left open
    # is closed automatically after midnight so the running total cannot drift
    # forward forever, but an auto-close is a GUESS (it assumes the expected
    # figure) and must be visibly distinguishable from a real count.
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    auto_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    entered_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SalesLine(Base):
    __tablename__ = "sales_lines"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    daily_sales_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("daily_sales.id", ondelete="CASCADE"), nullable=False, index=True
    )
    channel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sales_channels.id"), nullable=False)
    gross_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(10), nullable=False, default="CARD")
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DishSale(Base):
    """How many of a dish (recipe) sold on a date — the manual bridge that unlocks
    menu engineering (popularity x margin) and theoretical food cost without a POS."""

    __tablename__ = "dish_sales"
    __table_args__ = (
        UniqueConstraint("hotel_id", "recipe_id", "date", name="uq_dishsale_hotel_recipe_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("hotels.id"), nullable=False, index=True)
    recipe_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    qty_sold: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class CashEvent(Base):
    """Every change to a day's cash figures, kept forever.

    Cash is the one thing in this system nobody can reconstruct from anywhere
    else: if a closing figure is edited three days later, the only way to answer
    "who changed it, from what, and why" is to have written it down at the time.

    So this is append-only. Rows are never updated or deleted, and a correction
    is another row rather than an edit — an audit trail you can rewrite is not
    an audit trail.
    """

    __tablename__ = "cash_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    # The BUSINESS day this touched, not the day it was typed — those differ
    # exactly when someone corrects the past, which is when this matters most.
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    field: Mapped[str] = mapped_column(String(20), nullable=False)  # opening_cash | cash_counted
    old_value: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    new_value: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    reason: Mapped[str | None] = mapped_column(Text)
    # "auto" for the midnight close, otherwise the user who did it.
    changed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    source: Mapped[str] = mapped_column(String(12), nullable=False, default="user")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PettyCash(Base):
    """Money that left the till in someone's hand, and what came back.

    A staff member takes 50 for greens, spends 10, returns 40. Until they
    return, the drawer is 50 light and no amount of counting will balance —
    which is exactly the moment people conclude the software is wrong.

    Three amounts rather than one because they are known at DIFFERENT TIMES:
    `taken` at the moment it leaves, `spent` and `returned` when they come back.
    A single "amount" column would force a guess at the start and quietly hide
    the difference.
    """

    __tablename__ = "petty_cash"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    taken_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    spent_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    returned_amount: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    purpose: Mapped[str | None] = mapped_column(Text)
    # Free text, not a staff FK: the person who runs out for greens is often
    # not on payroll, and forcing a match would stop the record being made.
    taken_by: Mapped[str | None] = mapped_column(String(120))
    # OPEN until settled. Only settled rows can balance the drawer.
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="OPEN")
    # Set when settling creates the matching expense, so the spend is counted
    # once as an expense and once against the drawer — never twice as either.
    expense_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("expenses.id"))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
