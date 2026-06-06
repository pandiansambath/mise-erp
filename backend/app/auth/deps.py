"""FastAPI dependencies: current-user resolution and permission guards."""
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.service import get_user_by_id
from app.core.database import get_db
from app.core.rbac import has_permission
from app.core.security import decode_token

bearer_scheme = HTTPBearer(auto_error=True)

_CREDENTIALS_EXC = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise _CREDENTIALS_EXC
    user = await get_user_by_id(db, payload["sub"])
    if user is None or not user.is_active:
        raise _CREDENTIALS_EXC
    return user


def require(permission: str) -> Callable[..., Coroutine[Any, Any, User]]:
    """Dependency factory enforcing a single permission string."""

    async def checker(user: User = Depends(get_current_user)) -> User:
        if not has_permission(user.role, permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role {user.role} lacks permission '{permission}'",
            )
        return user

    return checker
