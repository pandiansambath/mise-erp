"""The AI is the only unbounded-cost surface in DineAI, so its limits are tested
like money code: a cap that silently doesn't bind is worse than no cap at all."""
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.assistant import guard
from app.assistant.models import AiUsage
from app.core.config import settings


class _FakeUser:
    def __init__(self) -> None:
        self.id = uuid.uuid4()
        self.hotel_id = uuid.uuid4()
        self.email = "owner@example.com"


def test_cost_uses_the_right_rate_card() -> None:
    # 1M in + 1M out on Sonnet == $3 + $15
    assert guard.estimate_cost("eu.anthropic.claude-sonnet-4-6", 1_000_000, 1_000_000) == Decimal(
        "18.000000"
    )
    # Haiku is the cheap lever and must price lower than Sonnet
    assert guard.estimate_cost("haiku", 1_000_000, 0) < guard.estimate_cost("sonnet", 1_000_000, 0)
    # an unknown model still costs something — never free by accident
    assert guard.estimate_cost("something-new", 1_000_000, 0) > 0


def test_haiku_is_priced_as_the_haiku_we_run() -> None:
    """features.HAIKU is Haiku 4.5: $1 in, $5 out per million. The table had
    Haiku 3.5's $0.80/$4.00 and under-stated every Haiku call (75.5)."""
    assert guard.estimate_cost("eu.anthropic.claude-haiku-4-5-20251001-v1:0", 1_000_000, 1_000_000) == Decimal(
        "6.000000"
    )
    # Haiku 5.5 must not be caught by the plain "haiku" row.
    assert guard.estimate_cost("eu.anthropic.claude-haiku-5-5", 1_000_000, 1_000_000) == Decimal("0.600000")


async def test_a_failed_ledger_write_keeps_the_callers_work(db) -> None:
    """75.5: record() used to roll the WHOLE session back when its insert
    failed, discarding the caller's unsaved rows and expiring its objects; a
    batch endpoint then touched one and answered 500. The ledger row now
    fails alone."""
    from sqlalchemy import select

    caller_hotel = uuid.uuid4()
    work = AiUsage(hotel_id=caller_hotel, user_id=None, kind="caller-work")
    db.add(work)  # the caller's unsaved work

    bad = _FakeUser()
    # 2**40 does not fit the Integer column: the INSERT itself fails.
    await guard.record(db, bad, kind="chat", model="haiku", input_tokens=2**40)

    # Still usable, nothing expired, and the caller can save its own work.
    assert work.kind == "caller-work"
    await db.commit()
    kinds = (await db.scalars(select(AiUsage.kind).where(AiUsage.hotel_id == caller_hotel))).all()
    assert kinds == ["caller-work"]
    assert not (await db.scalars(select(AiUsage.id).where(AiUsage.hotel_id == bad.hotel_id))).all()


async def test_kill_switch_blocks_everything(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", False)
    with pytest.raises(HTTPException) as exc:
        await guard.enforce(db, _FakeUser(), "chat")
    assert exc.value.status_code == 503


async def test_within_budget_is_allowed(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    await guard.enforce(db, _FakeUser(), "chat")  # no rows yet, must pass


async def test_hotel_daily_cap_binds(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_hotel_daily_requests", 2)
    monkeypatch.setattr(settings, "ai_user_per_minute", 0)  # isolate the daily cap
    user = _FakeUser()
    for _ in range(2):
        db.add(AiUsage(hotel_id=user.hotel_id, user_id=uuid.uuid4(), kind="chat"))
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await guard.enforce(db, user, "chat")
    assert exc.value.status_code == 429
    assert "allowance" in exc.value.detail


async def test_user_rate_limit_binds(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_user_per_minute", 1)
    user = _FakeUser()
    db.add(AiUsage(hotel_id=user.hotel_id, user_id=user.id, kind="chat"))
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await guard.enforce(db, user, "chat")
    assert exc.value.status_code == 429


async def test_monthly_token_cap_binds(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_user_per_minute", 0)
    monkeypatch.setattr(settings, "ai_hotel_daily_requests", 0)
    monkeypatch.setattr(settings, "ai_hotel_monthly_tokens", 1000)
    user = _FakeUser()
    db.add(
        AiUsage(hotel_id=user.hotel_id, kind="vision", input_tokens=900, output_tokens=200)
    )
    await db.commit()

    with pytest.raises(HTTPException) as exc:
        await guard.enforce(db, user, "vision")
    assert exc.value.status_code == 429


async def test_one_hotels_usage_never_limits_another(db, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_hotel_daily_requests", 1)
    noisy, quiet = _FakeUser(), _FakeUser()
    db.add(AiUsage(hotel_id=noisy.hotel_id, user_id=noisy.id, kind="chat"))
    await db.commit()

    await guard.enforce(db, quiet, "chat")  # must not raise


async def test_record_writes_a_costed_row(db, monkeypatch) -> None:
    user = _FakeUser()
    await guard.record(
        db, user, kind="vision", model="eu.anthropic.claude-sonnet-4-6",
        input_tokens=2000, output_tokens=500, latency_ms=1234,
    )
    s = await guard.summary(db, user)
    assert s["month_calls"] == 1
    assert s["month_tokens"] == 2500
    assert Decimal(s["month_cost_usd"]) > 0


async def test_a_feature_outside_the_plan_is_an_upsell_not_an_error(db, hotel, monkeypatch) -> None:
    """Kitchen has chat but NOT scanning. Asking to scan must sell the upgrade
    in the assistant's own voice, not return a dead end."""
    monkeypatch.setattr(settings, "ai_enabled", True)
    hotel.plan = "starter"
    hotel.features = {"ai_copilot": True, "ai_scan": False}
    await db.commit()

    user = _FakeUser()
    user.hotel_id = hotel.id

    # scanning is not in Kitchen -> a sales line, not an error
    with pytest.raises(HTTPException) as exc:
        await guard.enforce(db, user, "vision", feature="ai_scan")
    assert exc.value.status_code == 429
    assert "Pro" in exc.value.detail

    # but chat IS in Kitchen, so it must go through
    await guard.enforce(db, user, "chat", feature="ai_copilot")


async def test_entry_plan_runs_on_the_cheap_model(db, hotel) -> None:
    """Model tiering is what makes AI affordable on the entry plan."""
    from app.platform_admin import features as f

    hotel.plan = "starter"
    await db.commit()
    user = _FakeUser()
    user.hotel_id = hotel.id
    assert await guard.model_for(db, user) == f.HAIKU

    hotel.plan = "pro"
    await db.commit()
    assert await guard.model_for(db, user) == f.SONNET


def test_every_feature_is_priced_on_every_plan() -> None:
    """A feature nobody priced is revenue quietly lost."""
    from app.platform_admin import features as f

    for plan in f.PLANS:
        assert set(plan.includes) == set(f.ALL_KEYS), plan.key
    # The entry tier tastes the AI (chat) but not the expensive parts, and it
    # runs on the cheaper model — that combination is what keeps it affordable.
    kitchen = f.get_plan("starter")
    assert kitchen is not None
    assert kitchen.includes["ai_copilot"] is True
    assert kitchen.includes["ai_scan"] is False
    assert kitchen.includes["ai_insights"] is False
    assert kitchen.ai_model == f.HAIKU
    # the kitchen/service/group keys were live briefly — hotels created then
    # must still resolve, so this alias is load-bearing, not cosmetic
    assert f.get_plan("kitchen") is kitchen
    assert f.canonical_plan("service") == "pro"
    daily, monthly = f.plan_ai_limits("starter")
    assert 0 < daily <= 50 and 0 < monthly <= 1_000_000
    # paid tiers get the smarter model
    assert f.get_plan("pro").ai_model == f.SONNET
    # and the core money spine is in every plan
    for plan in f.PLANS:
        for key in f.CORE_KEYS:
            assert plan.includes[key] is True, (plan.key, key)
