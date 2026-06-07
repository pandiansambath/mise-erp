"""Inventory domain models: Item + StockMovement."""
import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
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
    unit: Mapped[str] = mapped_column(String(20), nullable=False)  # kg, litre, piece, box, bag
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
    reference_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    reference_type: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
