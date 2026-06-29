"""Mise Copilot — knowledge grounding + the no-key deterministic fallback.

These exercise the assistant WITHOUT a live LLM key (CI has none): the
deterministic fallback must still answer glossary, live-data and navigation
questions, scoped to the user's role.
"""
from datetime import date
from decimal import Decimal

import pytest

from app.assistant import actions, ingest
from app.assistant import service as copilot
from app.assistant.knowledge import GLOSSARY, glossary_lookup, knowledge_brief
from app.assistant.schemas import ChatMessage, ChatRequest
from app.assistant.tools import tools_for
from app.auth.models import Role
from app.core.rbac import has_permission
from app.expenses import service as exp_service
from app.inventory import service as inv
from app.sales import service as sales_service


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


# ── Write actions: propose → execute → undo ────────────────────────────────────
def test_build_proposal_validates_and_summarises():
    assert actions.build_proposal("expense", {})["ok"] is False
    assert "amount" in actions.build_proposal("expense", {})["missing"]
    p = actions.build_proposal("expense", {"amount": 50, "description": "gas", "category": "Utilities"})
    assert p["ok"] and "£50" in p["summary"]


def test_tools_filtered_by_role():
    admin_user = type("U", (), {"role": Role.SUPER_ADMIN.value})()
    staff_user = type("U", (), {"role": Role.STAFF.value})()
    assert "propose_expense" in [t["name"] for t in tools_for(admin_user)]
    staff_tools = [t["name"] for t in tools_for(staff_user)]
    assert "propose_expense" not in staff_tools  # no write perm
    assert "explain_term" in staff_tools  # read tools always offered


@pytest.mark.asyncio
async def test_act_expense_then_undo(db, make_user):
    user = await make_user("ax1@x.com", Role.SUPER_ADMIN.value)
    res = await actions.execute(db, user, "expense", {"amount": 50, "category": "Utilities", "description": "gas"})
    assert res["ok"] and res["undo"]["type"] == "expense"
    assert len(await exp_service.list_expenses(db, user.hotel_id)) == 1
    u = await actions.undo(db, user, "expense", res["undo"]["id"])
    assert u["ok"]
    assert len(await exp_service.list_expenses(db, user.hotel_id)) == 0


@pytest.mark.asyncio
async def test_act_sale_then_undo(db, make_user):
    user = await make_user("ax2@x.com", Role.SUPER_ADMIN.value)
    res = await actions.execute(db, user, "sale", {"amount": 120, "channel": "Dine-in"})
    assert res["ok"] and res["undo"]["type"] == "sale_line"
    today = date.today()
    assert len((await sales_service.day_summary(db, user.hotel_id, today))["lines"]) == 1
    u = await actions.undo(db, user, "sale_line", res["undo"]["id"])
    assert u["ok"]
    assert len((await sales_service.day_summary(db, user.hotel_id, today))["lines"]) == 0


@pytest.mark.asyncio
async def test_act_enforces_rbac(db, make_user):
    cashier = await make_user("ax3@x.com", Role.CASHIER.value)  # sales yes, expenses no
    assert (await actions.execute(db, cashier, "expense", {"amount": 10}))["ok"] is False
    assert (await actions.execute(db, cashier, "sale", {"amount": 10}))["ok"] is True


# ── Hands v2: recipe, stock-take, supplier price + chosen supplier ─────────────
@pytest.mark.asyncio
async def test_act_recipe_then_undo(db, make_user):
    from app.recipes import service as rec
    user = await make_user("hv2r@x.com", Role.SUPER_ADMIN.value)
    res = await actions.execute(db, user, "recipe", {"name": "Masala Dosa", "selling_price": 7.5})
    assert res["ok"] and res["undo"]["type"] == "recipe"
    recipes = await rec.list_recipes(db, user.hotel_id)
    assert any(r.name == "Masala Dosa" for r in recipes)
    u = await actions.undo(db, user, "recipe", res["undo"]["id"])
    assert u["ok"]
    active = await rec.list_recipes(db, user.hotel_id, active_only=True)
    assert not any(r.name == "Masala Dosa" for r in active)


@pytest.mark.asyncio
async def test_act_stock_count_adjusts_to_counted(db, make_user):
    user = await make_user("hv2s@x.com", Role.SUPER_ADMIN.value)
    item = await inv.create_item(db, user.hotel_id, name="Rice", unit="kg")
    await inv.record_movement(db, item, "PURCHASE_IN", Decimal("10"), unit_cost=Decimal("2"))
    res = await actions.execute(db, user, "stock_count", {"item": "Rice", "counted": 7})
    assert res["ok"]
    refreshed = await inv.get_item(db, item.id, user.hotel_id)
    assert refreshed.current_stock == Decimal("7")


@pytest.mark.asyncio
async def test_act_vendor_price_then_set_supplier(db, make_user):
    from app.vendors import service as ven
    user = await make_user("hv2v@x.com", Role.SUPER_ADMIN.value)
    await inv.create_item(db, user.hotel_id, name="Paneer", unit="kg")
    vendor = await ven.create_vendor(db, user.hotel_id, name="Fresh Farms")

    # Unknown supplier/item → friendly error, no write
    assert (await actions.execute(
        db, user, "vendor_price", {"item": "Paneer", "vendor": "Nope", "price": 5}
    ))["ok"] is False

    # Set the price, then choose them as the supplier
    assert (await actions.execute(
        db, user, "vendor_price", {"item": "Paneer", "vendor": "Fresh Farms", "price": 5.25}
    ))["ok"] is True
    res = await actions.execute(
        db, user, "set_supplier", {"item": "Paneer", "vendor": "Fresh Farms"}
    )
    assert res["ok"]
    vi = await ven.list_vendor_items(db, vendor.id)
    assert vi and vi[0].is_preferred is True and vi[0].price_per_unit == Decimal("5.25")


@pytest.mark.asyncio
async def test_set_supplier_without_price_is_blocked(db, make_user):
    from app.vendors import service as ven
    user = await make_user("hv2b@x.com", Role.SUPER_ADMIN.value)
    await inv.create_item(db, user.hotel_id, name="Ghee", unit="kg")
    await ven.create_vendor(db, user.hotel_id, name="Dairy Co")
    res = await actions.execute(db, user, "set_supplier", {"item": "Ghee", "vendor": "Dairy Co"})
    assert res["ok"] is False  # they don't supply it yet


# ── Multi-line proposal: recipe ingredients ────────────────────────────────────
def test_recipe_ingredients_proposal_validates():
    assert actions.build_proposal("recipe_ingredients", {"recipe": "Dosa"})["ok"] is False
    assert "lines" in actions.build_proposal("recipe_ingredients", {"recipe": "Dosa"})["missing"]
    p = actions.build_proposal(
        "recipe_ingredients",
        {"recipe": "Dosa", "lines": [{"item": "Rice", "quantity": 2, "unit": "kg"}]},
    )
    assert p["ok"] and "Dosa" in p["summary"] and "Rice" in p["summary"]


@pytest.mark.asyncio
async def test_act_recipe_ingredients_adds_lines(db, make_user):
    from app.recipes import service as rec
    user = await make_user("hv2ing@x.com", Role.SUPER_ADMIN.value)
    dish = await rec.create_recipe(db, user.hotel_id, name="Dosa", servings_default=1)
    await inv.create_item(db, user.hotel_id, name="Rice", unit="kg")
    res = await actions.execute(
        db, user, "recipe_ingredients",
        {
            "recipe": "Dosa",
            "lines": [
                {"item": "Rice", "quantity": 0.1, "unit": "kg"},
                {"item": "Urad Dal", "quantity": 50, "unit": "g"},  # not in stock → auto-created
            ],
        },
    )
    assert res["ok"]
    ings = await rec.list_ingredients(db, dish.id)
    assert len(ings) == 2
    # the auto-created ingredient now exists as a stock item
    items = {i.name for i in await inv.list_items(db, user.hotel_id)}
    assert "Urad Dal" in items


@pytest.mark.asyncio
async def test_recipe_ingredients_unknown_dish_errors(db, make_user):
    user = await make_user("hv2ing2@x.com", Role.SUPER_ADMIN.value)
    res = await actions.execute(
        db, user, "recipe_ingredients",
        {"recipe": "Ghost Dish", "lines": [{"item": "Rice", "quantity": 1, "unit": "kg"}]},
    )
    assert res["ok"] is False


# ── Accurate counts (no hallucinated numbers) ──────────────────────────────────
@pytest.mark.asyncio
async def test_business_overview_returns_real_recipe_count(db, make_user):
    from app.assistant.tools import business_overview, list_recipes
    from app.recipes import service as rec
    user = await make_user("cnt@x.com", Role.SUPER_ADMIN.value)
    await rec.create_recipe(db, user.hotel_id, name="Dosa", servings_default=1)
    await rec.create_recipe(db, user.hotel_id, name="Idli", servings_default=1)
    overview = await business_overview(db, user, {})
    assert overview["recipe_count"] == 2
    listing = await list_recipes(db, user, {})
    assert listing["recipe_count"] == 2
    assert {r["name"] for r in listing["recipes"]} == {"Dosa", "Idli"}


@pytest.mark.asyncio
async def test_act_purchase_creates_po(db, make_user):
    """Order stock by chat → an indent + a PO for the item's chosen supplier."""
    from app.purchasing import service as po_service
    from app.vendors import service as ven
    user = await make_user("po@x.com", Role.SUPER_ADMIN.value)
    h = user.hotel_id
    rice = await inv.create_item(db, h, name="Rice", unit="kg")
    vendor = await ven.create_vendor(db, h, name="Fresh Farms")
    await ven.upsert_vendor_item(db, vendor.id, rice.id, Decimal("2.00"), is_preferred=True)

    res = await actions.execute(
        db, user, "purchase",
        {"vendor": "Fresh Farms", "lines": [{"item": "Rice", "quantity": 10, "unit": "kg"}]},
    )
    assert res["ok"] and "purchase order" in res["summary"].lower()
    pos = await po_service.list_pos(db, h)
    assert len(pos) == 1

    # an item with no supplier price is reported, not ordered
    await inv.create_item(db, h, name="Salt", unit="kg")
    res2 = await actions.execute(
        db, user, "purchase", {"lines": [{"item": "Salt", "quantity": 1}]},
    )
    assert res2["ok"] and "Created 0 purchase orders" in res2["summary"]
