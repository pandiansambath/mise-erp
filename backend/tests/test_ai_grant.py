"""AI is a grant with a ceiling, not a default.

    "only superadmin allowed to give ai feature, then only it need to show...
     under this we need to have some filter like whether to give haiku or
     sonnet, also whether to give our voice model, also what the max token max
     msg etc."

The ceiling is validated rather than stored as sent, and that is the part worth
testing: these numbers cap the only surface in the product whose cost has no
natural upper bound, so a typo here is a bill.
"""
import pytest

from app.auth.models import Role


@pytest.mark.asyncio
async def test_staff_do_not_get_ai_by_default(client, make_user, auth_header):
    """The bug he spotted: it was showing for staff. ai:use is not theirs."""
    staff = await make_user("ai-staff@nirai.com", Role.STAFF.value)
    me = await client.get("/api/auth/me", headers=auth_header(staff))
    assert me.status_code == 200
    assert "ai:use" not in me.json()["permissions"]


@pytest.mark.asyncio
async def test_ai_settings_save_and_come_back(client, make_user, auth_header):
    admin = await make_user("ai-admin@nirai.com", Role.SUPER_ADMIN.value)
    target = await make_user("ai-target@nirai.com", Role.MANAGER.value)
    h = auth_header(admin)

    r = await client.put(
        f"/api/roles/user/{target.id}/access",
        headers=h,
        json={
            "overrides": {"ai:use": True},
            "ai": {"model": "haiku", "voice": True, "max_tokens": 2000, "max_messages": 50},
        },
    )
    assert r.status_code == 200, r.text

    me = await client.get("/api/auth/me", headers=auth_header(target))
    got = me.json()["user"]["ai_settings"]
    assert got["model"] == "haiku"
    assert got["voice"] is True
    assert got["max_tokens"] == 2000
    assert got["max_messages"] == 50


@pytest.mark.asyncio
async def test_a_silly_ceiling_is_refused(client, make_user, auth_header):
    """A typo in a spend cap is a bill, so it is checked rather than trusted."""
    admin = await make_user("ai-admin2@nirai.com", Role.SUPER_ADMIN.value)
    target = await make_user("ai-target2@nirai.com", Role.MANAGER.value)
    h = auth_header(admin)

    huge = await client.put(
        f"/api/roles/user/{target.id}/access",
        headers=h,
        json={"overrides": {}, "ai": {"max_tokens": 999999}},
    )
    assert huge.status_code == 422

    words = await client.put(
        f"/api/roles/user/{target.id}/access",
        headers=h,
        json={"overrides": {}, "ai": {"max_messages": "lots"}},
    )
    assert words.status_code == 422


@pytest.mark.asyncio
async def test_an_unknown_model_is_dropped_not_stored(client, make_user, auth_header):
    """Only models we actually know how to call may be selected."""
    admin = await make_user("ai-admin3@nirai.com", Role.SUPER_ADMIN.value)
    target = await make_user("ai-target3@nirai.com", Role.MANAGER.value)

    r = await client.put(
        f"/api/roles/user/{target.id}/access",
        headers=auth_header(admin),
        json={"overrides": {}, "ai": {"model": "gpt-9"}},
    )
    assert r.status_code == 200
    me = await client.get("/api/auth/me", headers=auth_header(target))
    assert "model" not in me.json()["user"]["ai_settings"]


@pytest.mark.asyncio
async def test_ai_settings_can_be_set_on_the_job_and_a_person_still_wins(
    client, db, make_user, auth_header
):
    """"i said u to add ai related role toggles too nah. u said u added, but
    where?" — the panel existed on the per-PERSON sheet only. A job is where
    this belongs: setting the model once per role is a setting, setting it on
    every person who ever holds that role is a chore."""
    from app.assistant import guard

    owner = await make_user("job-ai-owner@nirai.com", Role.SUPER_ADMIN.value)
    chef = await make_user("job-ai-chef@nirai.com", Role.KITCHEN_MANAGER.value)

    saved = await client.put(
        f"/api/roles/jobs/{Role.KITCHEN_MANAGER.value}",
        headers=auth_header(owner),
        json={"permissions": ["inventory:read"], "ai": {"model": "haiku", "max_tokens": 900}},
    )
    assert saved.status_code == 200, saved.text

    listed = await client.get("/api/roles/jobs", headers=auth_header(owner))
    job = next(j for j in listed.json()["jobs"] if j["key"] == Role.KITCHEN_MANAGER.value)
    assert job["ai"]["model"] == "haiku"
    assert job["ai"]["max_tokens"] == 900

    # The chef inherits it without anybody touching their card.
    await db.refresh(chef)
    assert (await guard.effective_ai(db, chef))["model"] == "haiku"

    # And their own settings still win — that is what makes an exception one.
    chef.ai_settings = {"model": "sonnet"}
    await db.commit()
    await db.refresh(chef)
    assert (await guard.effective_ai(db, chef))["model"] == "sonnet"


@pytest.mark.asyncio
async def test_a_job_setting_cannot_buy_a_better_model_than_the_plan(
    client, db, hotel, make_user, auth_header
):
    """A setting must never be a way around the paywall. Downgrading is always
    allowed, because it can only ever cost less."""
    from app.assistant import guard

    owner = await make_user("plan-ai@nirai.com", Role.SUPER_ADMIN.value)
    hotel.plan = "kitchen"
    owner.ai_settings = {"model": "sonnet"}
    await db.commit()
    await db.refresh(owner)

    entry = await guard.model_for(db, owner)
    assert "sonnet" not in entry.lower()
