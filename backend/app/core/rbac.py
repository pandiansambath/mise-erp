"""Role-based access control: the permission matrix and check helpers.

Permissions are strings like ``"inventory:write"``. ``"*"`` is a wildcard
granting everything (Super Admin). Module routes declare the permission they
need via ``Depends(require("..."))`` (see app/auth/deps.py).

The matrix below is the single source of truth for who-can-do-what. As new
modules land, add their permissions here and add RBAC tests.
"""
from app.auth.models import Role

PERMISSIONS: dict[str, list[str]] = {
    Role.SUPER_ADMIN.value: ["*"],
    Role.MANAGER.value: [
        "users:read",
        "employees:write",
        "attendance:write",
        "payroll:read",
        "vendors:write",
        "inventory:write",
        "recipes:write",
        "indent:approve",
        "sales:write",
        "sales:config",
        "reports:read",
    ],
    Role.KITCHEN_MANAGER.value: [
        "inventory:read",
        "recipes:write",
        "indent:write",
        "stock:read",
    ],
    Role.ACCOUNTANT.value: [
        "payroll:write",
        "vendor_payments:write",
        "vendors:read",
        "recipes:read",
        "reports:read",
    ],
    Role.CASHIER.value: [
        "sales:write",
        "cash:write",
    ],
    Role.STAFF.value: [
        "attendance:self",
        "payroll:self",
    ],
}


def has_permission(role: str, permission: str) -> bool:
    perms = PERMISSIONS.get(role, [])
    if "*" in perms or permission in perms:
        return True
    # ":write" on a module implies ":read" on that module.
    if permission.endswith(":read"):
        module = permission.rsplit(":", 1)[0]
        if f"{module}:write" in perms:
            return True
    return False
