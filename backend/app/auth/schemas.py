"""Pydantic request/response schemas for auth & user management."""
import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.auth.models import Role

_VALID_ROLES = {r.value for r in Role}


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


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


class MeUpdate(BaseModel):
    """A user setting what the Copilot should call them (cross-device)."""
    preferred_name: str = Field(min_length=1, max_length=60)


class HotelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    country: str
    city: str | None
    base_currency: str
    break_allowance_minutes: int = 0
    break_penalty_per_min: Decimal = Decimal("0")
    min_hourly_rate: Decimal = Decimal("11.44")
    plan: str = "pro"
    has_logo: bool = False
    features: dict = Field(default_factory=dict)


class HotelUpdate(BaseModel):
    """Super-admin tweaks to the hotel (e.g. attendance break policy)."""
    name: str | None = Field(default=None, min_length=1, max_length=120)
    city: str | None = None
    break_allowance_minutes: int | None = Field(default=None, ge=0, le=600)
    break_penalty_per_min: Decimal | None = Field(default=None, ge=0)
    min_hourly_rate: Decimal | None = Field(default=None, ge=0)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    hotel: HotelOut


class MeResponse(BaseModel):
    user: UserOut
    hotel: HotelOut


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

    @field_validator("role")
    @classmethod
    def role_must_be_valid(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_ROLES:
            raise ValueError(f"role must be one of {sorted(_VALID_ROLES)}")
        return v
