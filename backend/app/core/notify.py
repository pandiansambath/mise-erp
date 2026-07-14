"""Outbound email alerts — provider-agnostic and safe.

With no RESEND_API_KEY configured this logs and no-ops (returns False), so the app
runs fine without a provider; drop in the key and alerts start flowing. httpx is
imported lazily so it's never required unless a key is actually set.
"""
import asyncio
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

log = logging.getLogger("mise.notify")

# ── Per-user email-alert switches ─────────────────────────────────────────────
# The single source of truth for which alert types exist and their defaults.
# Users store only their OVERRIDES in User.email_prefs; unknown keys are refused
# by the settings endpoint so a typo can never silently disable an alert.
ALERT_DEFAULTS: dict[str, bool] = {
    "job_application": True,   # someone applied to one of your vacancies
    "price_rise": True,        # a supplier moved a price UP
    "low_stock": True,         # an item crossed below its minimum level
    "broadcast": True,         # a platform (Mise HQ) announcement
    "security_login": False,   # every sign-in to your account (quiet by default)
}


def wants(user, key: str) -> bool:
    """Does this user want emails for `key`? Overrides win, defaults fill gaps."""
    prefs = getattr(user, "email_prefs", None) or {}
    return bool(prefs.get(key, ALERT_DEFAULTS.get(key, False)))


# Fire-and-forget sends for hot paths (e.g. stock movements during a PO receive):
# the request must never wait on the mail provider. Keeping references stops the
# tasks being garbage-collected mid-flight.
_bg_tasks: set[asyncio.Task] = set()


def fire(coro) -> None:
    task = asyncio.ensure_future(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


async def send_email(to: str, subject: str, text: str, html: str | None = None) -> bool:
    """Send one email (HTML + plain-text fallback). Returns True if dispatched."""
    if not settings.resend_api_key:
        log.info("[email suppressed — no provider key] to=%s subject=%s", to, subject)
        return False
    try:
        import httpx

        payload: dict = {"from": settings.email_from, "to": [to], "subject": subject, "text": text}
        if html:
            payload["html"] = html
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json=payload,
            )
        return resp.status_code < 300
    except Exception:  # noqa: BLE001 — alerts must never break the core action
        log.exception("email send failed to=%s", to)
        return False


# ── Branded HTML template ─────────────────────────────────────────────────────
def render_email(
    *,
    heading: str,
    intro: str,
    rows: list[tuple[str, str]] | None = None,
    cta_label: str | None = None,
    cta_url: str | None = None,
    accent: str = "#059669",
) -> str:
    """A clean, email-client-safe branded HTML email (inline styles, table layout)."""
    rows_html = ""
    if rows:
        cells = "".join(
            f'<tr><td style="padding:8px 0;color:#64748b;font-size:14px;">{k}</td>'
            f'<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">{v}</td></tr>'
            for k, v in rows
        )
        rows_html = (
            '<table width="100%" cellpadding="0" cellspacing="0" '
            'style="margin:8px 0 4px;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">'
            f"{cells}</table>"
        )
    cta_html = ""
    if cta_label and cta_url:
        cta_html = (
            f'<a href="{cta_url}" style="display:inline-block;margin-top:20px;background:{accent};'
            'color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;'
            'border-radius:10px;">' + cta_label + "</a>"
        )
    return f"""<!doctype html><html><body style="margin:0;background:#f1f5f9;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;
      font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;
          background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(2,6,23,.08);">
        <tr><td style="background:linear-gradient(135deg,#047857,#0ea5e9);padding:28px 32px;">
          <div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-.5px;">📊 Mise</div>
          <div style="color:#d1fae5;font-size:12px;margin-top:2px;">Every plate, every penny</div>
        </td></tr>
        <tr><td style="padding:32px;">
          <h1 style="margin:0 0 12px;color:#0f172a;font-size:20px;">{heading}</h1>
          <p style="margin:0;color:#475569;font-size:15px;line-height:1.6;">{intro}</p>
          {rows_html}
          {cta_html}
        </td></tr>
        <tr><td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;
            color:#94a3b8;font-size:12px;line-height:1.5;">
          Sent by Mise — your restaurant ERP. You're receiving this because you manage a venue on Mise.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""


async def email_hotel_admins(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    subject: str,
    text: str,
    html: str | None = None,
    *,
    pref_key: str | None = None,
    background: bool = False,
) -> int:
    """Email the hotel's owners/managers. Best-effort; returns how many were sent.

    `pref_key` filters recipients by their Settings → Email alerts toggle.
    `background=True` fires the sends without awaiting them (hot paths) — the
    return value is then how many were QUEUED, not confirmed."""
    from app.auth.models import Role, User

    rows = await db.execute(
        select(User).where(
            User.hotel_id == hotel_id,
            User.is_active.is_(True),
            User.role.in_([Role.SUPER_ADMIN.value, Role.MANAGER.value]),
        )
    )
    sent = 0
    for user in rows.scalars().all():
        if pref_key and not wants(user, pref_key):
            continue
        if background:
            fire(send_email(user.email, subject, text, html))
            sent += 1
        elif await send_email(user.email, subject, text, html):
            sent += 1
    return sent
