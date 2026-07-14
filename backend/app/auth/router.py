"""Auth & user-management endpoints. User management is hotel-scoped."""
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
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
    # Two-step sign-in: password OK → a 6-digit code goes to the inbox and the
    # session only starts at /login-otp. (Platform owners keep the fast door.)
    if user.twofa_email and not getattr(user, "is_platform_owner", False):
        user.otp_code = f"{secrets.randbelow(1_000_000):06d}"
        user.otp_expires = datetime.now(UTC) + timedelta(minutes=10)
        user.otp_attempts = 0
        await db.commit()
        await notify.send_email(
            user.email,
            f"{user.otp_code} is your Mise sign-in code",
            f"Your Mise sign-in code is {user.otp_code}. It expires in 10 minutes. "
            "If this wasn't you, change your password.",
            html=notify.render_email(
                badge="🔐 Two-step sign-in",
                heading="Your sign-in code",
                intro="You're one code away from your kitchen. Enter it on the sign-in "
                "screen and you're in.",
                rows=[("Your code", user.otp_code)],
                footnote="Expires in 10 minutes. Wasn't you? Change your password now — "
                "your account stayed locked without this code.",
            ),
        )
        return JSONResponse({"twofa_required": True})
    user.last_login = datetime.now(UTC)
    await db.commit()
    await _security_login_alert(user)
    token = create_access_token(subject=str(user.id), role=user.role)
    return TokenResponse(
        access_token=token,
        user=UserOut.model_validate(user),
        hotel=HotelOut.model_validate(hotel),
    )


async def _security_login_alert(user: User) -> None:
    """'New sign-in' heads-up — only for users who switched the alert ON."""
    if not notify.wants(user, "security_login"):
        return
    when = datetime.now(UTC).strftime("%d %b %Y, %H:%M UTC")
    notify.fire(
        notify.send_email(
            user.email,
            "New sign-in to your Mise account",
            f"Your Mise account was signed in at {when}. If this wasn't you, "
            "reset your password immediately.",
            html=notify.render_email(
                badge="🛡️ Security",
                heading="New sign-in to your account",
                intro="You asked us to watch the door — here's the knock. If this was "
                "you, carry on; if not, reset your password right away.",
                rows=[("When", when), ("Account", user.email)],
                cta_label="Reset my password",
                cta_url=f"{settings.app_base_url}/forgot-password",
                accent="#d97742",
            ),
        )
    )


class OtpRequest(BaseModel):
    email: str = Field(min_length=5, max_length=200)
    code: str = Field(min_length=6, max_length=6)


@router.post("/login-otp", response_model=TokenResponse)
async def login_otp(payload: OtpRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    """Step 2 of two-step sign-in: the emailed 6-digit code opens the session."""
    user = await service.get_user_by_email(db, payload.email.strip().lower())
    bad = HTTPException(status.HTTP_401_UNAUTHORIZED, "That code is wrong or has expired")
    if (
        not user
        or not user.is_active
        or not user.otp_code
        or not user.otp_expires
        or user.otp_expires < datetime.now(UTC)
    ):
        raise bad
    if not secrets.compare_digest(user.otp_code, payload.code):
        # 5 wrong guesses burns the code — back to the password step.
        user.otp_attempts += 1
        if user.otp_attempts >= 5:
            user.otp_code = None
            user.otp_expires = None
        await db.commit()
        raise bad
    user.otp_code = None
    user.otp_expires = None
    user.otp_attempts = 0
    user.last_login = datetime.now(UTC)
    await db.commit()
    await _security_login_alert(user)
    hotel = await _hotel_or_404(db, user.hotel_id)
    token = create_access_token(subject=str(user.id), role=user.role)
    return TokenResponse(
        access_token=token,
        user=UserOut.model_validate(user),
        hotel=HotelOut.model_validate(hotel),
    )


@router.post("/register-hotel", status_code=status.HTTP_201_CREATED)
async def register_hotel(payload: RegisterHotel, db: AsyncSession = Depends(get_db)) -> dict:
    """Public self-signup: create the hotel + its first Super Admin. NO token is
    returned — the session starts from the verification email's link (returning
    one here would let the unverified skip the gate entirely)."""
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
    # ONE welcome-and-verify email: the confirm button is the door.
    verify_url = f"{settings.app_base_url}/verify-email?token={user.verify_token}"
    await notify.send_email(
        payload.email,
        f"Welcome to Mise, {hotel.name} — confirm your email to open ✉️",
        f"Welcome to Mise, {hotel.name}! Confirm your email to open your kitchen: {verify_url}",
        html=notify.render_email(
            badge="🎉 Welcome to Mise",
            heading=f"One click and you're in, {hotel.name}",
            intro=(
                "Great restaurants run on great numbers — and yours are about to get "
                "sharper. Live food-cost, menu margins, stock, purchasing and payroll, "
                "all in one place. Confirm this is your email and your kitchen opens "
                "immediately."
            ),
            footnote="Didn't sign up to Mise? You can safely ignore this email.",
            rows=[
                ("Restaurant", hotel.name),
                ("Owner login", payload.email),
                ("Currency", hotel.base_currency),
            ],
            cta_label="Confirm email & open Mise",
            cta_url=verify_url,
        ),
    )
    return {
        "ok": True,
        "message": "Account created — confirm the email we just sent to open your kitchen.",
        "user": UserOut.model_validate(user).model_dump(mode="json"),
        "hotel": HotelOut.model_validate(hotel).model_dump(mode="json"),
    }


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
                badge="✉️ Verification link",
                heading="Here's that link again",
                intro="One click confirms your email and opens your Mise kitchen — "
                "your inventory, recipes and live P&L are waiting.",
                footnote="Didn't request this? You can safely ignore it.",
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
                badge="🔑 Password reset",
                heading="Let's get you back in",
                intro=(
                    "Someone (hopefully you) asked to reset this account's password. "
                    "One click, choose a new one, and you're back at the pass."
                ),
                footnote="The link works for 1 hour. If this wasn't you, "
                "just ignore this email — your password stays unchanged.",
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


# ── Settings → Email alerts & two-step sign-in ────────────────────────────────
class NotificationPatch(BaseModel):
    prefs: dict[str, bool] | None = None
    twofa_email: bool | None = None


def _merged_prefs(user: User) -> dict[str, bool]:
    stored = user.email_prefs or {}
    return {k: bool(stored.get(k, default)) for k, default in notify.ALERT_DEFAULTS.items()}


@router.get("/me/notifications")
async def get_notifications(current: User = Depends(get_current_user)) -> dict:
    """The user's email-alert switches (merged with defaults) + 2FA state."""
    return {"prefs": _merged_prefs(current), "twofa_email": current.twofa_email}


@router.patch("/me/notifications")
async def patch_notifications(
    payload: NotificationPatch,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if payload.prefs is not None:
        unknown = set(payload.prefs) - set(notify.ALERT_DEFAULTS)
        if unknown:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Unknown alert keys: {', '.join(sorted(unknown))}",
            )
        merged = dict(current.email_prefs or {})
        merged.update(payload.prefs)
        current.email_prefs = merged
    if payload.twofa_email is not None:
        current.twofa_email = payload.twofa_email
        if not payload.twofa_email:  # switching OFF clears any pending code
            current.otp_code = None
            current.otp_expires = None
    await db.commit()
    await db.refresh(current)
    return {"prefs": _merged_prefs(current), "twofa_email": current.twofa_email}
