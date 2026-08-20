"""Role envelopes — now a DEFAULT, not a ceiling.

These tests used to assert the opposite, and they were right for the design we
had: the base archetype fixed a ceiling and an unsafe grant was meant to be
unrepresentable. The owner has overruled that twice, in plain terms —

    "manager means what and all he can access... super admin can choose this,
     so please don't restrict any, let super admin do anything he wants."
    "we need literally ALL the pages access with read and write that super
     admin can choose to give. Give all toggles please."

— and he is right about whose call it is. It is his restaurant, his staff, and
he is the one who knows that his manager also does the rota. A ceiling that
cannot be raised is not safety, it is a guess about someone else's business
made by people who have never been in it.

So what is asserted here has changed shape rather than gone away. The envelope
still describes what a job does by DEFAULT, and the page marks anything outside
it as unusual. What must still hold: the KIOSK stays sealed, an unknown
permission is never honoured, and the owner can never be fenced out.
"""
from app.core.rbac import (
    ENVELOPES,
    GRANTABLE,
    PERMISSIONS,
    envelope_for,
    grantable_for,
    resolve_permissions,
)


def test_hiring_is_not_a_waiter_s_job_but_the_owner_may_still_grant_it() -> None:
    """Both halves matter.

    It is still not part of the job — the envelope says so, and the page uses
    that to mark the toggle "unusual". But an owner who deliberately switches it
    on gets it, because a small restaurant where the head waiter also does the
    hiring is an ordinary restaurant, not a misconfiguration.
    """
    assert "hiring:write" not in envelope_for("STAFF")

    granted = resolve_permissions("STAFF", {"hiring:write": True})
    assert "hiring:write" in granted, "the owner's deliberate grant was dropped"

    # And nothing is granted by accident: the default is still the default.
    assert "hiring:write" not in resolve_permissions("STAFF", {})


def test_a_permission_the_app_does_not_know_is_dropped_not_honoured() -> None:
    """The filter is now "is this real", not "is this typical".

    Opening the ceiling must not mean honouring any string that turns up. The
    safe reading of a grant we cannot interpret is still 'no'.
    """
    granted = resolve_permissions("CASHIER", {"payroll:write": True, "sales:write": True})
    assert "payroll:write" in granted, "a real permission the owner chose"
    assert "sales:write" in granted

    invented = resolve_permissions("CASHIER", {"payroll:make_me_owner": True})
    assert "payroll:make_me_owner" not in invented


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


def test_kitchen_defaults_stay_out_of_money_and_people() -> None:
    """A chef runs food, not payroll — as a DEFAULT. Nothing here stops an
    owner deciding otherwise for a particular person; it is what they get
    without anybody choosing."""
    ceiling = envelope_for("KITCHEN_MANAGER")
    for forbidden in ("payroll:write", "payroll:read", "cash:write", "hiring:write"):
        assert forbidden not in ceiling, forbidden
    for forbidden in ("payroll:write", "cash:write"):
        assert forbidden not in PERMISSIONS["KITCHEN_MANAGER"], forbidden


def test_the_api_keeps_real_grants_and_drops_invented_ones() -> None:
    """Still dropped SILENTLY rather than 400'd: a caller must not be able to
    map the app by watching which grants stick."""
    from app.auth.roles_router import _clip

    kept = _clip("STAFF", {"hiring:write": True, "attendance:self": True})
    assert kept["hiring:write"] is True
    assert kept["attendance:self"] is True

    assert _clip("STAFF", {"not:a-real-permission": True}) == {}


def test_the_kiosk_is_the_one_thing_that_stays_sealed() -> None:
    """A tablet by the door is not a person.

    Everything else opened up because there is somebody accountable holding it.
    Nobody is choosing to trust the kiosk — it sits in a doorway and gets
    handed round a room, so it keeps the ceiling everyone else lost.
    """
    sealed = set(grantable_for("KIOSK"))

    assert sealed == set(envelope_for("KIOSK"))
    assert len(sealed) < len(GRANTABLE)
    assert "payroll:write" not in resolve_permissions("KIOSK", {"payroll:write": True})


def test_owner_archetype_is_not_offered_as_a_base() -> None:
    """A custom role based on the owner would just be a second owner, since the
    owner has no ceiling. If you want another owner, make them one explicitly."""
    from app.auth.roles_router import ASSIGNABLE

    assert "SUPER_ADMIN" not in ASSIGNABLE
    assert "STAFF" in ASSIGNABLE and "MANAGER" in ASSIGNABLE
