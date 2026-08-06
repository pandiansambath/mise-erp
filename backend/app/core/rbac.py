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
        "indent:write",
        "indent:approve",
        "sales:write",
        "sales:config",
        "orders:write",
        "expenses:write",
        "documents:write",
        "reports:write",
    ],
    Role.KITCHEN_MANAGER.value: [
        "inventory:read",
        "recipes:write",
        "indent:write",
        "stock:read",
        # The chef RUNS the live online-orders board (accept → cook → ready).
        "orders:write",
    ],
    Role.ACCOUNTANT.value: [
        "payroll:write",
        "vendor_payments:write",
        "vendors:read",
        "recipes:read",
        "expenses:write",
        "employees:read",
        "documents:write",
        "reports:read",
    ],
    Role.CASHIER.value: [
        "sales:write",
        "cash:write",
        "orders:write",
    ],
    Role.STAFF.value: [
        "attendance:self",
        "payroll:self",
    ],
    # The shared tablet by the door.
    #
    # It clocks people in and out and does nothing else. It sits unattended on
    # a counter where anyone can touch it, so every question about what it may
    # do answers itself: nothing that reveals what people earn, nothing that
    # touches money, nothing that rewrites a record after the fact. It reads
    # the employee list only to show names worth tapping.
    Role.KIOSK.value: [
        "attendance:write",
        "employees:read",
    ],
}


# ── Envelopes: the CEILING a base role can ever reach ───────────────────────
#
# PERMISSIONS above is what a role gets by DEFAULT. An envelope is the most it
# can EVER hold, however the owner configures it.
#
# This is the whole answer to "what if the owner accidentally ticks Hiring for
# a waiter?" — hiring is not in STAFF's envelope, so that toggle is never
# offered. You cannot misclick a control that does not exist. Validating the
# mistake afterwards would be weaker: the UI would have shown it as possible.
#
# Owners customise INSIDE the envelope; they never get a free-for-all grid.
ENVELOPES: dict[str, list[str]] = {
    # The owner is the account holder — no ceiling.
    Role.SUPER_ADMIN.value: ["*"],
    # A manager runs the venue. Everything except destroying the account or
    # touching payroll money, which stays with the owner/accountant.
    Role.MANAGER.value: PERMISSIONS[Role.MANAGER.value] + [
        "payroll:write", "cash:write", "vendor_payments:read",
        "hiring:write", "rota:write", "safety:write", "waste:write",
        "stock:write", "party:write", "ai:use",
    ],
    # A chef owns food: stock, recipes, ordering, safety, waste. Never money,
    # never people's pay, never hiring.
    Role.KITCHEN_MANAGER.value: PERMISSIONS[Role.KITCHEN_MANAGER.value] + [
        "vendors:read", "safety:write", "waste:write", "stock:write",
        "party:write", "rota:read", "ai:use",
    ],
    # Books and people-costs. No kitchen operations.
    Role.ACCOUNTANT.value: PERMISSIONS[Role.ACCOUNTANT.value] + [
        "cash:write", "vendor_payments:write", "sales:read", "ai:use",
    ],
    # Till and orders. Deliberately no stock writes and no people data.
    Role.CASHIER.value: PERMISSIONS[Role.CASHIER.value] + [
        "sales:read", "inventory:read", "party:read",
    ],
    # Their own record, and nothing else. Notice hiring, payroll and reports
    # are absent — no toggle can add them.
    Role.STAFF.value: PERMISSIONS[Role.STAFF.value] + [
        "rota:self", "documents:self",
    ],
    # Its ceiling IS its default — nothing may ever be added. A device anybody
    # can walk up to must not be one mis-tick away from the payroll.
    Role.KIOSK.value: list(PERMISSIONS[Role.KIOSK.value]),
}


def envelope_for(base_role: str) -> list[str]:
    """Every permission this base role may be granted. The toggle UI renders
    exactly this list, so an impossible grant is never even offered."""
    return sorted(set(ENVELOPES.get(base_role, [])))


def resolve_permissions(base_role: str, overrides: dict[str, bool] | None) -> list[str]:
    """A custom role's effective permissions.

    `overrides` is the owner's per-permission on/off map. Anything outside the
    envelope is DISCARDED rather than rejected — an override could survive a
    tightening of the envelope in a later release, and the safe reading of a
    stale grant is 'no'.
    """
    allowed = set(ENVELOPES.get(base_role, []))
    if "*" in allowed:
        return ["*"]
    effective = set(PERMISSIONS.get(base_role, []))
    for perm, on in (overrides or {}).items():
        if perm not in allowed:
            continue  # outside the ceiling — silently dropped, never granted
        if on:
            effective.add(perm)
        else:
            effective.discard(perm)
    return sorted(effective)


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
