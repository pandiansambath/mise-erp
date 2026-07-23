"""Auth/user database operations."""
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.security import hash_password, verify_password


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: str | uuid.UUID) -> User | None:
    try:
        uid = user_id if isinstance(user_id, uuid.UUID) else uuid.UUID(str(user_id))
    except (ValueError, AttributeError):
        return None
    return await db.get(User, uid)


async def authenticate(db: AsyncSession, email: str, password: str) -> User | None:
    user = await get_user_by_email(db, email)
    if not user or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


async def change_password(
    db: AsyncSession, user: User, current_password: str, new_password: str
) -> bool:
    """Verify the current password, then set the new one. Returns False if the
    current password is wrong (caller 400s without leaking which field failed)."""
    if not verify_password(current_password, user.password_hash):
        return False
    user.password_hash = hash_password(new_password)
    await db.commit()
    return True


async def create_user(
    db: AsyncSession, email: str, password: str, role: str, hotel_id: uuid.UUID,
    preferred_name: str | None = None,
) -> User:
    name = preferred_name.strip()[:60] if preferred_name and preferred_name.strip() else None
    user = User(
        email=email, password_hash=hash_password(password), role=role,
        hotel_id=hotel_id, preferred_name=name,
        # In-app creations (staff logins, operators, seeds) are owner-vouched —
        # no inbox to prove. Only register-hotel flips this back to False and
        # gates the door behind the emailed link.
        email_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def list_users(db: AsyncSession, hotel_id: uuid.UUID) -> list[User]:
    """Live users only — permanently-removed (tombstoned) logins never appear."""
    result = await db.execute(
        select(User)
        .where(User.hotel_id == hotel_id, User.deleted_at.is_(None))
        .order_by(User.created_at)
    )
    return list(result.scalars().all())


async def count_super_admins(
    db: AsyncSession, hotel_id: uuid.UUID, *, exclude_id: uuid.UUID | None = None
) -> int:
    """Live (non-tombstoned) Super Admins in a hotel, optionally excluding one — a
    hotel must never be left with zero Super-Admin accounts."""
    q = select(User.id).where(
        User.hotel_id == hotel_id,
        User.role == "SUPER_ADMIN",
        User.deleted_at.is_(None),
    )
    if exclude_id is not None:
        q = q.where(User.id != exclude_id)
    return len((await db.execute(q)).scalars().all())


async def purge_user(db: AsyncSession, user: User) -> str:
    """Permanently remove a login: anonymise it (frees the email, destroys the
    password), detach it from any employee, and tombstone the row so history still
    resolves to 'Removed user'. Returns the original email (for the audit trail).
    Guards live in the router (super-admin only, not self / operator / last admin)."""
    original_email = user.email
    # Keep the employment record; just drop the login link (raw UPDATE avoids a
    # cross-module import of the Employee model).
    await db.execute(text("UPDATE employees SET user_id = NULL WHERE user_id = :uid"),
                     {"uid": user.id})
    user.email = f"removed-{secrets.token_hex(6)}@removed.invalid"
    user.preferred_name = "Removed user"
    user.password_hash = hash_password(secrets.token_urlsafe(24))  # unusable — no one has it
    user.is_active = False
    user.email_verified = False
    user.verify_token = None
    user.reset_token = None
    user.reset_expires = None
    user.otp_code = None
    user.otp_expires = None
    user.otp_attempts = 0
    user.twofa_email = False
    user.deleted_at = datetime.now(UTC)
    await db.commit()
    return original_email


async def update_user(
    db: AsyncSession, user: User, *, role: str | None = None, is_active: bool | None = None
) -> User:
    if role is not None:
        user.role = role
    if is_active is not None:
        user.is_active = is_active
    await db.commit()
    await db.refresh(user)
    return user
