"""Kitchen indent + purchase order models. Hotel-scoped."""
import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class IndentStatus(str, enum.Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    ORDERED = "ORDERED"


class POStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SENT = "SENT"
    RECEIVED = "RECEIVED"


class Indent(Base):
    __tablename__ = "indents"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    date: Mapped[date] = mapped_column(Date, nullable=False, default=date.today)
    status: Mapped[str] = mapped_column(
        String(10), nullable=False, default=IndentStatus.PENDING.value
    )
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class IndentItem(Base):
    __tablename__ = "indent_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    indent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("indents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id"), nullable=False)
    required_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    # Optional per-line supplier override (the chef/admin picked one for THIS
    # order). None = fall back to the item's preferred vendor, else cheapest.
    vendor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vendors.id"))
    # WHICH of that supplier's forms — their case, or their loose price. They
    # can quote both at rates that are not multiples of each other, so
    # "cheapest" is not always what the person ordering wants: a kitchen that
    # needs two kilos does not want the fifty-kilo case, however good the rate.
    # NULL = let the server pick their cheapest, which is what every line meant
    # before and what most lines should go on meaning.
    pack_level_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("item_pack_levels.id", ondelete="SET NULL")
    )
    notes: Mapped[str | None] = mapped_column(Text)


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    vendor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vendors.id"), nullable=False)
    indent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("indents.id"))
    po_number: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default=POStatus.DRAFT.value)
    total_amount: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )
    expected_delivery: Mapped[date | None] = mapped_column(Date)
    # Set when the PO is received. receive_note explains any short/over delivery
    # (e.g. "vendor out of stock — got 30 of 100") so the difference stays auditable.
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    receive_note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class POItem(Base):
    __tablename__ = "po_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    po_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id"), nullable=False)
    ordered_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    received_qty: Mapped[Decimal] = mapped_column(
        Numeric(12, 3), nullable=False, default=Decimal("0")
    )
    # Four decimals: this is a price per BASE unit now, and £120 for a 15 000 g
    # box is £0.008 a gram. Two decimals would round that up to a penny — a
    # quarter more than it costs, on every gram.
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0")
    )


class Basket(Base):
    """A half-built order, kept on the server so it follows the person.

    It used to live in the browser's localStorage, which is per BROWSER — so a
    basket built on the tablet in the kitchen was invisible on the phone, and a
    private window showed nothing at all. He caught it immediately:

        "if i go to incognito and login same account, see basket is not there...
         i guess u not storing in db — please store in db"

    One row per person, holding the lines as JSON. A basket is a draft, not a
    ledger: it has no history worth querying, it is rewritten wholesale on every
    change, and it disappears the moment it becomes an indent. A table of line
    rows would buy nothing and cost a join.
    """

    __tablename__ = "baskets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    # One basket each. Two people picking for the same kitchen are doing two
    # different jobs, and merging their baskets would lose one of them.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False, unique=True, index=True
    )
    #: [{"item_id": "...", "qty": "2.5", "vendor_id": "..."|null}, ...]
    lines: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
