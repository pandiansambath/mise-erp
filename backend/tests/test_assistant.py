"""Mise Copilot — knowledge grounding + the no-key deterministic fallback.

These exercise the assistant WITHOUT a live LLM key (CI has none): the
deterministic fallback must still answer glossary, live-data and navigation
questions, scoped to the user's role.
"""
from decimal import Decimal

import pytest

from app.assistant import ingest
from app.assistant import service as copilot
from app.assistant.knowledge import GLOSSARY, glossary_lookup, knowledge_brief
from app.assistant.schemas import ChatMessage, ChatRequest
from app.auth.models import Role
from app.core.rbac import has_permission
from app.inventory import service as inv


# ── Knowledge (pure) ──────────────────────────────────────────────────────────
def test_glossary_longest_match_wins():
    # 'food cost variance' must beat the shorter 'food cost'
    assert glossary_lookup("explain food cost variance") == GLOSSARY["food cost variance"]
    assert glossary_lookup("what does break even mean") == GLOSSARY["break even"]
    assert glossary_lookup("something unrelated entirely") is None


def test_slow_stock_is_distinct_from_low_stock():
    assert "slow" in (glossary_lookup("what is slow stock?") or "").lower()


def test_knowledge_brief_respects_role():
    can_admin = lambda p: has_permission(Role.SUPER_ADMIN.value, p)  # noqa: E731
    can_staff = lambda p: has_permission(Role.STAFF.value, p)  # noqa: E731
    assert "/money" in knowledge_brief(can_admin)
    # staff have no reports access, so the Money page must not be offered
    assert "(/money)" not in knowledge_brief(can_staff)


# ── Fallback behaviour (no LLM key) ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_fallback_explains_term(db, make_user):
    user = await make_user("owner@x.com", Role.SUPER_ADMIN.value)
    res = await copilot.answer(
        db, user, ChatRequest(messages=[ChatMessage(role="user", content="what is slow stock?")])
    )
    assert res.configured is False
    assert "slow" in res.reply.lower()


@pytest.mark.asyncio
async def test_fallback_reports_low_stock_with_link(db, make_user):
    user = await make_user("mgr@x.com", Role.SUPER_ADMIN.value)
    item = await inv.create_item(
        db, user.hotel_id, name="Paneer", unit="kg", min_stock_level=Decimal("10")
    )
    await inv.record_movement(db, item, "PURCHASE_IN", Decimal("2"), unit_cost=Decimal("3"))
    res = await copilot.answer(
        db, user, ChatRequest(messages=[ChatMessage(role="user", content="what is low on stock?")])
    )
    assert "Paneer" in res.reply
    assert "low_stock" in res.used_tools
    assert any(a.href == "/purchasing" for a in res.actions)


@pytest.mark.asyncio
async def test_fallback_navigates(db, make_user):
    user = await make_user("nav@x.com", Role.SUPER_ADMIN.value)
    res = await copilot.answer(
        db, user, ChatRequest(messages=[ChatMessage(role="user", content="where can I add a new supplier?")])
    )
    assert "navigate" in res.used_tools
    assert res.actions  # at least one direct link offered


@pytest.mark.asyncio
async def test_fallback_money_snapshot(db, make_user):
    user = await make_user("acc@x.com", Role.SUPER_ADMIN.value)
    res = await copilot.answer(
        db, user, ChatRequest(messages=[ChatMessage(role="user", content="how much profit this month?")])
    )
    assert "money_snapshot" in res.used_tools
    assert "£" in res.reply


# ── Endpoint wiring + auth ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_chat_requires_auth(client):
    r = await client.post(
        "/api/assistant/chat", json={"messages": [{"role": "user", "content": "hi"}]}
    )
    assert r.status_code in (401, 403)


@pytest.mark.asyncio
async def test_chat_endpoint_answers(client, make_user, auth_header):
    user = await make_user("u@x.com", Role.SUPER_ADMIN.value)
    r = await client.post(
        "/api/assistant/chat",
        json={"messages": [{"role": "user", "content": "what is a margin?"}]},
        headers=auth_header(user),
    )
    assert r.status_code == 200
    body = r.json()
    assert "margin" in body["reply"].lower()
    assert body["configured"] is False


@pytest.mark.asyncio
async def test_status_endpoint(client, make_user, auth_header):
    user = await make_user("s@x.com", Role.STAFF.value)
    r = await client.get("/api/assistant/status", headers=auth_header(user))
    assert r.status_code == 200
    assert r.json()["configured"] is False


# ── Document onboarding (commit path; extraction needs a live key) ─────────────
@pytest.mark.asyncio
async def test_ingest_commit_creates_items(db, make_user):
    user = await make_user("onb@x.com", Role.SUPER_ADMIN.value)
    rows = [
        {"name": "Tomato", "unit": "kg", "category": "Vegetables", "current_stock": 5, "cost_price": 1.2},
        {"name": "Paneer", "unit": "kg"},
        {"name": "", "unit": "kg"},  # no name → skipped silently
    ]
    res = await ingest.commit(db, user, "items", rows)
    assert set(res["created"]) == {"Tomato", "Paneer"}
    items = {i.name: i for i in await inv.list_items(db, user.hotel_id)}
    assert "Tomato" in items and "Paneer" in items
    # cost seeds the weighted-average so stock is valued from day one
    assert items["Tomato"].average_cost == Decimal("1.2")


@pytest.mark.asyncio
async def test_ingest_commit_skips_duplicates(db, make_user):
    user = await make_user("onb2@x.com", Role.SUPER_ADMIN.value)
    await inv.create_item(db, user.hotel_id, name="Onion", unit="kg")
    res = await ingest.commit(db, user, "items", [{"name": "Onion", "unit": "kg"}])
    assert res["created"] == [] and res["skipped"] == ["Onion"]


@pytest.mark.asyncio
async def test_ingest_commit_enforces_rbac(db, make_user):
    user = await make_user("onb3@x.com", Role.CASHIER.value)  # no inventory:write
    res = await ingest.commit(db, user, "items", [{"name": "X", "unit": "kg"}])
    assert "error" in res


@pytest.mark.asyncio
async def test_ingest_commit_creates_vendors(db, make_user):
    user = await make_user("onb4@x.com", Role.SUPER_ADMIN.value)
    rows = [{"name": "Fresh Farms", "category": "Vegetables", "mobile": "07123", "email": "a@b.com"}]
    res = await ingest.commit(db, user, "vendors", rows)
    assert res["created"] == ["Fresh Farms"]
