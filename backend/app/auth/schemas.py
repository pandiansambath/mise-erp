"""Pydantic request/response schemas for auth & user management."""
import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.auth.models import Role

# KIOSK is deliberately excluded: it is a device account, created only by the
# kiosk endpoint. Letting it be set from the ordinary role dropdown would mean
# a real person could be demoted into a shared tablet identity — or, worse,
# that somebody could hand a human the tablet's sealed permissions and wonder
# later why the audit trail says a wall screen approved a payroll run.
_VALID_ROLES = {r.value for r in Role if r is not Role.KIOSK}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # The hotel subdomain the sign-in page was served from, when there was one.
    # A door on <handle>.dineai.cloud belongs to THAT restaurant, so it must not
    # open for anybody else's staff. Sent by the client but ENFORCED here — a
    # client-side check is a UI nicety, not a boundary.
    site: str | None = None


class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)  # bcrypt hard limit is 72 bytes


class RegisterHotel(BaseModel):
    """Public self-signup: creates a new hotel + its first Super Admin."""
    hotel_name: str = Field(min_length=1, max_length=120)
    # The @handle → <username>.dineai.cloud. Mandatory now: every new hotel gets
    # its own live subdomain the moment it signs up.
    username: str = Field(min_length=3, max_length=40)
    country: str = Field(default="GB", min_length=2, max_length=2)
    city: str | None = None
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    # Chosen at signup; shapes the dashboard (validated against the plan registry).
    plan: str = "pro"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: EmailStr
    role: str
    is_active: bool
    email_verified: bool = True
    preferred_name: str | None = None
    is_platform_owner: bool = False
    last_login: datetime | None = None
    # The designed role, if any. Without this the staff list can only ever show
    # the archetype, so "Kitchen Manager (view-only payroll)" would silently
    # display as plain "Manager".
    custom_role_id: uuid.UUID | None = None


class MeUpdate(BaseModel):
    """A user setting what the Copilot should call them (cross-device)."""
    preferred_name: str = Field(min_length=1, max_length=60)


class HotelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    username: str | None = None  # the @handle → <username>.dineai.cloud
    country: str
    city: str | None
    base_currency: str
    # Never exposed before — which is exactly why the kiosk clock fell back to
    # the browser's zone and showed Asia/Calcutta for a London restaurant.
    timezone: str = "Europe/London"
    theme: str | None = None
    break_allowance_minutes: int = 0
    break_penalty_per_min: Decimal = Decimal("0")
    min_hourly_rate: Decimal = Decimal("11.44")
    plan: str = "pro"
    has_logo: bool = False
    features: dict = Field(default_factory=dict)
    landing: dict = Field(default_factory=dict)  # customizable public-page config
    login_page: dict = Field(default_factory=dict)  # customizable staff sign-in door
    #: Display taste — PDF grouping, decimal places, whether receiving posts an
    #: expense. Sent so Settings can show what is actually saved rather than
    #: falling back to the defaults every time it loads.
    prefs: dict = Field(default_factory=dict)


class HotelUpdate(BaseModel):
    # Saved for the whole restaurant, so devices the owner never signs into
    # (the wall tablet) can look the way they chose.
    theme: str | None = None
    """Super-admin tweaks to the hotel (e.g. attendance break policy)."""
    name: str | None = Field(default=None, min_length=1, max_length=120)
    city: str | None = None
    break_allowance_minutes: int | None = Field(default=None, ge=0, le=600)
    break_penalty_per_min: Decimal | None = Field(default=None, ge=0)
    min_hourly_rate: Decimal | None = Field(default=None, ge=0)
    landing: dict | None = None  # customizable public-page config (tagline/about/accent/…)
    login_page: dict | None = None  # customizable staff sign-in door
    # IANA zone. Validated against the offered list rather than accepted freely:
    # a typo here silently shifts which DAY every sale and shift belongs to.
    timezone: str | None = None
    # Display preferences — how PDFs group, how many decimals a number shows.
    # MERGED into whatever is stored, not swapped for it: sending one key must
    # not silently clear the others.
    prefs: dict | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    hotel: HotelOut
    #: What this person may do, sent at sign-in so the very first screen is
    #: already correct rather than waiting for /me.
    permissions: list[str] = []


class MeResponse(BaseModel):
    user: UserOut
    hotel: HotelOut
    #: What this person can ACTUALLY do, custom role and all.
    #:
    #: The client used to keep its own hardcoded copy of the permission matrix,
    #: keyed on the base role name — so it knew nothing about a custom role, and
    #: it had already drifted from the server (a MANAGER could write expenses on
    #: the backend while the client's list did not mention expenses at all). The
    #: result is the bug he hit: he granted expenses to a role, assigned it, and
    #: the section never appeared, because the only thing deciding what to show
    #: was a stale copy that had never heard of his role.
    #:
    #: Now the server says. One source of truth, and it cannot drift.
    permissions: list[str] = []


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)  # bcrypt hard limit is 72 bytes
    role: str
    name: str | None = Field(default=None, max_length=60)  # what to call them (optional)

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: str) -> str:
        if v not in _VALID_ROLES:
            raise ValueError(f"role must be one of {sorted(_VALID_ROLES)}")
        return v


class UserUpdate(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    # Which designed role this person holds. Explicitly nullable so clearing it
    # is expressible — "back to the plain archetype" has to be a thing you can
    # say, or a custom role could never be taken away.
    custom_role_id: uuid.UUID | None = None
    # Distinguishes "leave it alone" from "clear it", which `None` alone
    # cannot: every PATCH omits most fields.
    clear_custom_role: bool = False

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_ROLES:
            raise ValueError(f"role must be one of {sorted(_VALID_ROLES)}")
        return v
