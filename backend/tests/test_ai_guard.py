"""The AI is the only unbounded-cost surface in Mise, so its limits are tested
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


async def test_a_plan_without_ai_is_an_upsell_not_an_error(db, monkeypatch) -> None:
    """Kitchen has no AI. Asking must explain the upgrade, not look broken."""
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(guard.feat, "DEFAULT_PLAN", "kitchen")
    with pytest.raises(HTTPException) as exc:
        await guard.enforce(db, _FakeUser(), "vision")
    assert exc.value.status_code == 429
    assert "Upgrade" in exc.value.detail


def test_every_feature_is_priced_on_every_plan() -> None:
    """A feature nobody priced is revenue quietly lost."""
    from app.platform_admin import features as f

    for plan in f.PLANS:
        assert set(plan.includes) == set(f.ALL_KEYS), plan.key
    # AI is never in the entry tier — it is the only variable-cost feature
    kitchen = f.get_plan("kitchen")
    assert kitchen is not None
    for key in f.AI_KEYS:
        assert kitchen.includes[key] is False
    assert f.plan_ai_limits("kitchen") == (0, 0)
    # and the core money spine is in every plan
    for plan in f.PLANS:
        for key in f.CORE_KEYS:
            assert plan.includes[key] is True, (plan.key, key)
