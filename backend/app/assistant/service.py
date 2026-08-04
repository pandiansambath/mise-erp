"""Copilot orchestration: assemble the grounded prompt, run the model with tools,
and harvest navigation actions. Degrades to a deterministic answer with no key."""
from __future__ import annotations

import re

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.rbac import has_permission

from . import brain, guard
from .knowledge import PAGES, PERSONA, glossary_lookup, knowledge_brief
from .schemas import Action, ChatRequest, ChatResponse, ProposedAction
from .tools import EXECUTORS, tools_for


def _can(user: User):
    return lambda perm: has_permission(user.role, perm)


def _route_context(route: str | None) -> str:
    if not route:
        return ""
    for p in PAGES:
        if p["route"] == route:
            return f"\nThe user is currently on the {p['label']} page ({route}): {p['about']}"
    return f"\nThe user is currently on {route}."


# Plain-English meaning of each role, so the assistant can reason about what the
# person in front of it is actually allowed to do — "SUPER_ADMIN" on its own
# told it nothing, which is how it ended up offering the owner the staff
# self-service page.
_ROLE_SENSE = {
    "SUPER_ADMIN": (
        "the OWNER of this restaurant's account. They can see and change "
        "everything here, including money, people and settings. Never suggest "
        "the staff self-service area ('My Space') to them - that is for their "
        "employees, not for them"
    ),
    "MANAGER": (
        "the restaurant MANAGER. They run the venue day to day: stock, suppliers, "
        "purchasing, sales, staff and rotas. They do not own the account"
    ),
    "KITCHEN_MANAGER": (
        "the CHEF / kitchen lead. Their world is food: stock, recipes, ordering, "
        "food safety and waste. They cannot see payroll, cash or hiring"
    ),
    "ACCOUNTANT": (
        "the ACCOUNTS person. Payroll, supplier payments, expenses and the books. "
        "They do not run kitchen operations"
    ),
    "CASHIER": (
        "on the TILL. Sales, cash and orders. They cannot see people's pay or "
        "change stock"
    ),
    "STAFF": (
        "a STAFF member. They see only their own rota, hours and payslips - "
        "nothing about the business's money or other people"
    ),
}


def _where_am_i(user: User, hotel_name: str) -> str:
    """Tell the assistant where it is sitting and who it is talking to.

    Without this it answers every question identically regardless of whether the
    owner, a chef or a waiter asked - which produces both wrong suggestions and
    answers that leak the shape of things a person cannot access.
    """
    if getattr(user, "is_platform_owner", False):
        return (
            "\n\nWHERE YOU ARE: the DineAI CONTROL ROOM - the platform "
            "operator's area, not a restaurant's own account. The person you are "
            "talking to runs the DineAI platform itself and works across many "
            "restaurants. Answer about the platform, plans and hotels in general; "
            "do not pretend to be inside one restaurant's kitchen."
        )
    sense = _ROLE_SENSE.get(user.role, f"a user with the role {user.role}")
    return (
        f"\n\nWHERE YOU ARE: inside {hotel_name}'s own DineAI account. "
        f"You are talking to {sense}.\n"
        "Answer for THIS restaurant and for THIS person's level of access. If they "
        "ask about something their role cannot reach, say so plainly and warmly "
        "rather than describing it or linking them to a page that will refuse "
        "them. Never suggest a page their role cannot open."
    )


def _build_system(
    user: User, route: str | None, user_name: str | None = None, hotel_name: str = "this restaurant"
) -> str:
    # Prefer the name the client passed (fresh edit); fall back to the one stored on
    # the account (server-side → works on any device, incl. staff logins).
    name = (user_name or "").strip() or (getattr(user, "preferred_name", None) or "").strip()
    name_line = ""
    if name:
        name_line = (
            f"\nThe user prefers to be called {name[:60]}. "
            "Address them warmly by that name."
        )
    return (
        f"{PERSONA}\n\n{knowledge_brief(_can(user))}"
        f"{_route_context(route)}{name_line}\n\n"
        f"The current user's role is {user.role}."
    )


def _dedupe(actions: list[dict]) -> list[Action]:
    seen: set[tuple[str, str]] = set()
    out: list[Action] = []
    for a in actions:
        href = a.get("href")
        label = a.get("label")
        if not href or not label or (label, href) in seen:
            continue
        seen.add((label, href))
        out.append(Action(label=label, href=href))
    return out


async def _gather_for_sonnet(db: AsyncSession, user: User, history: list[dict]) -> str:
    """Facts for the single-shot Sonnet path.

    The brain calls tools in a loop; this helper has no loop, so we run
    the cheap read-only tools up front and hand the results over. It costs one
    call instead of several, and means the assistant answers from real numbers
    rather than guessing.
    """
    import json

    out: dict = {}
    for name in ("business_overview", "team_and_access", "low_stock", "money_snapshot"):
        fn = EXECUTORS.get(name)
        if not fn:
            continue
        try:
            out[name] = await fn(db, user, {})
        except Exception:  # noqa: BLE001 — a missing section must not kill the answer
            continue
    return json.dumps(out, default=str)[:12000]


_CHOICES_RE = re.compile(r"\[\[CHOICES:\s*(.+?)\s*\]\]", re.S)


def _split_choices(reply: str) -> tuple[str, list[str]]:
    """Pull [[CHOICES: a | b]] out of the reply.

    The marker must never reach the screen — a user seeing our prompt syntax
    loses trust in everything else on the page. Options are capped at three
    because a wall of buttons is just a menu with extra steps.
    """
    m = _CHOICES_RE.search(reply or "")
    if not m:
        return (reply or "").strip(), []
    options = [o.strip() for o in m.group(1).split("|") if o.strip()][:3]
    return _CHOICES_RE.sub("", reply).strip(), options


async def answer(db: AsyncSession, user: User, req: ChatRequest) -> ChatResponse:
    from app.hotels.models import Hotel

    hotel = await db.get(Hotel, user.hotel_id)
    hotel_name = getattr(hotel, "name", None) or "this restaurant"

    # Threads give a clean screen; they are not amnesia. A little of what this
    # person said in earlier conversations rides along, so "that supplier" still
    # means something next week.
    prior = ""
    if req.thread_id:
        from app.assistant import memory

        prior = await memory.carryover(db, user, req.thread_id)
    history = [{"role": m.role, "content": m.content} for m in req.messages]
    collected: list[dict] = []
    proposals: list[dict] = []

    async def execute(name: str, args: dict) -> dict:
        fn = EXECUTORS.get(name)
        if fn is None:
            return {"error": f"unknown tool {name}"}
        result = await fn(db, user, args)
        collected.extend(result.get("actions") or [])
        if result.get("proposal"):
            proposals.append(result["proposal"])
        return result

    # ONE brain: Claude on Bedrock, model chosen by the hotel's plan. No
    # third-party key, and therefore no silent drop to a scripted reply when a
    # key is missing — which is exactly what used to make the assistant look
    # like it knew nothing about the business.
    meter: dict = {}
    try:
        reply, used = await brain.generate(
            system=_build_system(user, req.route, req.user_name, hotel_name) + prior,
            history=history,
            tools=tools_for(user, hotel),
            execute=execute,
            attachment=req.attachment.model_dump() if req.attachment else None,
            model=await guard.model_for(db, user),
            meter=meter,
        )
        if reply:
            reply, choices = _split_choices(reply)
            return ChatResponse(
                reply=reply,
                choices=choices,
                actions=_dedupe(collected),
                pending_actions=[ProposedAction(**p) for p in proposals],
                used_tools=used,
                configured=True,
            )
    except brain.BrainError:
        collected.clear()  # fall through to the deterministic answer

    # Only reached when Bedrock itself is unreachable.
    return await _fallback(db, user, history, req.route, collected, configured=False)


# ── No-LLM fallback ────────────────────────────────────────────────────────────
_LOW_WORDS = (
    "low", "running out", "run out", "reorder", "re-order",
    "what should i order", "out of stock",
)
_MONEY_WORDS = (
    "sales", "profit", "margin", "money", "how are we", "today", "this month", "revenue",
)
_NAV_WORDS = (
    "where", "how do i", "how can i", "take me", "go to", "open", "page",
    "navigate", "buy", "purchase",
)


async def _fallback(
    db: AsyncSession, user: User, history: list[dict], route: str | None,
    collected: list[dict], *, configured: bool,
) -> ChatResponse:
    """Deterministic best-effort answer used when no key is set (or the model
    errors). Keyword-routes to a tool or the glossary so it's still helpful."""
    last = next((m["content"] for m in reversed(history) if m["role"] == "user"), "")
    q = last.lower()
    used: list[str] = []

    async def run(name: str, args: dict) -> dict:
        used.append(name)
        result = await EXECUTORS[name](db, user, args)
        collected.extend(result.get("actions") or [])
        return result

    # 1) Glossary — "what is X"
    definition = glossary_lookup(q)
    if definition and any(w in q for w in ("what", "explain", "mean", "?")):
        reply = definition

    # 2) Low stock / reorder
    elif any(w in q for w in _LOW_WORDS):
        r = await run("low_stock", {})
        if r.get("error"):
            reply = r["error"]
        elif r["low_stock_count"] == 0:
            reply = "Good news — nothing is at or below its reorder level right now."
        else:
            names = ", ".join(
                f"{i['name']} ({i['current_stock']} {i['unit']})" for i in r["items"][:12]
            )
            reply = (
                f"{r['low_stock_count']} item(s) need attention: {names}. "
                "You can reorder on the Purchasing page."
            )

    # 3) Money / how are we doing
    elif any(w in q for w in _MONEY_WORDS):
        r = await run("money_snapshot", {})
        if r.get("error"):
            reply = r["error"]
        else:
            reply = (
                f"Today's net sales: £{r['today_net_sales']}. This month: "
                f"£{r['month_net_sales']} net sales, £{r['month_net_profit']} net profit "
                f"({r['month_net_margin_pct']}% margin). "
                f"{r['low_stock_count']} item(s) low on stock."
            )

    # 4) Navigation — where / how do I
    elif any(w in q for w in _NAV_WORDS):
        r = await run("navigate", {"query": last})
        pages = r.get("pages") or []
        if pages:
            reply = "Try " + ", ".join(f"{p['label']}" for p in pages) + ". " + pages[0]["about"]
        else:
            reply = "Head to the Dashboard to get your bearings."

    # 5) Otherwise, treat it as an item lookup if it's short, else help
    elif definition:
        reply = definition
    elif len(q.split()) <= 4 and has_permission(user.role, "inventory:read"):
        r = await run("search_items", {"query": last})
        rows = r.get("matches") or []
        if rows:
            reply = "; ".join(
                f"{i['name']}: {i['current_stock']} {i['unit']} in stock"
                + (" — LOW" if i["is_low"] else "")
                for i in rows[:8]
            )
        else:
            reply = _help_text(configured)
    else:
        reply = _help_text(configured)

    return ChatResponse(
        reply=reply, actions=_dedupe(collected), used_tools=used, configured=configured
    )


def _help_text(configured: bool) -> str:
    base = (
        "I can help you find your way around DineAI and read your live numbers. "
        "Try: “what's low on stock?”, “how much profit this month?”, "
        "“what is slow stock?”, or “where do I reorder?”."
    )
    if not configured:
        base += (
            "\n\n(The smart AI isn't switched on yet — add a free Google AI Studio "
            "key to unlock full conversational answers.)"
        )
    return base
