"""The float carries at midnight, and a past day can be seen and corrected.

    "if i enter today's sales and money box....yesterday sales related history
     i cant able to see even if i go back using time...... please be persistent
     also i can also edit that sales information if needed which will also sync
     wherever needed"
    "once time is 00:00 i mean 12am then the yesterday's sales closing amount
     (i mean the money box final amt) need to be showing as today's starting
     amount"

What was actually wrong, from his real restaurant's rows:

  * The carry was correct and REFUSED to work. 13→14→15→16→17 August carried
    to the penny, because each day was counted. Every day since 8 September
    was never counted, and `carried_opening` returned None for any uncounted
    day — so the float simply did not carry.
  * The nightly auto-close that was meant to count those days crashed every
    night it had work (see test_autoclose), and only ever looked at
    "yesterday", so one missed night stranded that day forever.
  * A past day LOOKED empty — blank add boxes, figures hidden in a list below
    — and there was no way to correct a saved figure except delete and retype.
"""
from datetime import date, timedelta
from decimal import Decimal

from app.auth.models import Role
from app.sales import cash, service
from app.sales.models import DailySales

D1 = date(2026, 9, 24)
D2 = date(2026, 9, 25)
D3 = date(2026, 9, 26)


async def _day(db, hotel, d, *, opening="100.00", counted=None, auto=False) -> DailySales:
    row = DailySales(
        hotel_id=hotel.id,
        date=d,
        opening_cash=Decimal(opening),
        cash_counted=None if counted is None else Decimal(counted),
        auto_closed=auto,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def _cash_channel(client, auth_header, user):
    """Any channel will do — these tests are about the day, not the channel.
    Listing them also seeds the defaults."""
    chans = (await client.get("/api/sales/channels", headers=auth_header(user))).json()
    return chans[0]


# ── the carry ─────────────────────────────────────────────────────────────


async def test_a_counted_day_carries_its_count(db, hotel) -> None:
    """The rule that always worked: counted close → next opening, exactly."""
    await _day(db, hotel, D1, counted="313.00")
    carry = await cash.carry_from(db, hotel.id, D2)
    assert carry == {"amount": Decimal("313.00"), "from_date": D1, "estimate": False}


async def test_an_uncounted_day_carries_its_expected_close(db, hotel) -> None:
    """⭐ THE FIX. This returned None before, which on his restaurant meant the
    float had not carried since 8 September.

    It carries the EXPECTED close and says it is an estimate — the same number
    the 1am auto-close would have written, available at 00:00 instead."""
    await _day(db, hotel, D1, opening="123.00")  # opened, never counted
    carry = await cash.carry_from(db, hotel.id, D2)
    assert carry is not None, "an uncounted day must still carry"
    assert carry["from_date"] == D1
    assert carry["estimate"] is True, "a guess must be labelled as a guess"
    assert carry["amount"] == Decimal("123.00")  # no cash sales, so expected = opening


async def test_a_closed_monday_does_not_reset_tuesday(db, hotel) -> None:
    """"The previous day" is the previous day that TRADED. Sunday's cash is
    still in the drawer on Tuesday morning."""
    await _day(db, hotel, D1, counted="250.00")
    # D2 — shut, no row at all.
    carry = await cash.carry_from(db, hotel.id, D3)
    assert carry is not None
    assert carry["from_date"] == D1
    assert carry["amount"] == Decimal("250.00")


async def test_an_auto_count_is_carried_as_an_estimate(db, hotel) -> None:
    """An auto-close is itself a guess; carrying it must not launder it into
    a measurement."""
    await _day(db, hotel, D1, counted="200.00", auto=True)
    carry = await cash.carry_from(db, hotel.id, D2)
    assert carry["estimate"] is True


async def test_the_chain_is_bounded(db, hotel) -> None:
    """Past a week of uncounted days the number is a guess about a guess — and
    an unbounded walk back is a recursion with no floor."""
    start = date(2026, 8, 1)
    for i in range(cash.MAX_CARRY_CHAIN + 3):
        # opening 0 and uncounted, so each day's own opening is itself a carry
        await _day(db, hotel, start + timedelta(days=i), opening="0")
    # Must terminate, whatever it returns.
    await cash.carry_from(db, hotel.id, start + timedelta(days=cash.MAX_CARRY_CHAIN + 3))


async def test_the_api_says_where_the_float_came_from(client, auth_header, make_user, db, hotel) -> None:
    """⚠️ Through the API, not the service — `response_model` drops any field
    the schema does not declare, silently, and that has bitten this project
    nine times."""
    owner = await make_user("owner@carry.test", Role.SUPER_ADMIN.value)
    await _day(db, hotel, D1, opening="123.00")
    body = (await client.get(f"/api/sales/days/{D2}", headers=auth_header(owner))).json()
    assert body["opening_carried_from"] == D1.isoformat()
    assert body["opening_is_estimate"] is True
    assert float(body["opening_cash"]) == 123.0


# ── a past day, corrected ─────────────────────────────────────────────────


async def test_a_saved_sale_can_be_corrected_in_place(client, auth_header, make_user) -> None:
    """⭐ "i can also edit that sales information".

    IN PLACE — same id — so the audit trail points at one sale being corrected
    rather than a sale deleted and a new one appearing."""
    owner = await make_user("owner2@carry.test", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    ch = await _cash_channel(client, auth_header, owner)
    added = (
        await client.post(
            f"/api/sales/days/{D2}/lines",
            headers=h,
            json={"channel_id": ch["id"], "gross_amount": "100", "payment_method": "CARD"},
        )
    ).json()
    line_id = added["lines"][0]["id"]

    res = await client.patch(
        f"/api/sales/days/{D2}/lines/{line_id}",
        headers=h,
        json={"gross_amount": "140", "payment_method": "CASH"},
    )
    assert res.status_code == 200, res.text
    line = res.json()["lines"][0]
    assert line["id"] == line_id, "corrected in place, not replaced"
    assert float(line["gross_amount"]) == 140.0
    assert line["payment_method"] == "CASH"
    # And it syncs: the day's totals are the new figure.
    assert float(res.json()["totals"]["gross"]) == 140.0


async def test_a_past_day_is_readable(client, auth_header, make_user) -> None:
    """"yesterday sales related history i cant able to see". The data was
    always stored; this holds that reading a past day returns it."""
    owner = await make_user("owner3@carry.test", Role.SUPER_ADMIN.value)
    h = auth_header(owner)
    ch = await _cash_channel(client, auth_header, owner)
    await client.post(
        f"/api/sales/days/{D1}/lines",
        headers=h,
        json={"channel_id": ch["id"], "gross_amount": "2141.43", "payment_method": "CARD"},
    )
    body = (await client.get(f"/api/sales/days/{D1}", headers=h)).json()
    assert float(body["totals"]["gross"]) == 2141.43
    assert len(body["lines"]) == 1


async def test_another_restaurants_sale_cannot_be_edited(client, auth_header, make_user) -> None:
    owner = await make_user("owner4@carry.test", Role.SUPER_ADMIN.value)
    import uuid

    res = await client.patch(
        f"/api/sales/days/{D2}/lines/{uuid.uuid4()}",
        headers=auth_header(owner),
        json={"gross_amount": "1"},
    )
    assert res.status_code == 404


async def test_a_bad_payment_method_is_refused(client, auth_header, make_user) -> None:
    owner = await make_user("owner5@carry.test", Role.SUPER_ADMIN.value)
    import uuid

    res = await client.patch(
        f"/api/sales/days/{D2}/lines/{uuid.uuid4()}",
        headers=auth_header(owner),
        json={"payment_method": "BITCOIN"},
    )
    assert res.status_code == 422


# ── keeping an auto-closed day honest ─────────────────────────────────────


async def test_an_auto_count_follows_an_edit(db, hotel) -> None:
    """An auto count is the EXPECTED cash at 1am — a guess. Change that day's
    takings afterwards and the guess must follow, or the day shows a variance
    nobody caused and tomorrow's float is wrong by exactly the edit."""
    from app.sales.models import SalesChannel

    chan = SalesChannel(hotel_id=hotel.id, name="Till", commission_pct=Decimal("0"))
    db.add(chan)
    await db.commit()
    row = await _day(db, hotel, D1, opening="100.00", counted="100.00", auto=True)
    await service.add_line(db, row, chan.id, Decimal("50"), "CASH")

    await service.resettle_if_auto(db, hotel.id, D1)
    await db.refresh(row)
    assert row.cash_counted == Decimal("150.00"), "the auto count did not follow the takings"
    assert row.auto_closed is True, "still a guess, still labelled as one"


async def test_a_human_count_never_follows_an_edit(db, hotel) -> None:
    """⭐ The asymmetry is the whole rule. Somebody counted real notes; changing
    a sale does not change what was physically in the drawer."""
    from app.sales.models import SalesChannel

    chan = SalesChannel(hotel_id=hotel.id, name="Till2", commission_pct=Decimal("0"))
    db.add(chan)
    await db.commit()
    row = await _day(db, hotel, D1, opening="100.00", counted="97.00", auto=False)
    await service.add_line(db, row, chan.id, Decimal("50"), "CASH")

    await service.resettle_if_auto(db, hotel.id, D1)
    await db.refresh(row)
    assert row.cash_counted == Decimal("97.00"), "a human count was overwritten"


def test_the_edit_schema_accepts_partial_changes() -> None:
    """Correcting the amount and correcting how it was paid are separate
    mistakes; neither should require re-sending the other."""
    from app.sales.schemas import LineUpdate

    assert LineUpdate(gross_amount=Decimal("5")).payment_method is None
    assert LineUpdate(payment_method="CASH").gross_amount is None
