"""RBAC tests — the security-critical matrix and the user-management guards."""
import pytest

from app.auth.models import Role
from app.core.rbac import has_permission


# ── Unit tests for the permission matrix ──────────────────────────────────
def test_super_admin_wildcard():
    assert has_permission(Role.SUPER_ADMIN.value, "anything:at:all") is True


def test_specific_permission_granted():
    assert has_permission(Role.KITCHEN_MANAGER.value, "indent:write") is True
    assert has_permission(Role.ACCOUNTANT.value, "payroll:write") is True
    assert has_permission(Role.CASHIER.value, "sales:write") is True


def test_permission_denied_when_not_in_role():
    assert has_permission(Role.CASHIER.value, "users:write") is False
    assert has_permission(Role.STAFF.value, "reports:read") is False
    assert has_permission(Role.KITCHEN_MANAGER.value, "payroll:write") is False


def test_unknown_role_has_nothing():
    assert has_permission("WIZARD", "anything") is False


# ── Endpoint guard tests ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_super_admin_can_create_user(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    resp = await client.post(
        "/api/auth/users",
        headers=auth_header(admin),
        json={"email": "newcashier@nirai.com", "password": "password123", "role": "CASHIER"},
    )
    assert resp.status_code == 201
    assert resp.json()["email"] == "newcashier@nirai.com"
    assert resp.json()["role"] == "CASHIER"


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [Role.CASHIER.value, Role.STAFF.value, Role.KITCHEN_MANAGER.value])
async def test_non_admin_cannot_create_user(client, make_user, auth_header, role):
    user = await make_user(f"{role.lower()}@nirai.com", role)
    resp = await client.post(
        "/api/auth/users",
        headers=auth_header(user),
        json={"email": "x@nirai.com", "password": "password123", "role": "STAFF"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_manager_can_list_but_not_create_users(client, make_user, auth_header):
    manager = await make_user("manager@nirai.com", Role.MANAGER.value)
    # users:read -> allowed
    assert (await client.get("/api/auth/users", headers=auth_header(manager))).status_code == 200
    # users:write -> denied
    create = await client.post(
        "/api/auth/users",
        headers=auth_header(manager),
        json={"email": "y@nirai.com", "password": "password123", "role": "STAFF"},
    )
    assert create.status_code == 403


@pytest.mark.asyncio
async def test_staff_cannot_list_users(client, make_user, auth_header):
    staff = await make_user("staff@nirai.com", Role.STAFF.value)
    resp = await client.get("/api/auth/users", headers=auth_header(staff))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_create_user_invalid_role_rejected(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    resp = await client.post(
        "/api/auth/users",
        headers=auth_header(admin),
        json={"email": "z@nirai.com", "password": "password123", "role": "PRESIDENT"},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_user_duplicate_email_conflict(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    payload = {"email": "dup@nirai.com", "password": "password123", "role": "STAFF"}
    first = await client.post("/api/auth/users", headers=auth_header(admin), json=payload)
    assert first.status_code == 201
    second = await client.post("/api/auth/users", headers=auth_header(admin), json=payload)
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_admin_can_deactivate_user(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    victim = await make_user("temp@nirai.com", Role.STAFF.value)
    resp = await client.patch(
        f"/api/auth/users/{victim.id}",
        headers=auth_header(admin),
        json={"is_active": False},
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False


@pytest.mark.asyncio
async def test_update_missing_user_404(client, make_user, auth_header):
    admin = await make_user("admin@nirai.com", Role.SUPER_ADMIN.value)
    resp = await client.patch(
        "/api/auth/users/00000000-0000-0000-0000-000000000000",
        headers=auth_header(admin),
        json={"is_active": False},
    )
    assert resp.status_code == 404


def test_a_single_page_can_be_made_read_only() -> None:
    """"what if I need ONLINE ORDER page alone to be read only, other 2 pages in
    write mode? How can I do this? Currently it's bundled. So please make it
    flexible to do whatever the super admin wants."

    He is right that it was bundled, and there is a real reason it had to be:
    Sales & Cash, Online Orders and Money all read the same data, so ONE module
    permission guards all three. You cannot hand out "write sales" for one of
    them and withhold it for another at the data layer, because it is the same
    data.

    What can be done honestly is take a screen's write actions away while
    leaving its neighbours alone. `page:<slug>:ro` only ever NARROWS — it cannot
    grant anything the module permission refused — which is what makes it safe
    for the UI to decide. The module permission is still the lock on the data
    and this is documented as a UI restriction in rbac.py.
    """
    from app.core.rbac import is_page_key, resolve_permissions

    # The grant has to survive validation at all — the pattern used to be
    # `^page:[a-z0-9-]+$`, which rejects the colon and silently dropped it.
    assert is_page_key("page:online-orders")
    assert is_page_key("page:online-orders:ro")
    assert not is_page_key("page:Online-Orders")     # slugs are lower case
    assert not is_page_key("page:online-orders:rw")  # only :ro means anything
    assert not is_page_key("sales:write:ro")         # not a page key at all

    perms = resolve_permissions(
        Role.MANAGER.value,
        {
            "sales:write": True,
            "page:sales-and-cash": True,
            "page:online-orders": True,
            "page:money": True,
            # …and only this one is read-only.
            "page:online-orders:ro": True,
        },
    )
    assert "sales:write" in perms, "the module permission is untouched"
    assert "page:online-orders:ro" in perms, "the narrowing survives the round trip"
    assert "page:sales-and-cash:ro" not in perms, "its neighbours are not affected"
    assert "page:money:ro" not in perms

    # Turning it back off removes it rather than leaving a stale yes behind.
    off = resolve_permissions(
        Role.MANAGER.value,
        {"sales:write": True, "page:online-orders:ro": False},
    )
    assert "page:online-orders:ro" not in off


def test_a_read_only_page_grant_cannot_widen_anything() -> None:
    """The property that makes this safe to let the UI decide.

    A `:ro` grant is a restriction, and a restriction applied to somebody who
    never had the ability must change nothing at all. If it could ever ADD a
    permission, the whole model would be unsound — a page marker would be a way
    to reach data the role was refused.
    """
    from app.core.rbac import resolve_permissions

    without = set(resolve_permissions(Role.STAFF.value, {}))
    with_ro = set(
        resolve_permissions(Role.STAFF.value, {"page:online-orders:ro": True})
    )
    assert with_ro - without == {"page:online-orders:ro"}, (
        "the only thing it may add is the marker itself — never a real permission"
    )
    assert not any(p.endswith(":write") for p in with_ro - without)
