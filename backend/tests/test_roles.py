"""What the owner is allowed to hand out.

The archetype's envelope used to be a ceiling in three places at once - the
sheet hid the controls, `_clip` dropped them on the way in, and
`resolve_permissions` dropped them again on the way out. These cover the
two that are not UI, because opening only one of them produces a toggle
that moves and then silently does nothing.
"""

def test_the_owner_can_grant_a_manager_anything():
    """"for manager we have only expense can change / can see option... bro we
    need literally ALL the pages access with read and write that super admin
    can choose to give. Give all toggles please."

    The archetype's envelope used to be a ceiling in three places at once — the
    page hid the controls, `_clip` dropped them on the way in, and
    `resolve_permissions` dropped them again on the way out. So an owner who
    wanted his manager on the rota was told, by an absence, that it could not
    be done.
    """
    from app.auth.models import Role
    from app.core.rbac import GRANTABLE, envelope_for, grantable_for, resolve_permissions

    manager = Role.MANAGER.value

    # The envelope still means something — it is just no longer the ceiling.
    assert len(envelope_for(manager)) < len(GRANTABLE)
    assert set(grantable_for(manager)) == set(GRANTABLE)

    outside = next(p for p in GRANTABLE if p not in set(envelope_for(manager)))
    assert outside in resolve_permissions(manager, {outside: True})


def test_the_kiosk_stays_sealed():
    """A tablet by the door is not a person. Nobody is choosing to trust it,
    and a device that gets handed round a room must not be grantable into the
    payroll."""
    from app.auth.models import Role
    from app.core.rbac import GRANTABLE, envelope_for, grantable_for

    kiosk = Role.KIOSK.value

    assert set(grantable_for(kiosk)) == set(envelope_for(kiosk))
    assert len(grantable_for(kiosk)) < len(GRANTABLE)


def test_an_invented_permission_is_still_ignored():
    """Opening the ceiling must not mean honouring any string that arrives."""
    from app.auth.models import Role
    from app.core.rbac import resolve_permissions

    got = resolve_permissions(Role.MANAGER.value, {"payroll:make_me_owner": True})

    assert "payroll:make_me_owner" not in got


def test_every_area_that_can_be_seen_can_be_seen_without_being_changed():
    """"we need literally all the pages access WITH READ AND WRITE."

    Expenses, Documents, Approving orders and Food safety were on-or-off. The
    routes had asked for `expenses:read` all along, but `:write` implies
    `:read`, so nobody had ever needed the read on its own and it was not
    grantable — leaving those rows with only "No access / Can change".
    """
    from app.auth.models import Role
    from app.core.rbac import GRANTABLE, READ_HALVES, resolve_permissions

    for half in READ_HALVES:
        assert half in GRANTABLE, half

    # Look, don't touch: the read on, the write explicitly off.
    got = resolve_permissions(
        Role.MANAGER.value, {"expenses:read": True, "expenses:write": False}
    )
    assert "expenses:read" in got
    assert "expenses:write" not in got


def test_food_safety_is_gated_by_its_own_permission_now():
    """The "Food safety" switch controlled NOTHING.

    The area toggled `safety:write`, and the safety router asked for
    `inventory:write` — two different keys, so the switch moved and the pages
    did not care. Re-pointing the router is only safe if nobody loses access
    they already had, which is what the second half checks.
    """
    import pathlib

    src = pathlib.Path("app/safety/router.py").read_text(encoding="utf-8")
    assert "inventory:write" not in src
    assert "inventory:read" not in src
    assert 'require("safety:write")' in src

    from app.auth.models import Role
    from app.core.rbac import has_permission

    # Exactly who reached it before, still reaches it.
    assert has_permission(Role.SUPER_ADMIN.value, "safety:write")
    assert has_permission(Role.MANAGER.value, "safety:write")
    assert not has_permission(Role.CASHIER.value, "safety:write")


def test_the_kiosk_is_not_offered_as_a_job():
    """"I would never need to see that word kiosk in role — it is an
    automatically created one, please just hide it."

    It is the tablet by the door: created by turning clock-in on, sealed so
    nothing can be added to it, and never something anybody is hired as.
    Listing it beside Manager invites "should my new person be a Kiosk?", which
    has no good answer.
    """
    from app.auth.models import Role
    from app.auth.roles_router import ASSIGNABLE

    assert Role.KIOSK.value not in ASSIGNABLE
    assert Role.SUPER_ADMIN.value not in ASSIGNABLE
    assert Role.MANAGER.value in ASSIGNABLE and Role.STAFF.value in ASSIGNABLE


def test_food_safety_is_gated_the_same_way_everywhere():
    """The API, the sidebar and the page all have to agree.

    Re-pointing the router at `safety:*` left the sidebar and the page itself
    still asking for `inventory:*`, which would have shown somebody a menu item
    leading to a 403 — the worst of both.
    """
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[2] / "frontend"
    shell = (root / "components" / "AppShell.tsx").read_text(encoding="utf-8")
    page = (root / "app" / "(app)" / "food-safety" / "page.tsx").read_text(encoding="utf-8")

    nav_line = next(ln for ln in shell.splitlines() if '"/food-safety"' in ln)
    assert 'perm: "safety:read"' in nav_line, nav_line
    assert 'can(user?.role, "safety:write")' in page
