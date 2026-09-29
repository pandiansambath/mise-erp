"""Typed-but-unsaved takings are kept, per person, and leave once saved.

    "once we entered the number store that in db (persistent) so that even if
     we unsaved also it will be persistent for reloads and all even login
     logout also we can still see unsaved entries safely"

The dangerous case is the one after a save: a figure that is saved but still
sitting in the draft comes back as "1 unsaved", and saving it again counts the
day's takings twice. So clearing it is part of the save, not a second call.
"""
from datetime import date

from sqlalchemy import select

from app.auth.models import Role
from app.hotels.models import Hotel
from app.sales.models import SalesDraft

DAY = date(2026, 9, 28)


async def _channels(client, h):
    return (await client.get("/api/sales/channels", headers=h)).json()


async def test_a_draft_comes_back_after_logging_in_again(client, auth_header, make_user) -> None:
    owner = await make_user("draft1@drafts.test", Role.SUPER_ADMIN.value)
    chans = await _channels(client, auth_header(owner))
    put = await client.put(
        f"/api/sales/days/{DAY}/draft",
        json={"entries": {chans[0]["id"]: {"amount": "500", "method": "CASH"}}},
        headers=auth_header(owner),
    )
    assert put.status_code == 200, put.text
    # A fresh token is what logging out and in again gives you.
    again = (await client.get(f"/api/sales/days/{DAY}/draft", headers=auth_header(owner))).json()
    assert again["entries"] == {chans[0]["id"]: {"amount": "500", "method": "CASH"}}
    # And it belongs to that day only.
    other = (await client.get("/api/sales/days/2026-09-27/draft", headers=auth_header(owner))).json()
    assert other["entries"] == {}


async def test_a_draft_is_private_to_the_person_who_typed_it(client, auth_header, make_user) -> None:
    """A colleague must not inherit — and could not safely save — someone
    else's half-typed figures."""
    owner = await make_user("draft2@drafts.test", Role.SUPER_ADMIN.value)
    manager = await make_user("draft2m@drafts.test", Role.MANAGER.value)
    chans = await _channels(client, auth_header(owner))
    await client.put(
        f"/api/sales/days/{DAY}/draft",
        json={"entries": {chans[0]["id"]: {"amount": "75.50"}}},
        headers=auth_header(owner),
    )
    theirs = (await client.get(f"/api/sales/days/{DAY}/draft", headers=auth_header(manager))).json()
    assert theirs["entries"] == {}


async def test_saving_a_figure_takes_it_out_of_the_draft(client, auth_header, make_user, db) -> None:
    owner = await make_user("draft3@drafts.test", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    a, b = (await _channels(client, h))[:2]
    await client.put(
        f"/api/sales/days/{DAY}/draft",
        json={"entries": {a["id"]: {"amount": "500"}, b["id"]: {"amount": "120"}}},
        headers=h,
    )
    saved = await client.post(
        f"/api/sales/days/{DAY}/lines",
        json={"channel_id": a["id"], "gross_amount": "500", "payment_method": "CASH"},
        headers=h,
    )
    assert saved.status_code == 201, saved.text
    left = (await client.get(f"/api/sales/days/{DAY}/draft", headers=h)).json()["entries"]
    assert a["id"] not in left, "a saved figure left in the draft would be saved twice"
    assert left[b["id"]]["amount"] == "120", "the figures NOT saved must stay"

    # Saving the last one removes the draft altogether.
    await client.post(
        f"/api/sales/days/{DAY}/lines",
        json={"channel_id": b["id"], "gross_amount": "120", "payment_method": "CARD"},
        headers=h,
    )
    rows = (await db.execute(select(SalesDraft).where(SalesDraft.user_id == owner.id))).scalars().all()
    assert rows == []


async def test_an_empty_draft_is_no_draft(client, auth_header, make_user, db) -> None:
    owner = await make_user("draft4@drafts.test", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    ch = (await _channels(client, h))[0]
    await client.put(f"/api/sales/days/{DAY}/draft", json={"entries": {ch["id"]: {"amount": "9"}}}, headers=h)
    await client.put(f"/api/sales/days/{DAY}/draft", json={"entries": {ch["id"]: {"amount": ""}}}, headers=h)
    rows = (await db.execute(select(SalesDraft).where(SalesDraft.user_id == owner.id))).scalars().all()
    assert rows == []


async def test_a_draft_cannot_point_at_another_restaurant(client, auth_header, make_user, db) -> None:
    other = Hotel(name="Elsewhere", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    stranger = await make_user("draft5s@drafts.test", Role.SUPER_ADMIN.value, hotel_id=other.id)
    theirs = (await _channels(client, auth_header(stranger)))[0]

    owner = await make_user("draft5@drafts.test", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    ours = (await _channels(client, h))[0]
    body = (
        await client.put(
            f"/api/sales/days/{DAY}/draft",
            json={"entries": {theirs["id"]: {"amount": "1"}, ours["id"]: {"amount": "2"}}},
            headers=h,
        )
    ).json()
    assert list(body["entries"]) == [ours["id"]]


async def test_junk_is_refused(client, auth_header, make_user) -> None:
    owner = await make_user("draft6@drafts.test", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    ch = (await _channels(client, h))[0]
    for bad in ({"amount": "12.345"}, {"amount": "abc"}, {"amount": "5", "method": "CHEQUE"}):
        r = await client.put(f"/api/sales/days/{DAY}/draft", json={"entries": {ch["id"]: bad}}, headers=h)
        assert r.status_code == 422, (bad, r.status_code)


async def test_someone_who_cannot_enter_sales_has_no_draft(client, auth_header, make_user) -> None:
    staff = await make_user("draft7@drafts.test", Role.STAFF.value)
    r = await client.get(f"/api/sales/days/{DAY}/draft", headers=auth_header(staff))
    assert r.status_code == 403
