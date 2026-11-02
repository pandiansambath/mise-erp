"""Read and put-away are remembered per PERSON, on the server (32.13).

    "Notification state needs a row, but NOT a notifications table ... one row
     per (user, key) that has been read or dismissed ... Buys dismiss,
     mark-all-read that sticks, and read-on-any-device."

The bell used to keep "seen" in the browser, so reading on the phone left the
laptop's bell lit, and a colleague's bell was never involved. Now it is a row —
and a row is only worth having if it is THIS person's in THIS restaurant.
"""
from app.auth.models import Role
from app.hotels.models import Hotel
from app.notifications import state

KEYS = ["alert:price:1", "alert:stock:2", "activity:3"]


async def test_a_read_mark_sticks_for_that_person(db, make_user) -> None:
    owner = await make_user("bell1@bell.test", Role.SUPER_ADMIN.value)
    await state.write(db, owner, ["alert:price:1"], live=set(KEYS), read=True)
    await db.commit()
    marks = await state.load(db, owner)  # a new "device" asking again
    assert marks["alert:price:1"].read is True
    assert "alert:stock:2" not in marks


async def test_a_colleague_does_not_inherit_my_reads(db, make_user) -> None:
    me = await make_user("bell2@bell.test", Role.SUPER_ADMIN.value)
    colleague = await make_user("bell2b@bell.test", Role.MANAGER.value)
    await state.write(db, me, KEYS, live=set(KEYS), read=True)
    await db.commit()
    assert await state.load(db, colleague) == {}


async def test_another_restaurant_never_sees_my_marks(db, make_user) -> None:
    other = Hotel(name="Elsewhere", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    me = await make_user("bell3@bell.test", Role.SUPER_ADMIN.value)
    stranger = await make_user("bell3s@bell.test", Role.SUPER_ADMIN.value, hotel_id=other.id)
    await state.write(db, me, KEYS, live=set(KEYS), dismissed=True)
    await db.commit()
    assert await state.load(db, stranger) == {}


async def test_putting_away_counts_as_read_and_can_be_undone(db, make_user) -> None:
    me = await make_user("bell4@bell.test", Role.SUPER_ADMIN.value)
    await state.write(db, me, ["activity:3"], live=set(KEYS), dismissed=True)
    await db.commit()
    mark = (await state.load(db, me))["activity:3"]
    assert mark.dismissed is True
    assert mark.read is True  # an undo must not bring it back unread
    await state.write(db, me, ["activity:3"], live=set(KEYS), dismissed=False)
    await db.commit()
    mark = (await state.load(db, me)).get("activity:3")
    assert mark is None or mark.dismissed is False
