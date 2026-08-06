"""The PIN that turns a device into the attendance screen.

The design is the owner's: rather than provisioning a login for the tablet,
somebody types the restaurant's PIN and that browser tab drops to
attendance-only until the PIN is typed again.

What makes it more than a screen lock — and what these tests exist to hold —
is that unlocking REPLACES the tab's session with a KIOSK-scoped one. A tablet
left on the counter is not a manager's session behind a modal; the credential
in it genuinely cannot reach the money.
"""
import pytest

from app.auth.models import Role
from app.core.security import decode_token
from app.employees import attendance_lock


@pytest.fixture
async def owner(make_user):
    return await make_user("owner@lock.test", Role.SUPER_ADMIN.value)


async def _set_pin(client, auth_header, owner, pin="4821", password="password123"):
    return await client.post(
        "/api/attendance/lock/pin",
        json={"password": password, "pin": pin},
        headers=auth_header(owner),
    )


# ── setting it ────────────────────────────────────────────────────────────


async def test_the_owner_can_set_a_pin(client, auth_header, owner) -> None:
    assert (await _set_pin(client, auth_header, owner)).status_code == 204


async def test_the_wrong_password_cannot_change_it(client, auth_header, owner) -> None:
    """A code that unlocks a screen must not be changeable by whoever happens
    to be sitting at an unlocked one."""
    res = await _set_pin(client, auth_header, owner, password="not-my-password")
    assert res.status_code == 403


async def test_a_manager_cannot_set_it(client, make_user, auth_header) -> None:
    manager = await make_user("mgr@lock.test", Role.MANAGER.value)
    res = await client.post(
        "/api/attendance/lock/pin",
        json={"password": "password123", "pin": "1234"},
        headers=auth_header(manager),
    )
    assert res.status_code == 403


@pytest.mark.parametrize("bad", ["12", "123456789", "abcd", "12a4", ""])
async def test_a_weak_or_malformed_pin_is_refused(client, auth_header, owner, bad) -> None:
    """Four to eight digits. Two digits is a hundred guesses by a bored
    customer standing at the counter."""
    res = await _set_pin(client, auth_header, owner, pin=bad)
    assert res.status_code == 400


async def test_it_is_never_stored_in_the_clear(client, auth_header, owner, db, hotel) -> None:
    """It is short and typed in public — exactly the kind of secret that gets
    watched over a shoulder. A database leak must not hand somebody the door
    code as well."""
    await _set_pin(client, auth_header, owner, pin="4821")
    await db.refresh(hotel)
    assert hotel.attendance_pin_hash
    assert "4821" not in hotel.attendance_pin_hash


# ── using it ──────────────────────────────────────────────────────────────


async def test_the_right_pin_returns_a_kiosk_token(
    client, auth_header, owner, db, hotel
) -> None:
    """THE test.

    No login is involved — a cold tablet types the PIN — so what comes back
    must be attendance-scoped. If it handed back anything wider, the device on
    the counter would be a real session with a keypad in front of it.
    """
    hotel.username = "lockinn"
    await db.commit()
    await _set_pin(client, auth_header, owner, pin="4821")

    res = await client.post(
        "/api/attendance/kiosk-open", json={"site": "lockinn", "pin": "4821"}
    )
    assert res.status_code == 200

    payload = decode_token(res.json()["token"])
    assert payload is not None
    assert payload["role"] == Role.KIOSK.value
    assert payload["sub"] != str(owner.id), "the tablet must not carry a person's identity"


async def test_the_wrong_pin_gets_nothing(client, auth_header, owner, db, hotel) -> None:
    hotel.username = "lockinn"
    await db.commit()
    await _set_pin(client, auth_header, owner, pin="4821")

    res = await client.post(
        "/api/attendance/kiosk-open", json={"site": "lockinn", "pin": "9999"}
    )
    assert res.status_code == 403


async def test_an_unknown_restaurant_answers_the_same_as_a_wrong_pin(client) -> None:
    """Both say "that PIN is not right".

    A different answer for a handle that does not exist would turn this into a
    way to discover which restaurants are on DineAI, from a page with no login
    in front of it.
    """
    res = await client.post(
        "/api/attendance/kiosk-open", json={"site": "no-such-place", "pin": "1234"}
    )
    assert res.status_code == 403
    assert "PIN" in res.json()["detail"]


async def test_a_restaurant_with_no_pin_cannot_be_opened(client, db, hotel) -> None:
    hotel.username = "nopin"
    await db.commit()
    res = await client.post(
        "/api/attendance/kiosk-open", json={"site": "nopin", "pin": "1234"}
    )
    assert res.status_code == 403


async def test_the_screen_can_check_the_pin_to_let_somebody_out(
    client, auth_header, owner, db, hotel
) -> None:
    """Leaving needs the PIN, so the kiosk session itself must be able to
    verify one — otherwise the lock is a door that only opens from outside."""
    await _set_pin(client, auth_header, owner, pin="4821")
    from app.auth import kiosk as kiosk_service

    account, _ = await kiosk_service.ensure_kiosk(db, hotel.id)

    ok = await client.post(
        "/api/attendance/lock/verify", json={"pin": "4821"}, headers=auth_header(account)
    )
    assert ok.status_code == 200 and ok.json()["ok"] is True

    no = await client.post(
        "/api/attendance/lock/verify", json={"pin": "0000"}, headers=auth_header(account)
    )
    assert no.status_code == 200 and no.json()["ok"] is False


async def test_one_restaurants_pin_does_not_open_another(
    client, auth_header, owner, db, hotel
) -> None:
    """The lookup is by handle, so a code shared between two franchises must
    not open the wrong kitchen — a quiet, serious hole if it did."""
    from app.hotels.models import Hotel

    hotel.username = "mine"
    other = Hotel(
        name="Elsewhere", country="GB", base_currency="GBP", city="Hull", username="theirs"
    )
    db.add(other)
    await db.commit()

    await _set_pin(client, auth_header, owner, pin="4821")

    # The right PIN, aimed at the wrong restaurant.
    res = await client.post(
        "/api/attendance/kiosk-open", json={"site": "theirs", "pin": "4821"}
    )
    assert res.status_code == 403


# ── the shape rules, directly ─────────────────────────────────────────────


def test_shape_check_accepts_only_digits_in_range() -> None:
    assert attendance_lock.check_shape(" 1234 ") == "1234"
    for bad in ("123", "123456789", "12ab", ""):
        with pytest.raises(attendance_lock.PinError):
            attendance_lock.check_shape(bad)
