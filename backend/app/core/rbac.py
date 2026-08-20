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


#: Everything the app can grant a person. Not a role's *usual* set - the whole
#: board. The owner is entitled to see all of it.
GRANTABLE = sorted(
    {p for perms in PERMISSIONS.values() for p in perms if p != "*"}
    | {p for perms in ENVELOPES.values() for p in perms if p != "*"}
)


def envelope_for(base_role: str) -> list[str]:
    """What this job USUALLY reaches. A hint now, not a fence.

        "manager means what and all he can access... super admin can choose
         this... so please don't restrict any, let super admin do anything he
         wants."

    It used to be the ceiling: the UI rendered exactly this list, and anything
    outside it was dropped on the way in. So an owner who wanted his manager to
    see the rota was told, by an absence, that it was not possible - and the
    only signal was a toggle that was never drawn.

    The set still means something: it is what the job does by default, and the
    page marks anything outside it as unusual. Warn, do not block.
    """
    return sorted(set(ENVELOPES.get(base_role, [])))


def grantable_for(base_role: str) -> list[str]:
    """Every permission the owner may switch on for this job.

    The KIOSK is the one exception and stays sealed: it is a tablet by the
    door, not a person. Nobody is choosing to trust it, and a device that can
    be handed round a room must not be grantable into the payroll.
    """
    if base_role == Role.KIOSK.value:
        return sorted(set(ENVELOPES.get(base_role, [])))
    return list(GRANTABLE)


def resolve_permissions(base_role: str, overrides: dict[str, bool] | None) -> list[str]:
    """A custom role's effective permissions.

    `overrides` is the owner's per-permission on/off map. It used to be clipped
    to the archetype's ENVELOPE here as well as on the way in, so even a stored
    grant outside the usual set was dropped at read time - which meant loosening
    the write path alone would have changed nothing.

    Now the only filter is "is this a permission the app knows about", plus the
    KIOSK's seal. An unknown string is still ignored: the safe reading of a
    grant we cannot interpret is 'no'.
    """
    if "*" in set(ENVELOPES.get(base_role, [])):
        return ["*"]
    allowed = set(grantable_for(base_role))
    effective = set(PERMISSIONS.get(base_role, []))
    for perm, on in (overrides or {}).items():
        if perm not in allowed:
            continue  # not a permission we know how to honour
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
