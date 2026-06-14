"""Budget targets — one row per hotel; monthly goals compared against actuals."""
import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class BudgetTarget(Base):
    __tablename__ = "budget_targets"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, unique=True, index=True
    )
    monthly_sales: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    food_cost_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    labour_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    net_margin_pct: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
