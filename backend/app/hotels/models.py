"""Hotel (tenant) model — the root of multi-tenancy.

Every domain row (users, items, vendors, recipes) carries a hotel_id and is
scoped to the logged-in user's hotel, so hotels never see each other's data.
"""
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, Integer, Numeric, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.platform_admin.features import feature_enabled


class Hotel(Base):
    __tablename__ = "hotels"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Public @handle for the hotel-to-hotel network (global search + chat). Unique.
    username: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)
    country: Mapped[str] = mapped_column(String(2), nullable=False, default="GB")  # ISO-2
    city: Mapped[str | None] = mapped_column(String(80))
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False, default="GBP")
    # Attendance policy (configurable by Super Admin):
    # paid break minutes allowed per shift; minutes beyond it are penalised.
    break_allowance_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    break_penalty_per_min: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, default=Decimal("0")
    )
    # Statutory minimum hourly wage floor — payroll rejects rates below it.
    # Configurable per hotel (differs by country/year). UK 2024 default.
    min_hourly_rate: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, default=Decimal("11.44")
    )
    # Uploaded brand logo (storage key). When set, replaces the default DineAI mark.
    logo_key: Mapped[str | None] = mapped_column(String(255))
    # Per-hotel feature entitlements (key -> bool). Missing key = default (enabled).
    # Managed by the platform operator from the Control Room.
    features: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Customizable public landing page shown at <username>.dineai.cloud
    # (tagline/about/quote/accent/theme/show_order). Empty {} = sensible defaults.
    landing: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Their own SIGN-IN page at the same subdomain — a different job from the
    # landing page, so a different bag. The landing page sells to a diner; this
    # one is the staff door, and it is the first thing their team sees every
    # shift. Empty {} = the standard DineAI door, so a hotel that never opens
    # the panel is unaffected.
    login_page: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default="{}"
    )

    #: How this restaurant wants its numbers and its paperwork. Taste, not
    #: entitlement — `features` decides what they may use, `prefs` decides how
    #: it looks. Keys currently read:
    #:   pdf_group_by    "category" | "none"   group order/stock PDFs
    #:   qty_decimals    int 0-3               places on a quantity
    #:   money_decimals  int 0-4               places on a price
    prefs: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    # Subscription plan (starter | pro | enterprise) — sets the feature preset + limits.
    plan: Mapped[str] = mapped_column(String(20), nullable=False, default="pro")
    # Stripe billing (test mode): who this hotel is at Stripe + where the
    # subscription stands. "free" = never subscribed (grandfathered/testing).
    stripe_customer_id: Mapped[str | None] = mapped_column(String(64), index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(64))
    subscription_status: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    # When a trial ends. Null = not on trial. Kept as a date on the hotel rather
    # than inferred from Stripe so a trial works before anyone has paid, and so
    # expiry is answerable without a network call.
    trial_ends_on: Mapped[date | None] = mapped_column(Date)
    # Which trial end date we have already warned about. Stops the daily
    # reminder job emailing the same hotel every day for three days running.
    trial_reminder_sent_on: Mapped[date | None] = mapped_column(Date)
    # IANA zone (e.g. "Europe/London", "Asia/Kolkata"). Decides which DAY a sale,
    # a shift or a P&L belongs to — not just how a time is printed. Timestamps
    # stay stored in UTC; this changes how they are read. See core.timezones.
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Europe/London")
    # Internal/comped account (our own test hotels, a demo, a goodwill month).
    # Full access, never billed, and EXCLUDED from revenue reporting — otherwise
    # your own test accounts quietly inflate MRR and you trust a wrong number.
    is_comp: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Optional per-hotel AI allowance overrides. Null = use the plan's numbers.
    ai_daily_override: Mapped[int | None] = mapped_column(Integer)
    ai_monthly_override: Mapped[int | None] = mapped_column(Integer)
    # Online ordering (Ph2a): the prep estimate customers see, and the kitchen's
    # busy-mode switch (paused = the public page shows closed, orders refused).
    prep_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=20)
    ordering_paused: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Delivery economics (Ph3): flat fee added to delivery orders + basket floor.
    delivery_fee: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, default=Decimal("0")
    )
    delivery_min_order: Mapped[Decimal] = mapped_column(
        Numeric(8, 2), nullable=False, default=Decimal("0")
    )
    # The door code for the attendance screen. Hashed, never stored in the
    # clear: it is short and typed in public, so it is exactly the kind of
    # secret that gets watched over a shoulder — a database leak must not hand
    # somebody the code as well.
    attendance_pin_hash: Mapped[str | None] = mapped_column(String(255))
    # What the wall tablet is allowed to show beyond clocking in and out.
    #
    # Decided by the owner when they generate the PIN, because that is the one
    # moment they are already thinking about what this screen is for. Both
    # default OFF: a screen by the door is seen by everyone who walks past,
    # and today's rota is more information than some kitchens want on display.
    kiosk_show_rota: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    kiosk_show_leave: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # What the wall tablet LOOKS like. Null means "dark", which is the safe
    # default for a screen that lives in a kitchen.
    #
    # It is stored per hotel rather than read from the browser because the
    # tablet is a different browser from the owner's — a theme kept in
    # localStorage would never reach it.
    kiosk_theme: Mapped[str | None] = mapped_column(String(24))
    # The restaurant's own theme, kept in the DATABASE rather than in each
    # browser's localStorage.
    #
    # localStorage is per browser, so the wall tablet — a different device
    # entirely — could never see what the owner picked. That is why the kiosk
    # kept coming up green while his dashboard was burgundy. Anything that has
    # to look the same on a device the owner has never signed into has to live
    # here.
    theme: Mapped[str | None] = mapped_column(String(24))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    @property
    def has_logo(self) -> bool:
        return bool(self.logo_key)

    def feature_on(self, key: str) -> bool:
        """Whether a feature is enabled for this hotel (defaults to on)."""
        return feature_enabled(self.features, key)
