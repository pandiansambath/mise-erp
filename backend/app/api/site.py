"""Public site endpoints for the hotel-network domain.

Home of the Caddy **on-demand TLS "ask" hook**: before Caddy issues an HTTPS
certificate for a `<something>.dineai.cloud` hostname it hits this endpoint, and
only a 200 lets the cert be minted. That stops a bot from spraying random
subdomains at us and exhausting Let's Encrypt rate limits — we only mint certs
for hosts we recognise: the apex, our reserved function subdomains, and live
hotel @handles.
"""
from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.hotels.models import Hotel

router = APIRouter(prefix="/public", tags=["public-site"])

# Function-specific subdomains that always resolve. The frontend middleware maps
# each to an app section (careers.<domain> -> /careers, etc.). Anything not in
# here must match a hotel's @username handle to be allowed.
RESERVED_SUBDOMAINS: set[str] = {
    "www",
    "app",
    "careers",
    "controlroom",
    "control-room",
    "cr",
    "order",
    "orders",
    "rider",
    "admin",
    "hello",
    "support",
}


def base_domain() -> str:
    """Our registrable domain (e.g. ``dineai.cloud``), derived from the public
    base URL so it follows the domain automatically after any move."""
    return (settings.app_base_url or "").split("//", 1)[-1].split("/", 1)[0].lower()


def subdomain_label(host: str) -> str | None:
    """Return the single-level subdomain label of ``host`` under our base domain,
    or ``None`` if ``host`` is the apex / not under our domain / multi-level."""
    host = (host or "").strip().lower().rstrip(".")
    base = base_domain()
    if not host or not base or host == base:
        return None
    suffix = f".{base}"
    if not host.endswith(suffix):
        return None
    label = host[: -len(suffix)]
    if not label or "." in label:  # only single-level subdomains
        return None
    return label


@router.get("/tls-check")
async def tls_check(domain: str = "", db: AsyncSession = Depends(get_db)) -> Response:
    """Caddy on-demand-TLS ask endpoint. 200 = may issue a cert for this host;
    any other status = refuse. Allowed: apex, reserved function subdomains, and
    live hotel @handles."""
    host = (domain or "").strip().lower().rstrip(".")
    base = base_domain()
    if not host or not base:
        return Response(status_code=status.HTTP_400_BAD_REQUEST)
    if host == base:  # the apex itself
        return Response(status_code=status.HTTP_200_OK)
    label = subdomain_label(host)
    if label is None:
        return Response(status_code=status.HTTP_404_NOT_FOUND)
    if label in RESERVED_SUBDOMAINS:
        return Response(status_code=status.HTTP_200_OK)
    exists = (
        await db.execute(select(func.count(Hotel.id)).where(func.lower(Hotel.username) == label))
    ).scalar_one()
    return Response(
        status_code=status.HTTP_200_OK if exists else status.HTTP_404_NOT_FOUND
    )
