"""The tablet by the door.

This account sits unattended on a counter in a public part of a restaurant.
Anyone — staff, a delivery driver, a customer looking for the toilet — can pick
it up and start tapping. So the tests that matter are not "can it clock people
in"; they are **everything it must refuse**.

If one of these ever goes red, a screen anybody can touch has been handed
something it should never have had.
"""
import pytest

from app.auth import kiosk as kiosk_service
from app.auth.models import Role
from app.core.rbac import ENVELOPES, PERMISSIONS, envelope_for, has_permission


@pytest.fixture
async def kiosk(db, hotel):
    account, password = await kiosk_service.ensure_kiosk(db, hotel.id)
    return account, password


# ── what it may do ────────────────────────────────────────────────────────


async def test_it_can_clock_somebody_in(client, db, hotel, kiosk, auth_header) -> None:
    """The one job."""
    from app.employees.models import Employee

    emp = Employee(
        hotel_id=hotel.id, employee_code="K1", full_name="Rekha", salary_type="HOURLY"
    )
    db.add(emp)
    await db.commit()
    await db.refresh(emp)

    account, _ = kiosk
    res = await client.post(
        "/api/attendance/punch",
        json={"employee_id": str(emp.id), "type": "CLOCK_IN"},
        headers=auth_header(account),
    )
    assert res.status_code in (200, 201)


async def test_it_can_read_the_staff_list(client, kiosk, auth_header) -> None:
    """It has to show names worth tapping."""
    account, _ = kiosk
    res = await client.get("/api/employees", headers=auth_header(account))
    assert res.status_code == 200


# ── everything it must refuse ─────────────────────────────────────────────


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/api/payroll/runs"),
        ("get", "/api/reports/pnl"),
        ("get", "/api/sales/days/2026-08-06"),
        ("get", "/api/expenses"),
        ("get", "/api/vendors"),
        ("get", "/api/inventory/items"),
        ("get", "/api/auth/users"),
        ("get", "/api/documents"),
    ],
)
async def test_it_cannot_reach_anything_else(
    client, kiosk, auth_header, method, path
) -> None:
    """Wages, money, suppliers, stock, other people's logins, documents.

    A device in a dining room must not be one URL away from any of it.
    """
    account, _ = kiosk
    res = await getattr(client, method)(path, headers=auth_header(account))
    assert res.status_code in (401, 403), f"{path} answered {res.status_code}"


async def test_it_cannot_add_a_user(client, kiosk, auth_header) -> None:
    """The worst outcome: a shared screen minting itself a better account."""
    account, _ = kiosk
    res = await client.post(
        "/api/auth/users",
        json={"email": "sneaky@test.com", "password": "password123", "role": "SUPER_ADMIN"},
        headers=auth_header(account),
    )
    assert res.status_code in (401, 403)


async def test_it_cannot_set_up_or_rotate_a_kiosk(client, kiosk, auth_header) -> None:
    """It must not be able to mint credentials — including its own."""
    account, _ = kiosk
    assert (await client.post("/api/auth/kiosk", json={}, headers=auth_header(account))).status_code in (401, 403)
    assert (await client.get("/api/auth/kiosk", headers=auth_header(account))).status_code in (401, 403)


# ── the permission model itself ───────────────────────────────────────────


async def test_its_ceiling_is_its_default() -> None:
    """A custom role must never be able to widen it. Every other archetype has
    an envelope BIGGER than its defaults — this one, deliberately, does not."""
    assert set(envelope_for(Role.KIOSK.value)) == set(PERMISSIONS[Role.KIOSK.value])
    assert set(ENVELOPES[Role.KIOSK.value]) == set(PERMISSIONS[Role.KIOSK.value])


async def test_no_money_permission_is_reachable() -> None:
    """Spelled out, so a future edit to the permission list trips this rather
    than quietly shipping."""
    for perm in (
        "payroll:read", "payroll:self", "sales:read", "sales:write",
        "expenses:read", "reports:read", "users:read", "users:write",
        "vendors:read", "inventory:read",
    ):
        assert not has_permission(Role.KIOSK.value, perm), perm


async def test_a_person_cannot_be_made_a_kiosk(
    client, make_user, auth_header, db, hotel
) -> None:
    """KIOSK is a device identity. Demoting a human into it — or promoting the
    tablet into a person's role — would make the audit trail lie about who did
    what."""
    admin = await make_user("boss2@test.com", Role.SUPER_ADMIN.value)
    victim = await make_user("waiter2@test.com", Role.STAFF.value)

    res = await client.patch(
        f"/api/auth/users/{victim.id}",
        json={"role": "KIOSK"},
        headers=auth_header(admin),
    )
    assert res.status_code == 422


# ── the credential ────────────────────────────────────────────────────────


async def test_there_is_only_ever_one_per_restaurant(db, hotel) -> None:
    """Rotating must not leave a second, forgotten login alive on some tablet
    nobody remembers setting up."""
    first, _ = await kiosk_service.ensure_kiosk(db, hotel.id)
    second, _ = await kiosk_service.ensure_kiosk(db, hotel.id)
    assert first.id == second.id


async def test_rotating_changes_the_password(db, hotel) -> None:
    from app.core.security import verify_password

    account, old = await kiosk_service.ensure_kiosk(db, hotel.id)
    account, new = await kiosk_service.ensure_kiosk(db, hotel.id)

    assert old != new
    assert verify_password(new, account.password_hash)
    assert not verify_password(old, account.password_hash)


async def test_it_starts_verified_because_it_has_no_inbox(db, hotel) -> None:
    """The verify-gate blocks unverified logins. A kiosk has nowhere to receive
    a link, so left unverified it could never sign in at all."""
    account, _ = await kiosk_service.ensure_kiosk(db, hotel.id)
    assert account.email_verified is True


async def test_one_restaurants_tablet_is_not_anothers(db, hotel) -> None:
    from app.hotels.models import Hotel

    other = Hotel(name="Next Door", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)

    a, _ = await kiosk_service.ensure_kiosk(db, hotel.id)
    b, _ = await kiosk_service.ensure_kiosk(db, other.id)
    assert a.id != b.id
    assert a.hotel_id != b.hotel_id
    assert a.email != b.email
