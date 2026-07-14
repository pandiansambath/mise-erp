"""Auth & user-management endpoints. User management is hotel-scoped."""
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.deps import get_current_user, require
from app.auth.models import Role, User
from app.auth.schemas import (
    ChangePassword,
    HotelOut,
    LoginRequest,
    MeResponse,
    MeUpdate,
    RegisterHotel,
    TokenResponse,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.core import notify
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.hotels.models import Hotel
from app.platform_admin import features as feat

router = APIRouter(prefix="/auth", tags=["auth"])

# Sensible default currency per country for self-signup.
_CURRENCY_BY_COUNTRY = {"GB": "GBP", "IN": "INR", "US": "USD", "AE": "AED", "EU": "EUR"}


async def _hotel_or_404(db: AsyncSession, hotel_id: uuid.UUID) -> Hotel:
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    return hotel


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = await service.authenticate(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password"
        )
    hotel = await _hotel_or_404(db, user.hotel_id)
    # Suspended hotel → nobody in it can log in (platform operator excepted).
    if not hotel.is_active and not getattr(user, "is_platform_owner", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is suspended. Contact Mise support.",
        )
    if not user.email_verified and not getattr(user, "is_platform_owner", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email first — check your inbox (or resend the link).",
        )
    user.last_login = datetime.now(UTC)
    await db.commit()
    token = create_access_token(subject=str(user.id), role=user.role)
    return TokenResponse(
        access_token=token,
        user=UserOut.model_validate(user),
        hotel=HotelOut.model_validate(hotel),
    )


@router.post("/register-hotel", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_hotel(
    payload: RegisterHotel, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """Public self-signup: create a hotel + its first Super Admin, then log them in."""
    if await service.get_user_by_email(db, payload.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "That email already has an account")
    country = payload.country.upper()
    hotel = Hotel(
        name=payload.hotel_name.strip(),
        country=country,
        city=payload.city,
        base_currency=_CURRENCY_BY_COUNTRY.get(country, "GBP"),
    )
    db.add(hotel)
    await db.flush()
    user = await service.create_user(
        db, payload.email, payload.password, Role.SUPER_ADMIN.value, hotel.id
    )
    await db.refresh(hotel)  # create_user committed; reload before serialising
    # New owners must click the emailed link before the app opens.
    user.email_verified = False
    user.verify_token = secrets.token_urlsafe(32)
    await db.commit()
    verify_url = f"{settings.app_base_url}/verify-email?token={user.verify_token}"
    await notify.send_email(
        payload.email,
        "Confirm your email to open Mise ✉️",
        f"Welcome to Mise, {hotel.name}! Confirm your email to open your kitchen: {verify_url}",
        html=notify.render_email(
            heading=f"One click and you're in, {hotel.name} 🎉",
            intro=(
                "Confirm this is your email and your Mise kitchen opens immediately — "
                "inventory, recipes, live P&L, the lot."
            ),
            cta_label="Confirm email & open Mise",
            cta_url=verify_url,
        ),
    )
    # Welcome email (styled). No-ops without a provider key; on the free Resend tier
    # it only reaches your own verified address until a sending domain is verified.
    await notify.send_email(
        payload.email,
        f"Welcome to Mise, {hotel.name}! 🎉",
        f"Your restaurant '{hotel.name}' is set up on Mise. Sign in to start tracking "
        "every plate and every penny.",
        html=notify.render_email(
            heading=f"Welcome aboard, {hotel.name}! 🎉",
            intro=(
                "Your account is ready. Mise gives you live food-cost, menu margins, "
                "stock, purchasing and UK-compliance tools — all in one place. "
                "Sign in and add your first items to see the money picture light up."
            ),
            rows=[
                ("Restaurant", hotel.name),
                ("Owner login", payload.email),
                ("Currency", hotel.base_currency),
            ],
            cta_label="Open Mise",
            cta_url="http://18.133.95.137/login",
        ),
    )
    token = create_access_token(subject=str(user.id), role=user.role)
    return TokenResponse(
        access_token=token,
        user=UserOut.model_validate(user),
        hotel=HotelOut.model_validate(hotel),
    )


@router.get("/me", response_model=MeResponse)
async def me(
    current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> MeResponse:
    hotel = await _hotel_or_404(db, current.hotel_id)
    return MeResponse(user=UserOut.model_validate(current), hotel=HotelOut.model_validate(hotel))


@router.patch("/me", response_model=MeResponse)
async def update_me(
    payload: MeUpdate,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MeResponse:
    """Set what the Copilot should call you (stored server-side → cross-device)."""
    current.preferred_name = payload.preferred_name.strip()[:60]
    await db.commit()
    await db.refresh(current)
    hotel = await _hotel_or_404(db, current.hotel_id)
    return MeResponse(user=UserOut.model_validate(current), hotel=HotelOut.model_validate(hotel))


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePassword,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Change your own password (requires the current one). No email/infra needed."""
    if payload.new_password == payload.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be different")
    ok = await service.change_password(db, current, payload.current_password, payload.new_password)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require("users:write")),
) -> UserOut:
    if await service.get_user_by_email(db, payload.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
    # Enforce the hotel's plan user limit (grandfathers hotels already over it).
    hotel = await db.get(Hotel, admin.hotel_id)
    if hotel is not None:
        current = len(await service.list_users(db, admin.hotel_id))
        limit = feat.plan_max_users(hotel.plan)
        if current >= limit:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Your {hotel.plan.title()} plan allows {limit} users and you have "
                    f"{current}. Upgrade your plan to add more."
                ),
            )
    # New users join the admin's hotel.
    user = await service.create_user(
        db, payload.email, payload.password, payload.role, admin.hotel_id,
        preferred_name=payload.name,
    )
    return UserOut.model_validate(user)


@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require("users:read")),
) -> list[UserOut]:
    users = await service.list_users(db, admin.hotel_id)
    return [UserOut.model_validate(u) for u in users]


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require("users:write")),
) -> UserOut:
    user = await service.get_user_by_id(db, user_id)
    if user is None or user.hotel_id != admin.hotel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user = await service.update_user(db, user, role=payload.role, is_active=payload.is_active)
    return UserOut.model_validate(user)


# ── real-email flows: verify / resend / forgot / reset ───────────────────────
class VerifyRequest(BaseModel):
    token: str = Field(min_length=16, max_length=64)


@router.post("/verify-email", response_model=TokenResponse)
async def verify_email(payload: VerifyRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """The emailed link lands here: flip verified, clear the token, sign them in."""
    user = (
        await db.execute(select(User).where(User.verify_token == payload.token))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That link is invalid or already used")
    user.email_verified = True
    user.verify_token = None
    user.last_login = datetime.now(UTC)
    await db.commit()
    hotel = await _hotel_or_404(db, user.hotel_id)
    token = create_access_token(subject=str(user.id), role=user.role)
    return TokenResponse(
        access_token=token, user=UserOut.model_validate(user), hotel=HotelOut.model_validate(hotel)
    )


class EmailOnly(BaseModel):
    email: str = Field(min_length=5, max_length=200)


@router.post("/resend-verification")
async def resend_verification(payload: EmailOnly, db: AsyncSession = Depends(get_db)) -> dict:
    """Always answers OK (no account enumeration); sends only when it applies."""
    user = await service.get_user_by_email(db, payload.email.strip().lower())
    if user and not user.email_verified:
        user.verify_token = user.verify_token or secrets.token_urlsafe(32)
        await db.commit()
        verify_url = f"{settings.app_base_url}/verify-email?token={user.verify_token}"
        await notify.send_email(
            user.email,
            "Your Mise verification link ✉️",
            f"Confirm your email to open Mise: {verify_url}",
            html=notify.render_email(
                heading="Here's that link again",
                intro="One click confirms your email and opens your Mise kitchen.",
                cta_label="Confirm email & open Mise",
                cta_url=verify_url,
            ),
        )
    return {"ok": True}


@router.post("/forgot-password")
async def forgot_password(payload: EmailOnly, db: AsyncSession = Depends(get_db)) -> dict:
    """Always answers OK. A real account gets a 60-minute reset link."""
    user = await service.get_user_by_email(db, payload.email.strip().lower())
    if user and user.is_active:
        user.reset_token = secrets.token_urlsafe(32)
        user.reset_expires = datetime.now(UTC) + timedelta(minutes=60)
        await db.commit()
        reset_url = f"{settings.app_base_url}/reset-password?token={user.reset_token}"
        await notify.send_email(
            user.email,
            "Reset your Mise password 🔑",
            f"Choose a new password (link valid for 1 hour): {reset_url}",
            html=notify.render_email(
                heading="Let's get you back in",
                intro=(
                    "Someone (hopefully you) asked to reset this account's password. "
                    "The link works for 1 hour — if it wasn't you, just ignore this."
                ),
                cta_label="Choose a new password",
                cta_url=reset_url,
                accent="#d97742",
            ),
        )
    return {"ok": True}


class ResetRequest(BaseModel):
    token: str = Field(min_length=16, max_length=64)
    password: str = Field(min_length=8, max_length=128)


@router.post("/reset-password")
async def reset_password(payload: ResetRequest, db: AsyncSession = Depends(get_db)) -> dict:
    user = (
        await db.execute(select(User).where(User.reset_token == payload.token))
    ).scalar_one_or_none()
    if not user or not user.reset_expires or user.reset_expires < datetime.now(UTC):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That link is invalid or has expired")
    user.password_hash = hash_password(payload.password)
    user.reset_token = None
    user.reset_expires = None
    user.email_verified = True  # they proved inbox ownership
    await db.commit()
    return {"ok": True, "message": "Password updated — sign in with the new one."}
