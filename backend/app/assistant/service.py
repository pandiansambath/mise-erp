"""Copilot orchestration: assemble the grounded prompt, run the model with tools,
and harvest navigation actions. Degrades to a deterministic answer with no key."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.rbac import has_permission

from . import provider
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


def _build_system(user: User, route: str | None, user_name: str | None = None) -> str:
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


async def answer(db: AsyncSession, user: User, req: ChatRequest) -> ChatResponse:
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

    if provider.is_configured():
        try:
            reply, used = await provider.generate(
                system=_build_system(user, req.route, req.user_name),
                history=history,
                tools=tools_for(user),
                execute=execute,
                attachment=req.attachment.model_dump() if req.attachment else None,
            )
            return ChatResponse(
                reply=reply,
                actions=_dedupe(collected),
                pending_actions=[ProposedAction(**p) for p in proposals],
                used_tools=used,
                configured=True,
            )
        except provider.ProviderError:
            # fall through to the deterministic answer below
            collected.clear()

    return await _fallback(
        db, user, history, req.route, collected, configured=provider.is_configured()
    )


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
        "I can help you find your way around Mise and read your live numbers. "
        "Try: “what's low on stock?”, “how much profit this month?”, "
        "“what is slow stock?”, or “where do I reorder?”."
    )
    if not configured:
        base += (
            "\n\n(The smart AI isn't switched on yet — add a free Google AI Studio "
            "key to unlock full conversational answers.)"
        )
    return base
