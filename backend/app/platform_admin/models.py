"""Platform-wide (operator) config — a single row of settings the operator controls
from the Control Room. Currently: plan price overrides. Extensible for more later."""
from sqlalchemy import JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PlatformConfig(Base):
    __tablename__ = "platform_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # plan_key -> display price string (e.g. {"pro": "£89/mo"}). Missing = code default.
    plan_prices: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
