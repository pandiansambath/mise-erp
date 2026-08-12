"""FastAPI dependencies: current-user resolution and permission guards."""
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.service import get_user_by_id
from app.core import logging_setup, monitoring
from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import has_permission
from app.core.security import create_access_token, decode_token
from app.hotels import access
from app.hotels.models import Hotel

bearer_scheme = HTTPBearer(auto_error=True)

_CREDENTIALS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    response: Response,
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise _CREDENTIALS_EXC
    user = await get_user_by_id(db, payload["sub"])
    if user is None or not user.is_active:
        raise _CREDENTIALS_EXC
    # Operator "view as hotel" tokens are read-only; require() enforces it.
    user.is_impersonated_session = bool(payload.get("imp"))  # transient, not persisted
    # Identify the caller for the rest of the request. Without this every log
    # line reads "hotel=-", which defeats the point of having the field: support
    # cannot filter to one customer. Uses the id here because the handle would
    # cost a query on every authenticated call; require() upgrades it below.
    logging_setup.bind(hotel=str(user.hotel_id), user=user.email)
    monitoring.note_hotel(user.hotel_id)
    _maybe_renew(response, payload, user)
    return user


def _maybe_renew(response: Response, payload: dict, user: User) -> None:
    """Keep a session alive while it is being used.

    A token lasted eight hours and was never renewed, so anyone who left the app
    open across a shift came back to "could not load purchasing data", and a
    refresh signed them out — his report, exactly:

        "I move from this page to any other page and after sometime if I come
         back... 'could not load purchasing data'. Then if I refresh, site
         logged out and I login again."

    Nobody should be signed out while they are working. So once a token is past
    the halfway point of its life, a fresh one rides back on the response and
    the browser swaps it in. Someone using the app all day is never logged out;
    someone who walks away still expires on schedule.

    Deliberately NOT renewed: impersonation tokens. An operator viewing a hotel
    gets the window they were given and no more.
    """
    if payload.get("imp"):
        return
    exp = payload.get("exp")
    if not exp:
        return
    try:
        remaining = datetime.fromtimestamp(float(exp), UTC) - datetime.now(UTC)
    except (TypeError, ValueError, OSError):
        return
    half = timedelta(minutes=settings.access_token_expire_minutes) / 2
    if remaining > half:
        return
    response.headers["X-Renewed-Token"] = create_access_token(str(user.id), user.role)
    # So a browser can actually read it — a cross-origin response hides every
    # header that is not explicitly exposed, and this one is served from a
    # different origin than the page in every deployment we have.
    response.headers["Access-Control-Expose-Headers"] = "X-Renewed-Token"


async def effective_permissions(db: AsyncSession, user: User) -> list[str] | None:
    """This user's permissions once their custom role is taken into account.

    Returns None when they have no custom role, meaning "just use the base
    archetype" — so the common path costs no extra query.
    """
    crid = getattr(user, "custom_role_id", None)
    if not crid:
        return None
    from app.auth.models import CustomRole
    from app.core.rbac import resolve_permissions

    cr = await db.get(CustomRole, crid)
    # A deleted or deactivated custom role must fall back to the BASE archetype,
    # never to "allow" — losing the row must never widen someone's access.
    if cr is None or not cr.is_active or cr.hotel_id != user.hotel_id:
        return None
    return resolve_permissions(cr.base_role or user.role, cr.overrides or {})


def require(permission: str) -> Callable[..., Coroutine[Any, Any, User]]:
    """Dependency factory enforcing a single permission string."""

    async def checker(
        user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
    ) -> User:
        if getattr(user, "is_impersonated_session", False) and not (
            permission.endswith(":read") or permission.endswith(":self")
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Read-only support view - changes are disabled while impersonating.",
            )
        granted = await effective_permissions(db, user)
        if granted is None:
            allowed = has_permission(user.role, permission)
        else:
            # a ":write" grant still implies ":read" on the same module, exactly
            # as it does for base roles — otherwise custom roles would behave
            # subtly differently from the archetypes they are built on
            module = permission.rsplit(":", 1)[0]
            allowed = (
                "*" in granted
                or permission in granted
                or (permission.endswith(":read") and f"{module}:write" in granted)
            )
        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role {user.role} lacks permission '{permission}'",
            )

        # Billing state. Reading always works — we never hide a restaurant's own
        # data from it — but unpaid accounts stop spending our money and stop
        # making new commitments. 402 so the client can offer the fix.
        hotel = await db.get(Hotel, user.hotel_id)
        if hotel is not None and getattr(hotel, "handle", None):
            # Now that the hotel is loaded anyway, swap the UUID for the handle —
            # "hotel=milagu" is something support can read off a customer's URL.
            logging_setup.bind(hotel=hotel.handle)
            monitoring.note_hotel(user.hotel_id, hotel.handle)
        reason = access.blocks(hotel, permission) if hotel is not None else None
        if reason:
            raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, reason)
        return user

    return checker


def require_feature(feature_key: str) -> Callable[..., Coroutine[Any, Any, User]]:
    """Dependency factory: 403 if the user's hotel has this feature turned off by
    the platform operator. Missing/true = enabled (default on)."""

    async def checker(
        user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        hotel = await db.get(Hotel, user.hotel_id)
        if hotel is not None and not hotel.feature_on(feature_key):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"The '{feature_key}' feature is disabled for this hotel.",
            )
        return user

    return checker
