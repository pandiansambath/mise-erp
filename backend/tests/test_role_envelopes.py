"""Role envelopes — the guarantee that an unsafe grant is UNREPRESENTABLE.

The owner names roles freely ("Kitchen Manager", "Accounts Assistant") but
cannot invent permissions: the base archetype fixes a ceiling. These tests
exist because the failure they prevent is silent — a waiter quietly holding
the hiring page looks like nothing until it matters.
"""
from app.core.rbac import ENVELOPES, PERMISSIONS, envelope_for, resolve_permissions


def test_staff_can_never_reach_hiring_however_hard_you_try() -> None:
    """The owner's exact worry: mis-ticking Hiring for a waiter."""
    assert "hiring:write" not in envelope_for("STAFF")
    granted = resolve_permissions("STAFF", {"hiring:write": True})
    assert "hiring:write" not in granted
    # ...and the same for the other things a waiter must never hold
    for forbidden in ("payroll:write", "reports:write", "vendors:write", "users:read"):
        assert forbidden not in resolve_permissions("STAFF", {forbidden: True}), forbidden


def test_a_permission_outside_the_envelope_is_dropped_not_honoured() -> None:
    """Overrides can outlive a tightening of the envelope. The safe reading of
    a stale grant is 'no', never 'yes'."""
    granted = resolve_permissions("CASHIER", {"payroll:write": True, "sales:write": True})
    assert "payroll:write" not in granted
    assert "sales:write" in granted


def test_owner_can_narrow_a_role_within_its_envelope() -> None:
    """Customising is the point — you just can't customise upward past the ceiling."""
    default = resolve_permissions("MANAGER", None)
    assert "payroll:read" in default
    narrowed = resolve_permissions("MANAGER", {"payroll:read": False})
    assert "payroll:read" not in narrowed
    # and can widen, but only to something already inside the envelope
    assert "payroll:write" in envelope_for("MANAGER")
    widened = resolve_permissions("MANAGER", {"payroll:write": True})
    assert "payroll:write" in widened


def test_every_default_permission_sits_inside_its_own_envelope() -> None:
    """A role whose defaults exceed its ceiling would be incoherent — the UI
    would show a granted permission it refuses to re-grant once toggled off."""
    for role, defaults in PERMISSIONS.items():
        if "*" in defaults:
            continue
        ceiling = set(ENVELOPES.get(role, []))
        assert set(defaults) <= ceiling, f"{role} defaults escape its envelope"


def test_owner_has_no_ceiling() -> None:
    assert resolve_permissions("SUPER_ADMIN", {"anything:at:all": False}) == ["*"]


def test_envelopes_never_hand_out_the_wildcard_by_accident() -> None:
    """Only the account owner may hold '*'. Anything else with a wildcard would
    silently make a staff role omnipotent."""
    for role, ceiling in ENVELOPES.items():
        if role == "SUPER_ADMIN":
            continue
        assert "*" not in ceiling, f"{role} envelope contains the wildcard"


def test_kitchen_never_touches_money_or_people() -> None:
    """Separation that protects the owner: a chef runs food, not payroll."""
    ceiling = envelope_for("KITCHEN_MANAGER")
    for forbidden in ("payroll:write", "payroll:read", "cash:write", "hiring:write"):
        assert forbidden not in ceiling, forbidden


def test_the_api_clips_a_grant_it_should_never_have_received() -> None:
    """The UI hides out-of-envelope permissions, so anything arriving here came
    from a stale client or someone poking the API. It is dropped silently —
    a 400 would let a caller map the ceiling by watching what gets rejected."""
    from app.auth.roles_router import _clip

    kept = _clip("STAFF", {"hiring:write": True, "attendance:self": True})
    assert "hiring:write" not in kept
    assert kept["attendance:self"] is True


def test_owner_archetype_is_not_offered_as_a_base() -> None:
    """A custom role based on the owner would just be a second owner, since the
    owner has no ceiling. If you want another owner, make them one explicitly."""
    from app.auth.roles_router import ASSIGNABLE

    assert "SUPER_ADMIN" not in ASSIGNABLE
    assert "STAFF" in ASSIGNABLE and "MANAGER" in ASSIGNABLE
