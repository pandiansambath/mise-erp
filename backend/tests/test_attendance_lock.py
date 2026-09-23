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


async def _set_pin(client, auth_header, owner, pin="482159", password="password123"):
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
        json={"password": "password123", "pin": "111111"},
        headers=auth_header(manager),
    )
    assert res.status_code == 403


@pytest.mark.parametrize("bad", ["12", "1234", "123456789", "abcd", "12a4", ""])
async def test_a_weak_or_malformed_pin_is_refused(client, auth_header, owner, bad) -> None:
    """Four to eight digits. Two digits is a hundred guesses by a bored
    customer standing at the counter."""
    res = await _set_pin(client, auth_header, owner, pin=bad)
    assert res.status_code == 400


async def test_it_is_never_stored_in_the_clear(client, auth_header, owner, db, hotel) -> None:
    """It is short and typed in public — exactly the kind of secret that gets
    watched over a shoulder. A database leak must not hand somebody the door
    code as well."""
    await _set_pin(client, auth_header, owner, pin="482159")
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
    await _set_pin(client, auth_header, owner, pin="482159")

    res = await client.post(
        "/api/attendance/kiosk-open", json={"site": "lockinn", "pin": "482159"}
    )
    assert res.status_code == 200

    payload = decode_token(res.json()["token"])
    assert payload is not None
    assert payload["role"] == Role.KIOSK.value
    assert payload["sub"] != str(owner.id), "the tablet must not carry a person's identity"


async def test_the_wrong_pin_gets_nothing(client, auth_header, owner, db, hotel) -> None:
    hotel.username = "lockinn"
    await db.commit()
    await _set_pin(client, auth_header, owner, pin="482159")

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
        "/api/attendance/kiosk-open", json={"site": "no-such-place", "pin": "111111"}
    )
    assert res.status_code == 403
    assert "PIN" in res.json()["detail"]


async def test_a_restaurant_with_no_pin_cannot_be_opened(client, db, hotel) -> None:
    hotel.username = "nopin"
    await db.commit()
    res = await client.post(
        "/api/attendance/kiosk-open", json={"site": "nopin", "pin": "111111"}
    )
    assert res.status_code == 403


async def test_the_screen_can_check_the_pin_to_let_somebody_out(
    client, auth_header, owner, db, hotel
) -> None:
    """Leaving needs the PIN, so the kiosk session itself must be able to
    verify one — otherwise the lock is a door that only opens from outside."""
    await _set_pin(client, auth_header, owner, pin="482159")
    from app.auth import kiosk as kiosk_service

    account, _ = await kiosk_service.ensure_kiosk(db, hotel.id)

    ok = await client.post(
        "/api/attendance/lock/verify", json={"pin": "482159"}, headers=auth_header(account)
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

    await _set_pin(client, auth_header, owner, pin="482159")

    # The right PIN, aimed at the wrong restaurant.
    res = await client.post(
        "/api/attendance/kiosk-open", json={"site": "theirs", "pin": "482159"}
    )
    assert res.status_code == 403


# ── the shape rules, directly ─────────────────────────────────────────────


def test_shape_check_accepts_only_digits_in_range() -> None:
    assert attendance_lock.check_shape(" 482159 ") == "482159"
    # "1234" is in this list deliberately: a four-digit PIN used to be
    # legal and is the reason the kiosk door could be walked. Ten
    # thousand candidates against an unmetered endpoint that returns a
    # fourteen-hour token for the whole restaurant.
    for bad in ("123", "1234", "12345", "123456789", "12ab", ""):
        with pytest.raises(attendance_lock.PinError):
            attendance_lock.check_shape(bad)


@pytest.mark.asyncio
async def test_hours_range_answers_in_one_request(client, db, hotel, make_user, auth_header):
    """The attendance page drew a seven-day bar per person as SEVEN calls.

    From his desk that is seven round trips to London for one small picture —
    about 300ms of latency each, and a browser runs six at a time. One request
    now, shaped so the client does no matching: employee id -> a value per day,
    in the same order the caller asked for.
    """
    from datetime import date, timedelta

    owner = await make_user("hours-owner@nirai.com", Role.SUPER_ADMIN.value)
    today = date.today()
    start = today - timedelta(days=6)

    r = await client.get(
        f"/api/attendance/hours?date_from={start}&date_to={today}",
        headers=auth_header(owner),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, dict)
    for values in body.values():
        assert len(values) == 7, "one value per day asked for"

    # Backwards is not an error, it is somebody dragging a date picker.
    flipped = await client.get(
        f"/api/attendance/hours?date_from={today}&date_to={start}",
        headers=auth_header(owner),
    )
    assert flipped.status_code == 200

    # A range wide enough to be a mistake is refused rather than served slowly.
    huge = await client.get(
        f"/api/attendance/hours?date_from={today - timedelta(days=400)}&date_to={today}",
        headers=auth_header(owner),
    )
    assert huge.status_code == 400


# ── the wall panels: built, and unreachable by their own credential ───────
#
#     "why i cant see rota...off... whats happening..??"
#
# `KioskPanel` called `/rota/shifts` and `/employees/leave/list`, both gated on
# `employees:read` — a permission the kiosk deliberately does NOT hold, because
# it carries salary, NI number and bank details to a tablet unlocked by a door
# PIN. So both panels answered 403 on every open and the browser rendered it as
# "Could not reach DineAI.", which is a network story for a refusal.
#
# CloudWatch, on production: `GET /api/rota/shifts -> 403` for
# `user=kiosk+...@kiosk.dineai.cloud`, every 60 seconds.


async def _kiosk_headers(client, db, hotel, auth_header, owner) -> dict:
    """A real kiosk token, got the way a tablet gets one."""
    hotel.username = "boardinn"
    hotel.kiosk_show_rota = True
    hotel.kiosk_show_leave = True
    await db.commit()
    await _set_pin(client, auth_header, owner, pin="482159")
    res = await client.post(
        "/api/attendance/kiosk-open", json={"site": "boardinn", "pin": "482159"}
    )
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['token']}"}


async def test_the_kiosk_can_read_its_own_board(
    client, db, hotel, auth_header, owner
) -> None:
    """THE regression. This is the call the panels make, with the credential
    the panels actually hold."""
    headers = await _kiosk_headers(client, db, hotel, auth_header, owner)
    res = await client.get("/api/attendance/kiosk-board", headers=headers)
    assert res.status_code == 200, "the wall panels must be openable from the wall"
    body = res.json()
    assert body["rota"] is not None
    assert body["leave"] is not None


async def test_a_switched_off_panel_returns_nothing(
    client, db, hotel, auth_header, owner
) -> None:
    """The owner's choice is enforced by the SERVER.

    `kiosk_show_rota`/`kiosk_show_leave` used to decide only whether a button
    was drawn, so the data behind a switched-off panel was never protected by
    them. Who is on leave today is not something every customer at the counter
    gets to read because one browser was out of date.
    """
    headers = await _kiosk_headers(client, db, hotel, auth_header, owner)
    hotel.kiosk_show_leave = False
    await db.commit()

    body = (await client.get("/api/attendance/kiosk-board", headers=headers)).json()
    assert body["leave"] is None, "a panel the owner switched off must serve no data"
    assert body["rota"] is not None


# ── being told the PIN you already have ───────────────────────────────────
#
#     "why everytime it asking to create pin... let use previous pin"


async def test_the_owner_can_be_shown_the_pin_again(client, auth_header, owner) -> None:
    await _set_pin(client, auth_header, owner, pin="482159")
    res = await client.post(
        "/api/attendance/lock/reveal",
        json={"password": "password123"},
        headers=auth_header(owner),
    )
    assert res.status_code == 200
    assert res.json()["pin"] == "482159"


async def test_the_wrong_password_is_not_shown_the_pin(client, auth_header, owner) -> None:
    """Being shown a door code and being able to change one are the same
    capability from the point of view of somebody at an unattended screen."""
    await _set_pin(client, auth_header, owner, pin="482159")
    res = await client.post(
        "/api/attendance/lock/reveal",
        json={"password": "not-my-password"},
        headers=auth_header(owner),
    )
    assert res.status_code == 403


async def test_a_manager_cannot_be_shown_the_pin(client, make_user, auth_header) -> None:
    manager = await make_user("mgr2@lock.test", Role.MANAGER.value)
    res = await client.post(
        "/api/attendance/lock/reveal",
        json={"password": "password123"},
        headers=auth_header(manager),
    )
    assert res.status_code == 403


async def test_changing_what_the_screen_shows_keeps_the_pin(
    client, db, hotel, auth_header, owner
) -> None:
    """Opening the panel to tick a box must not re-code the tablet by the door.

    This is the other half of his complaint: `pin` was REQUIRED, so every visit
    to these settings pushed a brand new PIN through and invalidated the code
    taped to the device.
    """
    await _set_pin(client, auth_header, owner, pin="482159")

    res = await client.post(
        "/api/attendance/lock/pin",
        json={"show_rota": True, "show_leave": True},
        headers=auth_header(owner),
    )
    assert res.status_code == 204

    await db.refresh(hotel)
    assert hotel.kiosk_show_rota is True
    assert attendance_lock.verify(hotel, "482159"), "the old PIN must still open the screen"


async def test_an_empty_pin_is_still_a_bad_pin(client, auth_header, owner) -> None:
    """ABSENT means "settings only"; EMPTY means "I tried to set a bad one".

    Collapsing those two would turn a rejected PIN into a silent success.
    """
    res = await client.post(
        "/api/attendance/lock/pin",
        json={"password": "password123", "pin": ""},
        headers=auth_header(owner),
    )
    assert res.status_code == 400
