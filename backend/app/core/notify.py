"""Outbound email alerts — provider-agnostic and safe.

With no RESEND_API_KEY configured this logs and no-ops (returns False), so the app
runs fine without a provider; drop in the key and alerts start flowing. httpx is
imported lazily so it's never required unless a key is actually set.
"""
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = logging.getLogger("mise.notify")


async def send_email(to: str, subject: str, text: str) -> bool:
    """Send one email. Returns True if dispatched, False if suppressed/failed."""
    if not settings.resend_api_key:
        log.info("[email suppressed — no provider key] to=%s subject=%s", to, subject)
        return False
    try:
        import httpx

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={"from": settings.email_from, "to": [to], "subject": subject, "text": text},
            )
        return resp.status_code < 300
    except Exception:  # noqa: BLE001 — alerts must never break the core action
        log.exception("email send failed to=%s", to)
        return False


async def email_hotel_admins(
    db: AsyncSession, hotel_id: uuid.UUID, subject: str, text: str
) -> int:
    """Email the hotel's owners/managers. Best-effort; returns how many were sent."""
    from app.auth.models import Role, User

    rows = await db.execute(
        select(User.email).where(
            User.hotel_id == hotel_id,
            User.is_active.is_(True),
            User.role.in_([Role.SUPER_ADMIN.value, Role.MANAGER.value]),
        )
    )
    sent = 0
    for (email,) in rows.all():
        if await send_email(email, subject, text):
            sent += 1
    return sent
