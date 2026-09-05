"""The clock is the HOTEL's setting, stored in the database.

    "here i made as 12 hr format but this is not persisting... both are same
     superadmin but 1 is from incognito. make whatever superadmin setting as
     persistent. also this need to show in all lower logins too."
    "store in db and make it persistent"

It was localStorage: it died with the browser window and could never reach the
team. The interesting assertions here are the two halves of what he asked for —
it survives, and a DIFFERENT login sees it.
"""
import pytest

from app.auth.models import Role
from app.hotels import prefs as prefs_mod


@pytest.mark.asyncio
async def test_the_owner_sets_the_clock_and_everyone_sees_it(
    client, make_user, auth_header
):
    owner = await make_user("clock-owner@nirai.com", Role.SUPER_ADMIN.value)
    staff = await make_user("clock-staff@nirai.com", Role.STAFF.value)

    r = await client.patch(
        "/api/hotels/me",
        headers=auth_header(owner),
        json={"prefs": {"clock_12h": True, "clock_face": "railway"}},
    )
    assert r.status_code == 200, r.text

    # A different login, in the same hotel, reads the same clock. This is the
    # half localStorage could never do.
    me = await client.get("/api/auth/me", headers=auth_header(staff))
    assert me.status_code == 200
    got = me.json()["hotel"]["prefs"]
    assert got["clock_12h"] is True
    assert got["clock_face"] == "railway"


@pytest.mark.asyncio
async def test_every_face_the_picker_offers_is_accepted(client, make_user, auth_header):
    """The allowlist is copied from the UI, not invented.

    My first pass guessed three names that do not exist, so Railway, Skeleton
    and Regulator would have been silently rejected and snapped back to
    Classic — which reads exactly like "still not persisting".
    """
    owner = await make_user("clock-faces@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    for face in (
        "classic", "minimal", "roman", "braun",
        "railway", "bauhaus", "skeleton", "regulator",
    ):
        r = await client.patch("/api/hotels/me", headers=h, json={"prefs": {"clock_face": face}})
        assert r.status_code == 200, f"{face}: {r.text}"
        assert r.json()["prefs"]["clock_face"] == face, f"{face} did not stick"


@pytest.mark.asyncio
async def test_a_nonsense_face_falls_back_rather_than_breaking(client, make_user, auth_header, db):
    """Stored rubbish must not leave the clock unrenderable."""
    from app.hotels.models import Hotel

    owner = await make_user("clock-bad@nirai.com", Role.SUPER_ADMIN.value)
    hotel = await db.get(Hotel, owner.hotel_id)
    hotel.prefs = {"clock_face": "sundial"}
    await db.commit()
    assert prefs_mod.pref(hotel, "clock_face") == "classic"


@pytest.mark.asyncio
async def test_setting_one_pref_does_not_wipe_the_others(client, make_user, auth_header):
    """The merge matters: the clock and the PDF settings share one bag."""
    owner = await make_user("clock-merge@nirai.com", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    await client.patch("/api/hotels/me", headers=h, json={"prefs": {"clock_12h": True}})
    r = await client.patch("/api/hotels/me", headers=h, json={"prefs": {"qty_decimals": 2}})
    assert r.status_code == 200
    got = r.json()["prefs"]
    assert got["clock_12h"] is True, "changing one preference cleared another"
    assert got["qty_decimals"] == 2
