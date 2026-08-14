"""Auth & user-management endpoints. User management is hotel-scoped."""
import logging
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.site import base_domain
from app.audit import service as audit
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
from app.core import notify, ratelimit
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.hotels.models import Hotel
from app.platform_admin import features as feat

log = logging.getLogger("mise.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

# Sensible default currency per country for self-signup.
_CURRENCY_BY_COUNTRY = {"GB": "GBP", "IN": "INR", "US": "USD", "AE": "AED", "EU": "EUR"}


async def _hotel_or_404(db: AsyncSession, hotel_id: uuid.UUID) -> Hotel:
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    return hotel


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    # Before the password check, so a rejected attempt costs an attacker a slot
    # rather than a bcrypt round.
    ratelimit.guard(request, "login", payload.email)
    user = await service.authenticate(db, payload.email, payload.password)
    if user is None:
        ratelimit.note_failure("login", payload.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password"
        )
    hotel = await _hotel_or_404(db, user.hotel_id)

    # A hotel's own sign-in page opens only for that hotel's people.
    #
    # Without this, every restaurant's subdomain was a working front door to
    # EVERY account: the page looked like theirs, but any DineAI credentials
    # signed you in, and the user would then be looking at their own data on
    # somebody else's branded domain. Confusing at best, and it quietly told
    # each customer that their subdomain is not really theirs.
    #
    # The platform operator is exempt — support has to be able to sign in
    # anywhere to help.
    site = (payload.site or "").strip().lower()
    if site and not getattr(user, "is_platform_owner", False):
        if (hotel.username or "").lower() != site:
            log.info(
                "login refused: wrong site (%s)", site[:40],
                extra={"code": "DINE-B2003"},
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    "This sign-in page belongs to a different restaurant. "
                    "Use your own restaurant's web address, or sign in at "
                    "dineai.cloud."
                ),
            )

    # Suspended hotel → nobody in it can log in (platform operator excepted).
    if not hotel.is_active and not getattr(user, "is_platform_owner", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is suspended. Contact DineAI support.",
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
            f"{user.otp_code} is your DineAI sign-in code",
            f"Your DineAI sign-in code is {user.otp_code}. It expires in 10 minutes. "
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
        permissions=await _effective_for(db, user),
    )


async def _security_login_alert(user: User) -> None:
    """'New sign-in' heads-up — only for users who switched the alert ON."""
    if not notify.wants(user, "security_login"):
        return
    when = datetime.now(UTC).strftime("%d %b %Y, %H:%M UTC")
    notify.fire(
        notify.send_email(
            user.email,
            "New sign-in to your DineAI account",
            f"Your DineAI account was signed in at {when}. If this wasn't you, "
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
        permissions=await _effective_for(db, user),
    )


@router.post("/register-hotel", status_code=status.HTTP_201_CREATED)
async def register_hotel(
    payload: RegisterHotel, request: Request, db: AsyncSession = Depends(get_db)
) -> dict:
    """Public self-signup: create the hotel + its first Super Admin. NO token is
    returned — the session starts from the verification email's link (returning
    one here would let the unverified skip the gate entirely)."""
    # Signup is where spam and card-testing arrive.
    ratelimit.guard(request, "register", payload.email)
    if await service.get_user_by_email(db, payload.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "That email already has an account")
    # Mandatory @handle → their own subdomain, reserved at signup.
    handle = payload.username.strip().lower()
    if not re.match(r"^[a-z0-9_]{3,40}$", handle):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Username must be 3-40 lowercase letters, numbers or underscores",
        )
    if (await db.execute(select(Hotel).where(Hotel.username == handle))).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is already taken")
    country = payload.country.upper()
    plan = payload.plan if feat.is_valid_plan(payload.plan) else feat.DEFAULT_PLAN
    hotel = Hotel(
        name=payload.hotel_name.strip(),
        username=handle,  # their live subdomain from day one
        country=country,
        city=payload.city,
        base_currency=_CURRENCY_BY_COUNTRY.get(country, "GBP"),
        plan=plan,
        features=feat.plan_features(plan),  # the preset shapes their dashboard
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
        f"Welcome to DineAI, {hotel.name} — confirm your email to open ✉️",
        f"Welcome to DineAI, {hotel.name}! Confirm your email to open your kitchen: {verify_url}",
        html=notify.render_email(
            badge="🎉 Welcome to DineAI",
            heading=f"One click and you're in, {hotel.name}",
            intro=(
                "Great restaurants run on great numbers — and yours are about to get "
                "sharper. Live food-cost, menu margins, stock, purchasing and payroll, "
                "all in one place. Confirm this is your email and your kitchen opens "
                "immediately."
            ),
            footnote="Didn't sign up to DineAI? You can safely ignore this email.",
            rows=[
                ("Restaurant", hotel.name),
                ("Owner login", payload.email),
                ("Currency", hotel.base_currency),
            ],
            cta_label="Confirm email & open DineAI",
            cta_url=verify_url,
        ),
    )
    base = base_domain() or "dineai.cloud"
    return {
        "ok": True,
        "message": "Account created — confirm the email we just sent to open your kitchen.",
        "user": UserOut.model_validate(user).model_dump(mode="json"),
        "hotel": HotelOut.model_validate(hotel).model_dump(mode="json"),
        # Their own live front door — shown on the signup success panel.
        "subdomain": f"{handle}.{base}",
        "site_url": f"https://{handle}.{base}",
    }


async def _effective_for(db: AsyncSession, user: User) -> list[str]:
    """Everything this person may do, custom role included.

    Falls back to the base archetype when they hold no custom role, which is
    the common path and costs no extra query.
    """
    from app.auth.deps import effective_permissions
    from app.core.rbac import PERMISSIONS

    custom = await effective_permissions(db, user)
    if custom is not None:
        return custom
    return list(PERMISSIONS.get(user.role, []))


@router.get("/me", response_model=MeResponse)
async def me(
    current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> MeResponse:
    hotel = await _hotel_or_404(db, current.hotel_id)
    return MeResponse(
        user=UserOut.model_validate(current),
        hotel=HotelOut.model_validate(hotel),
        permissions=await _effective_for(db, current),
    )


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
    return MeResponse(
        user=UserOut.model_validate(current),
        hotel=HotelOut.model_validate(hotel),
        permissions=await _effective_for(db, current),
    )


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


# The tablet login is gone.
#
# It existed alongside the PIN and the two together confused everybody,
# including me. He could not sign in with the generated credentials, then found
# /kiosk already open because he still had a session — two mechanisms, two
# failure modes, no benefit. One door now: the PIN, on the restaurant's own
# subdomain. The kiosk ACCOUNT survives as the identity those PIN tokens are
# minted against, which is why the sealed KIOSK role still matters.


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

    # A designed role from ANOTHER restaurant would be a cross-tenant privilege
    # grant — the single worst thing this endpoint could be talked into.
    if payload.custom_role_id is not None:
        from app.auth.models import CustomRole

        cr = await db.get(CustomRole, payload.custom_role_id)
        if cr is None or cr.hotel_id != admin.hotel_id or not cr.is_active:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="No such role"
            )
        # The base archetype must match the role the person holds, or the
        # overrides were clipped against an envelope that no longer applies.
        target_role = payload.role or user.role
        if cr.base_role != target_role:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"“{cr.name}” is built on {cr.base_role.replace('_', ' ').title()}. "
                    f"Set this person to that role first."
                ),
            )

    user = await service.update_user(
        db,
        user,
        role=payload.role,
        is_active=payload.is_active,
        custom_role_id=payload.custom_role_id,
        clear_custom_role=payload.clear_custom_role,
    )
    return UserOut.model_validate(user)


@router.delete("/users/{user_id}", status_code=status.HTTP_200_OK)
async def remove_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require("users:write")),
) -> dict:
    """PERMANENTLY remove a login (Super Admin only). Unlike Deactivate (reversible),
    this anonymises the account, frees the email, destroys the password and hides it
    from the roster forever. History is preserved — past actions show 'Removed user'."""
    if admin.role != Role.SUPER_ADMIN.value:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only a Super Admin can permanently remove a login"
        )
    target = await service.get_user_by_id(db, user_id)
    if target is None or target.hotel_id != admin.hotel_id or target.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if target.is_platform_owner:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "The platform operator account can't be removed"
        )
    if target.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You can't remove your own account")
    if target.role == Role.SUPER_ADMIN.value and (
        await service.count_super_admins(db, admin.hotel_id, exclude_id=target.id) == 0
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Add another Super Admin before removing this one — a hotel must keep at least one.",
        )
    target_id = target.id  # capture before purge commits (expired attrs can't lazy-load)
    removed_email = await service.purge_user(db, target)
    await audit.record(
        db, hotel_id=admin.hotel_id, user=admin, action="user.remove",
        summary=f"Permanently removed login {removed_email}",
        entity_type="user", entity_id=target_id,
    )
    return {"removed": True, "email": removed_email}


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
        access_token=token,
        user=UserOut.model_validate(user),
        hotel=HotelOut.model_validate(hotel),
        permissions=await _effective_for(db, user),
    )


class EmailOnly(BaseModel):
    email: str = Field(min_length=5, max_length=200)


@router.post("/resend-verification")
async def resend_verification(
    payload: EmailOnly, request: Request, db: AsyncSession = Depends(get_db)
) -> dict:
    """Always answers OK (no account enumeration); sends only when it applies."""
    ratelimit.guard(request, "resend_verification", payload.email)
    user = await service.get_user_by_email(db, payload.email.strip().lower())
    if user and not user.email_verified:
        user.verify_token = user.verify_token or secrets.token_urlsafe(32)
        await db.commit()
        verify_url = f"{settings.app_base_url}/verify-email?token={user.verify_token}"
        await notify.send_email(
            user.email,
            "Your DineAI verification link ✉️",
            f"Confirm your email to open DineAI: {verify_url}",
            html=notify.render_email(
                badge="✉️ Verification link",
                heading="Here's that link again",
                intro="One click confirms your email and opens your DineAI kitchen — "
                "your inventory, recipes and live P&L are waiting.",
                footnote="Didn't request this? You can safely ignore it.",
                cta_label="Confirm email & open DineAI",
                cta_url=verify_url,
            ),
        )
    return {"ok": True}


@router.post("/forgot-password")
async def forgot_password(
    payload: EmailOnly, request: Request, db: AsyncSession = Depends(get_db)
) -> dict:
    """Always answers OK. A real account gets a 60-minute reset link."""
    # This sends an email. Unmetered, it is a way to use us to flood someone
    # else's inbox.
    ratelimit.guard(request, "forgot_password", payload.email)
    user = await service.get_user_by_email(db, payload.email.strip().lower())
    if user and user.is_active:
        user.reset_token = secrets.token_urlsafe(32)
        user.reset_expires = datetime.now(UTC) + timedelta(minutes=60)
        await db.commit()
        reset_url = f"{settings.app_base_url}/reset-password?token={user.reset_token}"
        await notify.send_email(
            user.email,
            "Reset your DineAI password 🔑",
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
