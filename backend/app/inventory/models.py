"""Inventory domain models: Item + StockMovement."""
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
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MovementType(str, enum.Enum):
    PURCHASE_IN = "PURCHASE_IN"  # stock arrives from a vendor
    CONSUMPTION = "CONSUMPTION"  # used by the kitchen
    WASTE = "WASTE"  # spoiled / discarded
    RETURN = "RETURN"  # returned to vendor (or back into stock)
    ADJUSTMENT = "ADJUSTMENT"  # manual correction (signed)


# Movement types that ADD stock vs REMOVE stock.
_INFLOW = {MovementType.PURCHASE_IN.value, MovementType.RETURN.value}
_OUTFLOW = {MovementType.CONSUMPTION.value, MovementType.WASTE.value}


class Item(Base):
    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    category: Mapped[str | None] = mapped_column(String(60))
    # Base unit — how the item is STOCKED, COSTED and USED IN RECIPES (kg, g, ml, piece).
    unit: Mapped[str] = mapped_column(String(20), nullable=False)
    # Optional purchase pack: 1 <pack_unit> = <pack_size> <unit> (e.g. 1 box = 5 kg).
    # Lets ordering/receiving buy in packs while stock + recipes stay in the base unit.
    pack_unit: Mapped[str | None] = mapped_column(String(20))
    pack_size: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    # Superseded by ItemPackLevel below, which can nest. Kept and still read as
    # a one-level chain so no existing item has to be re-entered.
    # Comma-separated allergen codes (Natasha's Law). NULL = not reviewed; "" = none.
    allergens: Mapped[str | None] = mapped_column(String(200))
    current_stock: Mapped[Decimal] = mapped_column(
        Numeric(12, 3), nullable=False, default=Decimal("0")
    )
    min_stock_level: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    max_stock_level: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    cost_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    # Weighted-average cost, recalculated on each priced purchase. 4dp for precision.
    average_cost: Mapped[Decimal] = mapped_column(
        Numeric(12, 4), nullable=False, default=Decimal("0")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class StockMovement(Base):
    __tablename__ = "stock_movements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    movement_type: Mapped[str] = mapped_column(String(20), nullable=False)
    # Signed: positive = into stock, negative = out of stock (so SUM = net change).
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    unit_cost: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    # Which vendor this lot came from (set on PURCHASE_IN). NULL = unknown/legacy.
    vendor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vendors.id"), nullable=True, index=True
    )
    reference_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    reference_type: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class VendorItemAlias(Base):
    """A confirmed answer to "which of my items is this supplier's name for?".

    The point is that it COMPOUNDS. Without it, every weekly price list asks the
    same forty questions and people stop importing. With it, the first upload
    teaches the mapping and every later one is exact.

    Scoped to a vendor when known, because suppliers name things differently and
    one shop's shorthand should not answer for another's. A null vendor_id is a
    hotel-wide alias, used only when no vendor-specific one exists.

    `original_text` keeps what was actually written, since `alias_text` is the
    normalised form — when reviewing the list later, "TOMATOS 1KG BOX" is
    recognisable in a way that "tomato" is not.
    """

    __tablename__ = "vendor_item_aliases"
    __table_args__ = (
        UniqueConstraint(
            "hotel_id", "vendor_id", "alias_text", name="uq_alias_hotel_vendor_text"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    vendor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="CASCADE")
    )
    # The normalised form — what lookups compare against.
    alias_text: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    # What the supplier actually wrote, kept so the list is readable by a human.
    original_text: Mapped[str | None] = mapped_column(String(200))
    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ItemPackLevel(Base):
    """One rung of an item's buying chain: 1 of me = `contains` of the rung below.

    Pepper, as he described it:

        position 1   packet     contains 50      -> 50 g          (below = base)
        position 2   small box  contains 30      -> 1 500 g
        position 3   box        contains 10      -> 15 000 g

    A level's size in base units is the product of `contains` from position 1
    up to it. Storing the STEP rather than the total is what lets someone say
    "a box holds ten small boxes" without doing arithmetic — which is the whole
    point, because the person entering this is a chef, not a buyer.
    """

    __tablename__ = "item_pack_levels"
    __table_args__ = (UniqueConstraint("item_id", "position", name="uq_item_pack_position"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    item_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    contains: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
