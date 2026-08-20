

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
