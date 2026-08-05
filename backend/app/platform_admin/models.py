"""Platform-wide (operator) config — settings the operator controls from the
Control Room: plan price overrides + broadcast announcements."""
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PlatformConfig(Base):
    __tablename__ = "platform_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    # plan_key -> display price string (e.g. {"pro": "£89/mo"}). Missing = code default.
    plan_prices: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)


class PlatformAnnouncement(Base):
    """Operator broadcast shown as a banner in every hotel's app shell until it
    expires or is deactivated. Dismissal is per-user, client-side."""

    __tablename__ = "platform_announcements"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="info")  # info | warn
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DeletedHotel(Base):
    """One line per restaurant permanently removed.

    NOT a foreign key to `hotels`, and deliberately NOT kept in the hotel's own
    audit log: `purge()` empties `audit_logs` for the hotel it is deleting, so
    a note stored there would be destroyed by the very act it records. A
    deletion ledger has to outlive the deletion.
    """

    __tablename__ = "deleted_hotels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    hotel_name: Mapped[str] = mapped_column(String(160), nullable=False)
    handle: Mapped[str | None] = mapped_column(String(40))
    city: Mapped[str | None] = mapped_column(String(80))
    country: Mapped[str | None] = mapped_column(String(80))
    plan: Mapped[str | None] = mapped_column(String(20))
    deleted_by: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    reason: Mapped[str | None] = mapped_column(Text)
    # Where the copy went. Without it the "archived first" promise cannot be
    # checked afterwards, which is most of what makes it a promise.
    archive_key: Mapped[str | None] = mapped_column(String(255))
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    removed: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
