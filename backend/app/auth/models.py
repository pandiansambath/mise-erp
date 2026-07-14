"""Auth domain models: User + Role."""
import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Role(str, enum.Enum):
    """The 6 roles for NIRAI (PRD names + Cashier for daily sales entry)."""

    SUPER_ADMIN = "SUPER_ADMIN"  # Owner — full access
    MANAGER = "MANAGER"  # Restaurant Manager
    KITCHEN_MANAGER = "KITCHEN_MANAGER"  # Chef / kitchen lead
    ACCOUNTANT = "ACCOUNTANT"  # Payroll, vendor payments, financial reports
    CASHIER = "CASHIER"  # Daily sales & cash entry
    STAFF = "STAFF"  # General staff — own attendance & payslip only


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # What the user likes to be called — the Copilot greets/addresses them by it.
    # Cross-device (stored here, not the browser). Set at onboarding (owner) or from
    # the linked employee's first name for staff logins.
    preferred_name: Mapped[str | None] = mapped_column(String(60))
    role: Mapped[str] = mapped_column(String(50), nullable=False, default=Role.STAFF.value)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # The Mise operator (us) — a cross-tenant super-flag that unlocks the platform
    # Control Room (manage ALL hotels). False for every normal hotel user.
    is_platform_owner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Stamped on every successful login — staff visibility + hotel health.
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Real-email era: new OWNER signups must click the emailed link before the
    # app opens. Existing accounts were grandfathered True by the migration.
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # One pending token at a time per purpose; hashed-equivalent randomness via
    # secrets.token_urlsafe. Cleared once used.
    verify_token: Mapped[str | None] = mapped_column(String(64), index=True)
    reset_token: Mapped[str | None] = mapped_column(String(64), index=True)
    reset_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.email} ({self.role})>"
