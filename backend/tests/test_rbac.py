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
