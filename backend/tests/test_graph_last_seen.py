"""Two questions the operator map answers, both from `usage_daily`.

Did they LOOK or CHANGE something, in each area? And has anybody really used
this restaurant lately? The second is the one that lies easily: a tab left open
still polls the bell, so "any traffic" would call an abandoned restaurant active.
"""
from datetime import date, timedelta

from app.hotels.models import Hotel
from app.platform_admin import graph
from app.platform_admin.models import UsageDaily


def _row(hotel_id, day, method, endpoint, requests):
    return UsageDaily(
        day=day, hotel_id=hotel_id, method=method, endpoint=endpoint, requests=requests
    )


async def test_an_area_says_how_much_was_changing_something(db, hotel) -> None:
    day = date(2026, 10, 15)
    db.add_all([
        _row(hotel.id, day, "GET", "/api/vendors", 10),
        _row(hotel.id, day, "POST", "/api/vendors", 2),
        _row(hotel.id, day, "DELETE", "/api/vendors/{id}", 1),
        _row(hotel.id, day, "GET", "/api/notifications", 40),
    ])
    await db.commit()
    areas, polled = await graph.areas_by_hotel(db, day, day)
    assert areas[hotel.id] == [{"area": "vendors", "requests": 13, "writes": 3}]
    assert polled[hotel.id] == 40


async def test_a_tab_left_open_is_not_somebody_using_it(db, hotel) -> None:
    used = date(2026, 10, 1)
    db.add_all([
        _row(hotel.id, used, "GET", "/api/inventory/items", 3),
        _row(hotel.id, used + timedelta(days=20), "GET", "/api/notifications", 900),
        _row(hotel.id, used + timedelta(days=20), "GET", "/api/talent/chats", 900),
    ])
    await db.commit()
    assert (await graph.last_seen_by_hotel(db))[hotel.id] == used


async def test_a_restaurant_nobody_has_touched_has_no_last_seen(db, hotel) -> None:
    other = Hotel(name="Elsewhere", country="GB", base_currency="GBP", city="Leeds")
    db.add(other)
    await db.commit()
    await db.refresh(other)
    db.add(_row(other.id, date(2026, 10, 2), "GET", "/api/notifications", 5))
    db.add(_row(hotel.id, date(2026, 10, 2), "GET", "/api/sales", 0))
    await db.commit()
    seen = await graph.last_seen_by_hotel(db)
    assert other.id not in seen and hotel.id not in seen
