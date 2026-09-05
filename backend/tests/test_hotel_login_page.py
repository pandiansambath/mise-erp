"""A hotel's own staff sign-in door — saved, and served before anyone signs in.

    "why cant we give a specialised customisable login page for subdomain of
     hotel... let them design the page in setting like we did for hotel's
     customisable landing page."

The public reachability is the part worth pinning down: the door has to render
at the ONE moment nobody has a token, so its config is served unauthenticated —
and must therefore carry branding only, never anything about who works there.
"""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_login_page_config_round_trips(client, make_user, auth_header):
    admin = await make_user("door@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(admin)

    cfg = {
        "enabled": True,
        "headline": "Morning, team",
        "layout": "centre",
        "effect": "grid",
        "accent": "#059669",
        "theme": "warm",
    }
    r = await client.patch("/api/hotels/me", headers=h, json={"login_page": cfg})
    assert r.status_code == 200, r.text
    assert r.json()["login_page"]["headline"] == "Morning, team"

    again = await client.get("/api/hotels/me", headers=h)
    assert again.json()["login_page"]["effect"] == "grid"


@pytest.mark.asyncio
async def test_empty_config_means_the_standard_door(client, make_user, auth_header):
    """A hotel that never opens the panel must be completely unaffected."""
    admin = await make_user("nodoor@nirai.com", Role.SUPER_ADMIN.value)
    r = await client.get("/api/hotels/me", headers=auth_header(admin))
    assert r.status_code == 200
    assert r.json()["login_page"] == {}


@pytest.mark.asyncio
async def test_the_door_is_readable_without_a_login(client, db, make_user, auth_header, hotel):
    """It renders before anyone is signed in, so it is served unauthenticated —
    and carries branding only."""
    admin = await make_user("pub-door@nirai.com", Role.SUPER_ADMIN.value)
    hotel.username = "doortest"
    await db.commit()

    await client.patch(
        "/api/hotels/me",
        headers=auth_header(admin),
        json={"login_page": {"enabled": True, "headline": "Staff entrance"}},
    )

    # No Authorization header at all.
    r = await client.get("/api/public/hotel-landing/doortest")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["login_page"]["headline"] == "Staff entrance"
    # Branding only — nothing about the people.
    for leaky in ("users", "employees", "staff", "emails"):
        assert leaky not in body
