"""Online-ordering models: the public menu + customer orders.

MenuItem is deliberately SEPARATE from Recipe: the public menu is a sales
artefact (name, blurb, price, availability) while recipes are costing
artefacts. A menu item can LINK to a recipe (recipe_id) so margins stay
visible, but hotels can also sell things they never costed (a canned drink).

Order prices are SNAPSHOTTED onto order_items (name + unit price at the time
of ordering) — menus change, history must not.
"""
import enum
import uuid
from datetime import date, datetime, time
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
    Time,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class MenuItem(Base):
    __tablename__ = "menu_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    # What the customer pays. Costing (if recipe-linked) lives on the recipe.
    price: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False, default="Mains")
    emoji: Mapped[str | None] = mapped_column(String(8))
    # Hotel-uploaded dish photo (storage key). Falls back to the bundled library.
    photo_key: Mapped[str | None] = mapped_column(String(255))
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    #: WHY it is or is not on the menu. One boolean was pretending to be four
    #: different facts, and they behave differently:
    #:
    #:   available       on the menu
    #:   out_of_stock    temporarily gone; a person puts it back
    #:   finished_today  gone until tomorrow; CLEARS ITSELF overnight, because
    #:                   "we ran out of biryani" must not still be true Tuesday
    #:   not_served      off the menu but kept, so old orders still name it
    availability: Mapped[str] = mapped_column(String(20), nullable=False, default="available")
    #: The day `finished_today` was set, so it can expire without anybody
    #: remembering to undo it.
    sold_out_on: Mapped[date | None] = mapped_column(Date)
    #: Served only between these, hotel-local. Both NULL = all day.
    serve_from: Mapped[time | None] = mapped_column(Time)
    serve_to: Mapped[time | None] = mapped_column(Time)
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("recipes.id"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DiningTable(Base):
    """One seat in the room, with its own QR.

    "each table will have a separate QR... we don't know how many tables each
     hotel have so we can make it configurable by superadmin."

    `code` is what the QR encodes and `label` is what the staff call it, kept
    apart on purpose: a printed card outlives being renamed from "4" to
    "Terrace 2", and it must keep working when it is.

    The code is RANDOM, not sequential. These cards sit on tables in a public
    room; /t/2 would tell anyone that /t/3 exists, and ordering onto somebody
    else's table is a prank that costs the hotel food.
    """

    __tablename__ = "dining_tables"
    __table_args__ = (
        UniqueConstraint("code", name="uq_dining_table_code"),
        UniqueConstraint("hotel_id", "label", name="uq_dining_table_label"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    code: Mapped[str] = mapped_column(String(16), nullable=False)
    seats: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class OrderStatus(str, enum.Enum):
    NEW = "NEW"                        # just placed — kitchen hasn't seen it
    CONFIRMED = "CONFIRMED"            # kitchen accepted
    PREPARING = "PREPARING"            # on the stove
    READY = "READY"                    # pickup: collect now · delivery: awaiting rider
    OUT_FOR_DELIVERY = "OUT_FOR_DELIVERY"
    COMPLETED = "COMPLETED"            # handed over / delivered
    REJECTED = "REJECTED"              # kitchen said no (busy, out of stock)
    CANCELLED = "CANCELLED"            # customer bailed before confirmation


# The forward moves the kitchen may make from each state.
ORDER_FLOW: dict[str, list[str]] = {
    "NEW": ["CONFIRMED", "REJECTED"],
    "CONFIRMED": ["PREPARING", "REJECTED"],
    "PREPARING": ["READY"],
    "READY": ["OUT_FOR_DELIVERY", "COMPLETED"],
    "OUT_FOR_DELIVERY": ["COMPLETED"],
}


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    # Short human code the customer quotes at the counter ("M-4821").
    code: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    customer_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(30), nullable=False)
    email: Mapped[str | None] = mapped_column(String(200))
    fulfilment: Mapped[str] = mapped_column(String(12), nullable=False, default="PICKUP")
    # Delivery address as typed; lat/lng arrive with the map pin (Phase 1.5).
    address_text: Mapped[str | None] = mapped_column(Text)
    address_lat: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    address_lng: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=OrderStatus.NEW.value, index=True
    )
    # The rider carrying this delivery (assigned by the kitchen on READY).
    rider_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("riders.id"))
    # Which seat this came from. NULL for takeaway and delivery.
    table_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("dining_tables.id", ondelete="SET NULL")
    )
    # "We need someone" — the automated version of waving at a passing waiter,
    # and the thing the whole feature exists to remove. Timestamped rather than
    # a flag so the kitchen screen can show HOW LONG they have been waiting,
    # which is the part that decides who gets attended to next.
    help_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Money: COD (settle at door/counter) or ONLINE (Stripe checkout, test mode).
    payment_method: Mapped[str] = mapped_column(String(10), nullable=False, default="COD")
    payment_status: Mapped[str] = mapped_column(String(10), nullable=False, default="UNPAID")
    stripe_session_id: Mapped[str | None] = mapped_column(String(80))
    # Swiggy-style handover proof: the customer's per-order PIN + doorstep photo.
    delivery_pin: Mapped[str | None] = mapped_column(String(6))
    proof_key: Mapped[str | None] = mapped_column(String(255))
    subtotal: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    delivery_fee: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, default=Decimal("0")
    )
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), onupdate=func.now()
    )

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", lazy="selectin"
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orders.id"), nullable=False, index=True
    )
    menu_item_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("menu_items.id"))
    # Snapshots — the receipt never changes even when the menu does.
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(8, 2), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    line_total: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")
