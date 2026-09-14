"""The operator's monitoring surface.

These endpoints exist because the data behind them had been accumulating for
months with nothing reading it — AI cost per hotel, every tenant's audit trail,
the AI conversations themselves.

They shipped with NO tests, and a verification pass made the consequence
plain: all three new `audit_service.record()` calls passed `user_id=`/
`user_email=` to a function whose signature is `user=`. CI only caught it
because `test_hotel_deletion.py` happened to exercise one of the three sites.
The other two — the comp/AI-override audit and the AI-transcript audit — would
have shipped green and raised `TypeError` on a live operator's first click.

So the rule these tests encode is: every endpoint is called at least once, and
every audit write is asserted to have actually produced a row. An audit call
that throws is worse than no audit call, because the feature it guards fails
with it.
"""

import uuid

import pytest

from app.assistant.models import AiUsage, AssistantMessage, AssistantThread
from app.audit.models import AuditEvent
from app.auth.models import Role
from app.hotels.models import Hotel


@pytest.fixture
async def operator(make_user, db):
    user = await make_user("obs-operator@dineai.cloud", Role.SUPER_ADMIN.value)
    user.is_platform_owner = True
    await db.commit()
    await db.refresh(user)
    return user


@pytest.fixture
async def busy_hotel(db) -> Hotel:
    """A restaurant that has actually used the thing, so nothing is all zeroes."""
    h = Hotel(name="Busy Bistro", country="GB", base_currency="GBP", city="Hull")
    h.username = "busy"
    db.add(h)
    await db.commit()
    await db.refresh(h)

    db.add(
        AiUsage(
            hotel_id=h.id, user_email="chef@busy.com", kind="chat",
            model="claude-sonnet-5", input_tokens=1000, output_tokens=200,
            cost_usd=0.05, latency_ms=800, ok=True,
        )
    )
    db.add(
        AiUsage(
            hotel_id=h.id, user_email="chef@busy.com", kind="chat",
            model="claude-sonnet-5", input_tokens=500, output_tokens=100,
            cost_usd=0.02, latency_ms=1200, ok=False,
        )
    )
    db.add(
        AuditEvent(
            hotel_id=h.id, user_email="chef@busy.com", action="vendor.price",
            summary="Tomatoes 1.20 -> 1.45",
        )
    )
    await db.commit()
    return h


# ── access ─────────────────────────────────────────────────────────────────


async def test_a_normal_super_admin_cannot_see_the_platform_surface(
    client, make_user, auth_header
) -> None:
    """`is_platform_owner` is the only gate, and it is not the same as being a
    super admin of your own restaurant."""
    owner = await make_user("justtheowner@test.com", Role.SUPER_ADMIN.value)
    res = await client.get("/api/platform/pulse", headers=auth_header(owner))
    assert res.status_code == 403


# ── the dashboard ──────────────────────────────────────────────────────────


async def test_pulse_answers_is_anything_wrong(client, operator, auth_header, busy_hotel) -> None:
    res = await client.get("/api/platform/pulse?days=30", headers=auth_header(operator))
    assert res.status_code == 200
    body = res.json()

    assert body["ai"]["calls"] == 2
    assert body["ai"]["failures"] == 1
    # The number that decides whether anyone trusts the assistant.
    assert body["ai"]["failure_rate"] == 0.5
    assert body["ai"]["cost_usd"] == pytest.approx(0.07)
    assert body["ai"]["tokens"] == 1800
    assert body["tenants"]["total"] >= 1
    assert body["activity"]["actions"] >= 1


async def test_pulse_never_divides_by_zero_on_a_quiet_platform(
    client, operator, auth_header
) -> None:
    """No AI calls at all is the normal state of a new deployment, and it must
    not be the state that 500s."""
    res = await client.get("/api/platform/pulse?days=30", headers=auth_header(operator))
    assert res.status_code == 200
    assert res.json()["ai"]["failure_rate"] == 0.0


async def test_ai_spend_is_attributed_to_the_right_restaurant(
    client, operator, auth_header, busy_hotel
) -> None:
    """The view that had never existed: who is spending the Bedrock budget."""
    res = await client.get("/api/platform/ai/by-hotel?days=30", headers=auth_header(operator))
    assert res.status_code == 200
    rows = {r["hotel_id"]: r for r in res.json()["hotels"]}
    row = rows[str(busy_hotel.id)]
    assert row["name"] == "Busy Bistro"
    assert row["calls"] == 2
    assert row["failures"] == 1
    assert row["cost_usd"] == pytest.approx(0.07)


async def test_ai_daily_buckets_by_day(client, operator, auth_header, busy_hotel) -> None:
    res = await client.get("/api/platform/ai/daily?days=30", headers=auth_header(operator))
    assert res.status_code == 200
    days = res.json()["days"]
    assert len(days) == 1, "both calls were today"
    assert days[0]["calls"] == 2


# ── one restaurant ─────────────────────────────────────────────────────────


async def test_hotel_health_reads_that_hotel_only(
    client, operator, auth_header, busy_hotel, hotel
) -> None:
    res = await client.get(
        f"/api/platform/hotels/{busy_hotel.id}/health", headers=auth_header(operator)
    )
    assert res.status_code == 200
    assert res.json()["ai_calls"] == 2

    other = await client.get(
        f"/api/platform/hotels/{hotel.id}/health", headers=auth_header(operator)
    )
    assert other.status_code == 200
    assert other.json()["ai_calls"] == 0, "one tenant's usage must not leak into another's"


async def test_hotel_activity_returns_that_tenants_own_audit_trail(
    client, operator, auth_header, busy_hotel
) -> None:
    """'Who changed this price?' — unanswerable from the console until now,
    because the operator side only ever queried `platform.%`."""
    res = await client.get(
        f"/api/platform/hotels/{busy_hotel.id}/activity", headers=auth_header(operator)
    )
    assert res.status_code == 200
    events = res.json()["events"]
    assert any(e["action"] == "vendor.price" for e in events)
    assert events[0]["who"] == "chef@busy.com"


async def test_activity_rejects_a_bad_cursor_with_400_not_500(
    client, operator, auth_header, busy_hotel
) -> None:
    res = await client.get(
        f"/api/platform/hotels/{busy_hotel.id}/activity?before=notadate",
        headers=auth_header(operator),
    )
    assert res.status_code == 400


# ── the conversations, and the record of reading them ──────────────────────


async def test_reading_a_transcript_writes_an_audit_row(
    client, operator, auth_header, busy_hotel, db
) -> None:
    """THE TEST THIS FEATURE EXISTS OR FALLS BY.

    Exposing one restaurant's private AI conversations to an operator is only
    defensible because the access is recorded. The audit write is deliberately
    placed BEFORE the read, so a read that errors is still logged — which also
    means a broken audit call takes the whole endpoint down with it. That is
    exactly what happened: `record()` was called with the wrong keyword and
    this endpoint raised `TypeError` on every request.
    """
    thread = AssistantThread(
        hotel_id=busy_hotel.id, user_id=operator.id, title="Why is my GP down?"
    )
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    db.add(
        AssistantMessage(
            hotel_id=busy_hotel.id, user_id=operator.id, thread_id=thread.id,
            role="user", content="why is my gross profit down",
        )
    )
    await db.commit()

    listed = await client.get(
        f"/api/platform/hotels/{busy_hotel.id}/ai-threads", headers=auth_header(operator)
    )
    assert listed.status_code == 200
    assert listed.json()["threads"][0]["title"] == "Why is my GP down?"

    res = await client.get(
        f"/api/platform/hotels/{busy_hotel.id}/ai-threads/{thread.id}",
        headers=auth_header(operator),
    )
    assert res.status_code == 200
    assert res.json()["messages"][0]["content"] == "why is my gross profit down"

    # The row must exist, and must name WHICH conversation was opened.
    from sqlalchemy import select

    rows = (
        await db.execute(
            select(AuditEvent).where(AuditEvent.action == "platform.read_ai_chat")
        )
    ).scalars().all()
    assert len(rows) == 1, "reading a private conversation must leave a trace"
    assert rows[0].entity_id == thread.id
    assert rows[0].user_email == operator.email


async def test_a_thread_id_from_another_hotel_returns_nothing(
    client, operator, auth_header, busy_hotel, hotel, db
) -> None:
    """Scoped by hotel AND thread, so an id from one tenant cannot be used to
    read another's conversation."""
    thread = AssistantThread(hotel_id=hotel.id, user_id=operator.id, title="Not yours")
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    db.add(
        AssistantMessage(
            hotel_id=hotel.id, user_id=operator.id, thread_id=thread.id,
            role="user", content="secret",
        )
    )
    await db.commit()

    res = await client.get(
        f"/api/platform/hotels/{busy_hotel.id}/ai-threads/{thread.id}",
        headers=auth_header(operator),
    )
    assert res.status_code == 200
    assert res.json()["messages"] == []


# ── the audit calls that were broken ───────────────────────────────────────


async def test_setting_flags_writes_an_audit_row(
    client, operator, auth_header, busy_hotel, db
) -> None:
    """Comping an account and lifting AI spend limits are money decisions and
    left no trace at all. This call site shipped with the wrong keyword and had
    no test to catch it."""
    res = await client.patch(
        f"/api/platform/hotels/{busy_hotel.id}/flags",
        json={"is_comp": True, "ai_daily_override": 500},
        headers=auth_header(operator),
    )
    assert res.status_code == 200
    assert res.json()["is_comp"] is True

    from sqlalchemy import select

    rows = (
        await db.execute(select(AuditEvent).where(AuditEvent.action == "platform.flags"))
    ).scalars().all()
    assert len(rows) == 1
    assert "comped=True" in rows[0].summary
    assert rows[0].user_email == operator.email


async def test_an_unknown_hotel_is_404_not_500(client, operator, auth_header) -> None:
    res = await client.patch(
        f"/api/platform/hotels/{uuid.uuid4()}/flags",
        json={"is_comp": True},
        headers=auth_header(operator),
    )
    assert res.status_code == 404
