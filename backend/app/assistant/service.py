"""Copilot orchestration: assemble the grounded prompt, run the model with tools,
and harvest navigation actions. Degrades to a deterministic answer with no key."""
from __future__ import annotations

import logging
import re
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.rbac import has_permission
from app.inventory import matching
from app.inventory.models import Item

from . import brain, guard
from .knowledge import PAGES, PERSONA, glossary_lookup, knowledge_brief
from .schemas import Action, ChatRequest, ChatResponse, ProposedAction
from .tools import EXECUTORS, tools_for

log = logging.getLogger(__name__)


async def _resolve_proposals(
    db: AsyncSession, hotel_id, proposals: list[dict]
) -> list[dict]:
    """Work out which stock item each vendor_price row means, BEFORE showing it.

    Matching used to happen when the button was pressed, so a price list looked
    entirely fine and then failed one row at a time — "when I click confirm it
    says not matching". You could not see what was wrong until you had already
    committed to it, twenty times over.

    Doing it here means the card arrives already knowing: matched rows say which
    item they are going to, and unmatched ones carry their shortlist so the
    choice is made in the same glance rather than after a refusal.

    The items are fetched ONCE for the whole batch — a price list is fifty rows,
    and fifty identical inventory queries is how a helpful feature becomes a
    slow one.
    """
    rows = [p for p in proposals if p.get("kind") == "vendor_price"]
    if not rows:
        return proposals

    items = list((await db.execute(select(Item).where(Item.hotel_id == hotel_id))).scalars())
    for p in rows:
        f = p.get("fields") or {}
        name = str(f.get("item") or "").strip()
        if not name or f.get("item_id"):
            continue
        try:
            m = await matching.resolve(db, hotel_id, name, items=items)
        except Exception:  # noqa: BLE001 — a matcher fault must not lose the row
            continue
        if m.certain and m.item_id:
            # Certain enough to fill in. The row still needs confirming; it
            # simply no longer needs a question first.
            f["item_id"] = str(m.item_id)
            f["item_matched"] = m.item_name
            f["match_how"] = m.status
        elif m.candidates:
            f["item_options"] = [
                {"id": str(c.item_id), "name": c.name, "score": c.score}
                for c in m.candidates
            ]
        p["fields"] = f
    return proposals



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


def _today_line(hotel) -> str:
    """Tell it what day it is.

    It did not know. Asked "what is today's date", it answered "I can't tell
    you today's exact date - I don't have a real-time clock" and offered to use
    whatever date the user typed. So every relative question - last month, this
    week, yesterday, "how are we doing today" - was answered from a guess, and
    "how much did we spend last month" came back about MAY when last month was
    July. It looked right often enough not to be noticed, because a tool that
    returns its own dates (the dashboard) quietly covered for it.

    The restaurant's OWN local date, not the server's: a London kitchen closing
    at 1am should not be told it is already tomorrow.
    """
    from app.core.timezones import hotel_today

    today = hotel_today(hotel) if hotel is not None else date.today()
    return (
        # %-d is glibc-only and raises on Windows, so build the day by hand.
        f"\n\nTODAY IS {today:%A} {today.day} {today:%B %Y} where this restaurant is. "
        "Work out 'last month', 'this week', 'yesterday' and every other "
        "relative date from THAT date. Never ask the user what today is, and "
        "never guess a month."
    )


def _build_system(
    user: User,
    route: str | None,
    user_name: str | None = None,
    hotel_name: str = "this restaurant",
    hotel=None,
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
        f"{_route_context(route)}{name_line}{_today_line(hotel)}\n\n"
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
        try:
            result = await fn(db, user, args)
        except Exception:  # noqa: BLE001
            # One broken tool must not cost the whole answer. `search_items`
            # raised AttributeError on every match for weeks and took the
            # entire reply down with it, because this call was unguarded.
            # Hand the fault back as data: the model still has its other tools
            # and can say what it could not look up, which is the honest
            # version of the same failure.
            log.exception("assistant tool %s failed", name)
            return {"error": f"The {name} lookup failed just then."}
        collected.extend(result.get("actions") or [])
        if result.get("proposal"):
            proposals.append(result["proposal"])
        return result

    # ONE brain: Claude on Bedrock, model chosen by the hotel's plan. No
    # third-party key, and therefore no silent drop to a scripted reply when a
    # key is missing — which is exactly what used to make the assistant look
    # like it knew nothing about the business.
    meter: dict = {}
    # What the assistant actually did, in order. Returned so the UI can show the
    # work instead of a spinner that gives no sign the thing is alive.
    trace: list[dict] = []
    try:
        reply, used = await brain.generate(
            system=_build_system(user, req.route, req.user_name, hotel_name, hotel) + prior,
            history=history,
            tools=tools_for(user, hotel),
            execute=execute,
            attachment=req.attachment.model_dump() if req.attachment else None,
            model=await guard.model_for(db, user),
            meter=meter,
            trace=trace,
        )
        if reply:
            reply, choices = _split_choices(reply)
            return ChatResponse(
                reply=reply,
                choices=choices,
                actions=_dedupe(collected),
                pending_actions=[
                    ProposedAction(**p)
                    for p in await _resolve_proposals(db, user.hotel_id, proposals)
                ],
                used_tools=used,
                trace=trace,
                configured=True,
            )
    except brain.BrainError:
        collected.clear()  # fall through to the deterministic answer

    # Only reached when Bedrock itself is unreachable.
    return await _fallback(db, user, history, req.route, collected, configured=False)


async def answer_stream(db: AsyncSession, user: User, req: ChatRequest):
    """The same answer, narrated as it is worked out.

    Yields the events the panel renders live: what it thought, which tool it
    reached for, then the reply a few words at a time. The final `done` carries
    everything the buffered endpoint would have returned — reply, actions,
    proposals, trace — so the client ends up in exactly the same state either
    way, and a dropped `delta` costs nothing.

    Falls back to the deterministic answer for the same reason `answer` does:
    if Bedrock is unreachable, a real reply beats an error.
    """
    from app.hotels.models import Hotel

    hotel = await db.get(Hotel, user.hotel_id)
    hotel_name = getattr(hotel, "name", None) or "this restaurant"

    prior = ""
    if req.thread_id:
        from app.assistant import memory

        prior = await memory.carryover(db, user, req.thread_id)
    history = [{"role": m.role, "content": m.content} for m in req.messages]
    collected: list[dict] = []
    proposals: list[dict] = []
    trace: list[dict] = []

    async def execute(name: str, args: dict) -> dict:
        fn = EXECUTORS.get(name)
        if fn is None:
            return {"error": f"unknown tool {name}"}
        try:
            result = await fn(db, user, args)
        except Exception:  # noqa: BLE001
            # One broken tool must not cost the whole answer. `search_items`
            # raised AttributeError on every match for weeks and took the
            # entire reply down with it, because this call was unguarded.
            # Hand the fault back as data: the model still has its other tools
            # and can say what it could not look up, which is the honest
            # version of the same failure.
            log.exception("assistant tool %s failed", name)
            return {"error": f"The {name} lookup failed just then."}
        collected.extend(result.get("actions") or [])
        if result.get("proposal"):
            proposals.append(result["proposal"])
        return result

    meter: dict = {}
    try:
        async for ev in brain.generate_stream(
            system=_build_system(user, req.route, req.user_name, hotel_name, hotel) + prior,
            history=history,
            tools=tools_for(user, hotel),
            execute=execute,
            attachment=req.attachment.model_dump() if req.attachment else None,
            model=await guard.model_for(db, user),
            meter=meter,
        ):
            kind = ev.get("type")
            if kind == "thought":
                trace.append({"kind": "thought", "text": ev["text"]})
                yield ev
            elif kind == "tool":
                trace.append({"kind": "tool", "name": ev["name"], "input": ev.get("input", "")})
                yield ev
            elif kind == "delta":
                yield ev
            elif kind == "done":
                reply, choices = _split_choices(ev.get("text") or "")
                if not reply:
                    break  # nothing usable — take the deterministic route below
                final = ChatResponse(
                    reply=reply,
                    choices=choices,
                    actions=_dedupe(collected),
                    pending_actions=[
                    ProposedAction(**p)
                    for p in await _resolve_proposals(db, user.hotel_id, proposals)
                ],
                    used_tools=ev.get("tools") or [],
                    trace=trace,
                    configured=True,
                )
                yield {"type": "done", "response": final.model_dump(mode="json"), "meter": meter}
                return
    except brain.BrainError:
        collected.clear()

    fallback = await _fallback(db, user, history, req.route, collected, configured=False)
    yield {"type": "done", "response": fallback.model_dump(mode="json"), "meter": meter}


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
            "\n\n(The full assistant is not reachable right now, so this is the "
            "built-in help. The numbers above are live and correct.)"
        )
    return base


async def short_line(db: AsyncSession, user, prompt: str) -> str:
    """One short sentence, no tools, no context, no memory.

    Used for the kiosk's daily line. Kept deliberately thin: the caller
    already has something on screen, so this is a nicety and must cost close
    to nothing — no tool loop, no history, no document context, and it still
    passes through the guard so it counts against the same allowance as
    everything else rather than being a hole in the metering.
    """
    model = await guard.model_for(db, user)
    meter: dict[str, object] = {}
    reply, _ = await brain.generate(
        system="You write one short line and nothing else. No preamble.",
        history=[{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        tools=[],
        execute=lambda *_a, **_k: {"ok": False},
        model=model,
        meter=meter,
    )
    # Counted against the same allowance as everything else, so this is not a
    # hole in the metering just because it is small.
    await guard.record(
        db,
        user,
        kind="kiosk-quote",
        model=model,
        input_tokens=int(meter.get("input_tokens", 60) or 60),
        output_tokens=int(meter.get("output_tokens", 30) or 30),
    )
    return reply or ""
