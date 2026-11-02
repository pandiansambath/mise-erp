"""Expense models: ExpenseCategory + Expense. Hotel-scoped.

Categories are FIXED (rent, salaries, utilities) or VARIABLE (food, packaging…),
which lets the P&L split overheads from cost-of-sales. A category can also be
money SET ASIDE (`is_transfer`) — kept out of profit entirely, whatever its kind.
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
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExpenseKind(str, enum.Enum):
    FIXED = "FIXED"
    VARIABLE = "VARIABLE"


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"
    __table_args__ = (UniqueConstraint("hotel_id", "name", name="uq_expcat_hotel_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    kind: Mapped[str] = mapped_column(
        String(10), nullable=False, default=ExpenseKind.VARIABLE.value
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    #: Money SET ASIDE, not spent — a rent reserve, a chef's salary reserve.
    #:
    #: His August report lists them on page 3 under "Reserves / cash-flow items
    #: — not P&L expense": £8,500 for rent and £1,300 for the chef, moved into a
    #: pot to pay later. Counting them as cost would book the rent twice — once
    #: when it is put aside and again when it is actually paid under "Rent".
    #:
    #: ⚠️ A FLAG, NEVER A NAME MATCH. Guessing from "reserve" in the name is the
    #: silently-wrong pattern this product cannot afford: "Reserve wine stock"
    #: is food, and a reserve someone called "Rent pot" would be missed. The
    #: owner says which categories are set-aside money, and every profit figure
    #: reads this column and nothing else.
    is_transfer: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("expense_categories.id"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)  # gross (incl VAT)
    vat_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    description: Mapped[str | None] = mapped_column(Text)
    vendor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vendors.id"))
    payment_method: Mapped[str] = mapped_column(String(20), nullable=False, default="BANK")
    is_recurring: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    recurrence: Mapped[str | None] = mapped_column(String(10))  # MONTHLY | WEEKLY | None
    # Carry-forward chain: this row was auto-created from that one. The LATEST
    # link in a chain is the one that spawns next month's copy.
    recurred_from: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("expenses.id"))
    # The purchase order this expense came from, when it was posted automatically
    # on receiving stock. Also the idempotency key: a part delivery receives the
    # same PO more than once, and this is how the expense gets UPDATED instead
    # of a second one appearing.
    purchase_order_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="SET NULL"), index=True
    )
    receipt_url: Mapped[str | None] = mapped_column(String(500))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
