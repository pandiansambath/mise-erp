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
async def test_the_owner_can_grant_one_person_anything(client, admin, auth_header, make_user):
    """"even though if we give manager role to someone, super admin can edit
    permission for that particular user alone."

    This asserted the opposite until today — that a waiter could not reach
    hiring however the grant arrived. The owner has overruled that: it is his
    restaurant, and the head waiter who also does the hiring is an ordinary
    arrangement rather than a mistake. What is still true is that he has to
    CHOOSE it, per person, and the page tells him it is unusual.
    """
    waiter = await make_user("waiter@test.com", Role.STAFF.value)
    h = auth_header(admin)
    r = await client.put(
        f"/api/roles/user/{waiter.id}/access",
        json={"base_role": Role.STAFF.value, "overrides": {"hiring:write": True, "payroll:write": True}},
        headers=h,
    )
    assert r.status_code == 200, r.text
    perms = r.json()["permissions"]
    assert "hiring:write" in perms
    assert "payroll:write" in perms


@pytest.mark.asyncio
async def test_a_plain_waiter_still_gets_a_waiter_s_access(client, admin, auth_header, make_user):
    """Opening the ceiling must not raise the FLOOR. Somebody who was never
    given anything extra keeps exactly what the job comes with."""
    waiter = await make_user("waiter2@test.com", Role.STAFF.value)
    h = auth_header(admin)
    r = await client.put(
        f"/api/roles/user/{waiter.id}/access",
        json={"base_role": Role.STAFF.value, "overrides": {}},
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


@pytest.mark.asyncio
async def test_a_job_can_be_set_once_and_everyone_inherits(client, admin, chef, auth_header):
    """"manager means what and all he can access... super admin can choose this."

    Set the job, and every holder of it inherits — no per-person visit."""
    h = auth_header(admin)
    r = await client.put(
        f"/api/roles/jobs/{Role.KITCHEN_MANAGER.value}",
        json={"permissions": ["recipes:write", "payroll:read", "reports:read"]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert "payroll:read" in r.json()["permissions"]

    # The chef holds that job and has no personal role, so they inherit it.
    me = await client.get("/api/auth/me", headers=auth_header(chef))
    assert me.status_code == 200, me.text
    assert "payroll:read" in me.json()["permissions"], "the job's setting never reached them"


@pytest.mark.asyncio
async def test_the_owner_is_not_fenced_in_by_the_envelope(client, admin, auth_header):
    """"so please dont restrci any please...let super admin can do anything he wnat."

    reports:write is outside a Till worker's envelope. The UI warns; the server
    obeys, because the person setting it owns the hotel."""
    h = auth_header(admin)
    r = await client.put(
        f"/api/roles/jobs/{Role.CASHIER.value}",
        json={"permissions": ["sales:write", "reports:write"]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert "reports:write" in r.json()["permissions"], "the envelope is still a wall"


@pytest.mark.asyncio
async def test_only_the_owner_may_redefine_a_job(client, make_user, auth_header):
    """A manager widening the manager role is a manager promoting themselves —
    the one grant nobody but the owner can walk back."""
    mgr = await make_user("mgr-job@test.com", Role.MANAGER.value)
    r = await client.put(
        f"/api/roles/jobs/{Role.MANAGER.value}",
        json={"permissions": ["payroll:write"]},
        headers=auth_header(mgr),
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_a_persons_own_tweak_still_beats_the_job(client, admin, chef, auth_header):
    """The exception has to win, or per-person editing means nothing."""
    h = auth_header(admin)
    await client.put(
        f"/api/roles/jobs/{Role.KITCHEN_MANAGER.value}",
        json={"permissions": ["recipes:write"]},
        headers=h,
    )
    await client.put(
        f"/api/roles/user/{chef.id}/access",
        json={"base_role": Role.KITCHEN_MANAGER.value, "overrides": {"stock:write": True}},
        headers=h,
    )
    me = (await client.get("/api/auth/me", headers=auth_header(chef))).json()
    assert "stock:write" in me["permissions"], "their own tweak was lost"
    assert "recipes:write" in me["permissions"], "the job underneath was lost"


@pytest.mark.asyncio
async def test_a_hotel_can_invent_a_role_and_put_someone_in_it(
    client, admin, auth_header, make_user
):
    """"what if hotel need to create their own role... may be paratha manager,
    poori manager. Anything."

    The five jobs we shipped were never a description of restaurants, they were
    a description of our database. This is the whole flow in one test: name a
    job nobody has ever heard of, say what it reaches, hand it to a person.
    """
    h = auth_header(admin)

    made = await client.post(
        "/api/roles",
        json={
            "name": "Poori Master",
            "base_role": Role.STAFF.value,
            "overrides": {"inventory:read": True, "recipes:write": True},
        },
        headers=h,
    )
    assert made.status_code == 201, made.text
    role = made.json()
    assert role["name"] == "Poori Master"
    assert "recipes:write" in role["permissions"]

    cook = await make_user("poori@test.com", Role.STAFF.value)
    put = await client.put(
        f"/api/roles/user/{cook.id}/role", json={"role_id": role["id"]}, headers=h
    )
    assert put.status_code == 200, put.text
    assert put.json()["custom_role_id"] == role["id"]


@pytest.mark.asyncio
async def test_a_new_role_starts_closed(client, admin, auth_header):
    """No starting point given means STAFF — the narrowest thing we have. A
    role begins shut and is opened deliberately, never the other way round."""
    r = await client.post("/api/roles", json={"name": "Tandoor Lead"}, headers=auth_header(admin))

    assert r.status_code == 201, r.text
    perms = r.json()["permissions"]
    assert "payroll:write" not in perms
    assert "reports:write" not in perms


@pytest.mark.asyncio
async def test_taking_someone_out_of_a_role_is_one_call(
    client, admin, auth_header, make_user
):
    made = await client.post(
        "/api/roles", json={"name": "Sweets Counter"}, headers=auth_header(admin)
    )
    role = made.json()
    person = await make_user("sweets@test.com", Role.STAFF.value)
    h = auth_header(admin)
    await client.put(f"/api/roles/user/{person.id}/role", json={"role_id": role["id"]}, headers=h)

    out = await client.put(f"/api/roles/user/{person.id}/role", json={"role_id": None}, headers=h)

    assert out.status_code == 200, out.text
    assert out.json()["custom_role_id"] is None


@pytest.mark.asyncio
async def test_a_role_from_another_hotel_cannot_be_handed_out(
    client, admin, auth_header, make_user, db
):
    """Tenant isolation on the new door, not just the old ones."""
    from app.auth.models import CustomRole
    from app.hotels.models import Hotel

    other = Hotel(name="Someone Else", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    theirs = CustomRole(hotel_id=other.id, name="Theirs", base_role=Role.MANAGER.value)
    db.add(theirs)
    await db.commit()

    person = await make_user("iso@test.com", Role.STAFF.value)
    r = await client.put(
        f"/api/roles/user/{person.id}/role",
        json={"role_id": str(theirs.id)},
        headers=auth_header(admin),
    )

    assert r.status_code == 404
