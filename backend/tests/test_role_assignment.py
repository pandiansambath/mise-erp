"""Giving somebody a role the hotel designed.

The designer shipped without this half: you could build "Kitchen Manager,
view-only payroll" and never hand it to anyone, because nothing could write
`custom_role_id`. These cover the half that was missing, and the two ways it
could be dangerous.

The dangerous ways are the point:

* **Cross-tenant.** A designed role belongs to one restaurant. Accepting one
  from another would be a privilege grant across the tenancy boundary — the
  worst thing this endpoint could be talked into.
* **Mismatched envelope.** A role's overrides were clipped against ONE
  archetype's envelope. Applied to a different base they could carry
  permissions that base may never hold, which is exactly the "what if the
  superadmin mistakenly gives Staff hiring" fear the envelope model exists to
  make unrepresentable.
"""
import pytest

from app.auth.models import CustomRole, Role


@pytest.fixture
async def admin(make_user):
    return await make_user("boss@test.com", Role.SUPER_ADMIN.value)


@pytest.fixture
async def chef(make_user):
    return await make_user("chef@test.com", Role.KITCHEN_MANAGER.value)


async def _role(db, hotel_id, name="Kitchen Lead", base=Role.KITCHEN_MANAGER.value, overrides=None):
    cr = CustomRole(
        hotel_id=hotel_id,
        name=name,
        base_role=base,
        overrides=overrides or {},
        is_active=True,
    )
    db.add(cr)
    await db.commit()
    await db.refresh(cr)
    return cr


async def test_a_designed_role_can_be_given_to_someone(
    client, db, hotel, admin, chef, auth_header
) -> None:
    """The half that was missing. Without it the whole designer is ornamental."""
    cr = await _role(db, hotel.id)

    res = await client.patch(
        f"/api/auth/users/{chef.id}",
        json={"custom_role_id": str(cr.id)},
        headers=auth_header(admin),
    )
    assert res.status_code == 200
    assert res.json()["custom_role_id"] == str(cr.id)


async def test_it_can_be_taken_away_again(
    client, db, hotel, admin, chef, auth_header
) -> None:
    """"Back to the plain archetype" has to be expressible, or a custom role
    could never be removed."""
    cr = await _role(db, hotel.id)
    await client.patch(
        f"/api/auth/users/{chef.id}",
        json={"custom_role_id": str(cr.id)},
        headers=auth_header(admin),
    )

    res = await client.patch(
        f"/api/auth/users/{chef.id}",
        json={"clear_custom_role": True},
        headers=auth_header(admin),
    )
    assert res.status_code == 200
    assert res.json()["custom_role_id"] is None


async def test_a_role_from_another_restaurant_is_refused(
    client, db, admin, chef, auth_header
) -> None:
    """A cross-tenant privilege grant. Nothing else in this file matters if
    this one fails."""
    from app.hotels.models import Hotel

    other = Hotel(name="Someone Else", country="GB", base_currency="GBP", city="Bath")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    theirs = await _role(db, other.id, name="Their Manager")

    res = await client.patch(
        f"/api/auth/users/{chef.id}",
        json={"custom_role_id": str(theirs.id)},
        headers=auth_header(admin),
    )
    assert res.status_code == 404


async def test_a_role_built_on_a_different_archetype_is_refused(
    client, db, hotel, admin, chef, auth_header
) -> None:
    """Its overrides were clipped against a different envelope, so applying it
    here could carry permissions this base may never hold."""
    manager_role = await _role(db, hotel.id, name="Ops Manager", base=Role.MANAGER.value)

    res = await client.patch(
        f"/api/auth/users/{chef.id}",  # chef is KITCHEN_MANAGER
        json={"custom_role_id": str(manager_role.id)},
        headers=auth_header(admin),
    )
    assert res.status_code == 400
    assert "Manager" in res.json()["detail"]


async def test_a_deactivated_role_cannot_be_handed_out(
    client, db, hotel, admin, chef, auth_header
) -> None:
    """Deactivating is how a hotel retires a role. It must stop being
    assignable at the same moment, not just stop being listed."""
    cr = await _role(db, hotel.id)
    cr.is_active = False
    await db.commit()

    res = await client.patch(
        f"/api/auth/users/{chef.id}",
        json={"custom_role_id": str(cr.id)},
        headers=auth_header(admin),
    )
    assert res.status_code == 404


async def test_changing_the_archetype_drops_a_role_built_on_the_old_one(
    client, db, hotel, admin, chef, auth_header
) -> None:
    """Otherwise the person keeps overrides clipped to an envelope that no
    longer applies — silently, which is the worst way for a permission to be
    wrong."""
    cr = await _role(db, hotel.id)
    await client.patch(
        f"/api/auth/users/{chef.id}",
        json={"custom_role_id": str(cr.id)},
        headers=auth_header(admin),
    )

    res = await client.patch(
        f"/api/auth/users/{chef.id}",
        json={"role": Role.STAFF.value},
        headers=auth_header(admin),
    )
    assert res.status_code == 200
    assert res.json()["role"] == Role.STAFF.value
    assert res.json()["custom_role_id"] is None


async def test_a_staff_member_cannot_hand_out_roles(
    client, db, hotel, chef, make_user, auth_header
) -> None:
    """This is `users:write`. Someone able to grant themselves permissions is
    not a permission system."""
    cr = await _role(db, hotel.id)
    nobody = await make_user("waiter@test.com", Role.STAFF.value)

    res = await client.patch(
        f"/api/auth/users/{chef.id}",
        json={"custom_role_id": str(cr.id)},
        headers=auth_header(nobody),
    )
    assert res.status_code in (401, 403)


# ── One person, one call ──────────────────────────────────────────────────────
# The old shape needed four: choose an archetype, toggle inside it, name and
# save a role, then attach it. The proof it did not work is that his hotel had
# designed exactly one role and attached it to nobody.


@pytest.mark.asyncio
async def test_setting_one_persons_access_creates_and_attaches_in_one_call(
    client, admin, chef, auth_header
):
    h = auth_header(admin)
    r = await client.put(
        f"/api/roles/user/{chef.id}/access",
        json={"base_role": Role.KITCHEN_MANAGER.value, "overrides": {"stock:write": True}},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["custom_role_id"], "no role was created for them"
    assert "stock:write" in body["permissions"]

    # And the person really holds it — not just the response saying so.
    users = (await client.get("/api/auth/users", headers=h)).json()
    mine = [u for u in users if u["id"] == str(chef.id)][0]
    assert mine["custom_role_id"] == body["custom_role_id"]


@pytest.mark.asyncio
async def test_access_matching_the_job_exactly_leaves_no_role_behind(
    client, admin, chef, auth_header
):
    """Back to plain: detach rather than keep an empty role pretending to be a
    decision. Otherwise every person accumulates a role that says nothing."""
    h = auth_header(admin)
    await client.put(
        f"/api/roles/user/{chef.id}/access",
        json={"base_role": Role.KITCHEN_MANAGER.value, "overrides": {"stock:write": True}},
        headers=h,
    )
    r = await client.put(
        f"/api/roles/user/{chef.id}/access",
        json={"base_role": Role.KITCHEN_MANAGER.value, "overrides": {}},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["custom_role_id"] is None


@pytest.mark.asyncio
async def test_the_ceiling_still_holds_through_the_new_door(client, admin, auth_header, make_user):
    """A waiter must not reach hiring however the grant arrives."""
    waiter = await make_user("waiter@test.com", Role.STAFF.value)
    h = auth_header(admin)
    r = await client.put(
        f"/api/roles/user/{waiter.id}/access",
        json={"base_role": Role.STAFF.value, "overrides": {"hiring:write": True, "payroll:write": True}},
        headers=h,
    )
    assert r.status_code == 200, r.text
    perms = r.json()["permissions"]
    assert "hiring:write" not in perms
    assert "payroll:write" not in perms


@pytest.mark.asyncio
async def test_the_owner_cannot_be_limited(client, admin, auth_header):
    """No envelope, no toggle and no guard may fence the owner out of their own
    hotel — it is the account that rescues every other one."""
    h = auth_header(admin)
    r = await client.put(
        f"/api/roles/user/{admin.id}/access",
        json={"base_role": Role.MANAGER.value, "overrides": {}},
        headers=h,
    )
    assert r.status_code == 400
