"""Public site endpoints for the hotel-network domain.

Home of the Caddy **on-demand TLS "ask" hook**: before Caddy issues an HTTPS
certificate for a `<something>.dineai.cloud` hostname it hits this endpoint, and
only a 200 lets the cert be minted. That stops a bot from spraying random
subdomains at us and exhausting Let's Encrypt rate limits — we only mint certs
for hosts we recognise: the apex, our reserved function subdomains, and live
hotel @handles.
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.hotels.models import Hotel

router = APIRouter(prefix="/public", tags=["public-site"])

# Defaults for the customizable per-hotel landing page (<handle>.dineai.cloud).
# A hotel stores only its overrides in Hotel.landing; missing keys fall back here.
LANDING_DEFAULTS: dict = {
    "hero": "warm",              # hero photo style: warm|fine|rustic|spice|cafe|night
    "tagline": "",               # short hero line under the name
    "about_title": "Our story",  # heading above the about paragraph
    "about": "",                 # a paragraph about the place
    "quote": "",                 # a chef / owner quote
    "quote_by": "",              # who said it
    "cta_label": "Order online", # label on the ordering button
    "address": "",               # visit-us card
    "phone": "",
    "hours": "",
    "accent": "#4f46e5",         # brand colour (hex) — indigo by default
    "accent2": "#0ea5e9",        # 2nd colour; the pair makes every gradient
    "theme": "dark",             # dark | light | warm
    "font": "serif",             # display font: sans|serif|poster|editorial|hand
    "title_gradient": True,      # paint the hotel name with the accent gradient
    "show_order": False,         # show the ordering button
    "show_gallery": True,        # show the dish gallery strip
}

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
    # The developer's own reference page. Kept in the reserved list (rather than
    # left to the hotel-handle lookup) so no restaurant can ever register the
    # handle "pandi-dev" and take the subdomain.
    "pandi-dev",
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


@router.get("/hotel-landing/{handle}")
async def hotel_landing(handle: str, db: AsyncSession = Depends(get_db)) -> dict:
    """Public branding + landing config for a hotel subdomain (<handle>.dineai.cloud).
    No auth — this renders the hotel's own front door before anyone logs in."""
    # Match tls-check exactly (handle only, no is_active gate): if the handle is
    # good enough to mint a cert, it's good enough to render its landing. (A
    # genuinely-suspended hotel would be gated in BOTH places, together.)
    hotel = (
        await db.execute(
            select(Hotel).where(func.lower(Hotel.username) == handle.strip().lower())
        )
    ).scalar_one_or_none()
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such site")
    cfg = {**LANDING_DEFAULTS, **(hotel.landing or {})}

    # What makes this site different from a template: it is WIRED TO THE KITCHEN.
    # The real menu (live prices, availability) rides along, so the page updates
    # itself the moment the hotel changes a price or 86s a dish.
    from app.ordering.models import MenuItem

    dishes = (
        (
            await db.execute(
                select(MenuItem)
                .where(MenuItem.hotel_id == hotel.id, MenuItem.is_available.is_(True))
                .order_by(MenuItem.sort_order, MenuItem.name)
                .limit(8)
            )
        )
        .scalars()
        .all()
    )
    return {
        "hotel_id": str(hotel.id),
        "name": hotel.name,
        "username": hotel.username,
        "city": hotel.city,
        "has_logo": bool(hotel.logo_key),
        "logo_url": f"/api/hotels/{hotel.id}/logo" if hotel.logo_key else None,
        "order_url": f"/order/{hotel.id}",
        "currency": hotel.base_currency,
        "is_open": not hotel.ordering_paused,
        "prep_minutes": hotel.prep_minutes,
        "menu": [
            {
                "id": str(m.id),
                "name": m.name,
                "description": m.description,
                "price": str(m.price),
                "emoji": m.emoji,
                "photo_url": (
                    f"/api/public/order/menu-photo/{m.id}" if m.photo_key else None
                ),
            }
            for m in dishes
        ],
        "landing": cfg,
    }
