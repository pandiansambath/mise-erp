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
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
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
    recipe_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("recipes.id"))
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
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
