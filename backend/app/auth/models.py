"""Auth domain models: User + Role."""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
)
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
    # A tablet by the door, not a person. It clocks people in and out and can
    # reach nothing else. Listed last because it is not a rung on the ladder —
    # it is a different kind of thing.
    KIOSK = "KIOSK"


class RoleDefault(Base):
    """What a JOB reaches at THIS hotel.

        "so manager means what and all he can access... super admin can choose
         this... so please don't restrict any, let super admin do anything he
         wants."

    Answering "what can a manager do" once, so every manager inherits it, is
    the difference between a setting and a chore. Per-person editing stays for
    the exceptions; this stops it being the only door.

    `permissions` is the COMPLETE list rather than a diff against the code's
    defaults, deliberately: a hotel that has said what a manager does should not
    have that answer change underneath them the next time we ship a new default.
    """

    __tablename__ = "role_defaults"
    __table_args__ = (UniqueConstraint("hotel_id", "base_role", name="uq_role_default"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    base_role: Mapped[str] = mapped_column(String(32), nullable=False)
    permissions: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class CustomRole(Base):
    """A job title the hotel invented, pinned to one of our base archetypes.

    Owners think in "Kitchen Manager" or "Accounts Assistant", not in our six
    enum names — so they name the role freely. What they cannot do is invent
    the PERMISSIONS: `base_role` fixes the ceiling (see core.rbac.ENVELOPES),
    and `overrides` may only move things inside it. Free-text names are
    friendly; free-text permissions would be a security hole.
    """

    __tablename__ = "custom_roles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hotel_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("hotels.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    # one of Role.* — the archetype whose envelope bounds this role
    base_role: Mapped[str] = mapped_column(String(50), nullable=False)
    # permission -> on/off, applied on top of the archetype's defaults and
    # silently clipped to its envelope
    overrides: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


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
    # Optional hotel-defined job title. When set, `role` still holds the base
    # archetype, so every existing permission check keeps working untouched —
    # the custom role only ever narrows or widens WITHIN that archetype.
    custom_role_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("custom_roles.id", ondelete="SET NULL"), index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # The DineAI operator (us) — a cross-tenant super-flag that unlocks the platform
    # Control Room (manage ALL hotels). False for every normal hotel user.
    is_platform_owner: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Stamped on every successful login — staff visibility + hotel health.
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Real-email era: new OWNER signups must click the emailed link before the
    # app opens. Existing accounts were grandfathered True by the migration.
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # WHO STILL HAS TO VERIFY BEFORE THEY CAN GET IN.
    #
    # "implement this loose for all logins EXCEPT the new hotel registration
    #  login (new hotel definitely need to verify on the spot... else suppose
    #  they give wrong mail id and we didn't verify means it will create so many
    #  real confusion)."
    #
    # Set only where a hotel signs itself up. Everyone else gets in and verifies
    # afterwards — with password-reset and alerts paused until they do, so an
    # unverified address can never become a recovery route.
    verify_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # One pending token at a time per purpose; hashed-equivalent randomness via
    # secrets.token_urlsafe. Cleared once used.
    verify_token: Mapped[str | None] = mapped_column(String(64), index=True)
    reset_token: Mapped[str | None] = mapped_column(String(64), index=True)
    reset_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Per-user email-alert switches: {"job_application": bool, ...}. None/missing
    # keys fall back to notify.ALERT_DEFAULTS — we only store overrides.
    email_prefs: Mapped[dict | None] = mapped_column(JSON)
    # Two-step sign-in: a 6-digit code lands in the inbox on every login.
    twofa_email: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    otp_code: Mapped[str | None] = mapped_column(String(6))
    otp_expires: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    otp_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Permanent-removal tombstone. Set when a Super Admin purges the login: the row
    # stays (so history resolves to "Removed user") but is anonymised, can't sign in,
    # and is hidden from the roster. NULL = a normal, live account.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:  # pragma: no cover
        return f"<User {self.email} ({self.role})>"
