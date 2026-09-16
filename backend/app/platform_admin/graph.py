"""The whole platform as one graph: what exists, what it uses, what it costs.

    "litrelly like a human brain sumilation neural netork UI view we need...
     under proejct how mamy hotels are ther..unders hotel what are all ther..
     what using..what aws bill they consufe..what ai they using..hw muhc time..
     how many token"

One operator-only read that answers "which one is under which one, and how are
they chained to one another" — for the whole platform at once, from our own
Postgres and with no AWS call.

WHY THIS IS A GRAPH AND NOT A TREE
--------------------------------------------------------------------------
A tree would be enough for "under the project, how many restaurants". It is not
enough for anything else on that list, because the interesting relationships are
the ones that CROSS the hierarchy:

  * several restaurants call the SAME Bedrock model, so a model is not owned by
    a restaurant — it is a shared node several of them point at;
  * every restaurant shares ONE EC2 box and ONE database, so cost does not
    descend a tree, it is apportioned back UP one and down another;
  * the biggest single source of traffic — 72% of it — belongs to no restaurant
    at all.

FIVE QUERIES, AND THE NUMBER DOES NOT GROW
--------------------------------------------------------------------------
One per source table, each aggregating in SQL. The failure mode this exists to
avoid is a per-hotel query inside a loop: correct at three restaurants, fifty
round trips a page load at fifty. Every query here groups by `hotel_id` and
returns one row per restaurant, so the count is five whether the fleet is three
or three hundred.

THE HONESTY RULES, WHICH ARE STRICTER HERE THAN ANYWHERE
--------------------------------------------------------------------------
1. ALIVENESS IS PER CHANNEL, NEVER PER NODE. `ai_usage` and `usage_daily`
   disagree, and the disagreement is true: NIRAI.Reading has 60 AI calls and no
   measured HTTP requests at all. A single `active` boolean would have to pick
   one of those and call the other a lie. So every restaurant carries a
   `channels` map and each channel says separately whether it has ever fired.

2. NOTHING MEASURED IS NOT ZERO. Our counters started long after the platform
   did. A restaurant that predates them must report `measured: false`, not `0` —
   `0 requests` is a claim that nothing happened, and we do not know that.

3. MODELLED IS MARKED. The shared box costs the same with one restaurant or
   fifty, so a restaurant's "share" of it is a split of rent, not a measurement
   of blame. Every modelled figure carries `modelled: true` and the UI is
   required to draw it differently.

4. ORPHANS ARE NOT DROPPED. `ai_usage.hotel_id` has no foreign key, so spend
   outlives the restaurant: there is real usage today attached to a hotel row
   that no longer exists. Discarding it would make the totals stop adding up,
   and an orphan with money attached is exactly what a map like this is for.

WHAT MUST NEVER BE IN HERE
--------------------------------------------------------------------------
This is the one endpoint that legitimately crosses every tenant, so it is an
INFRASTRUCTURE map and nothing else. No dish names, no staff names, no customer
or order data, no message content — only counts, costs and configuration. If a
field would embarrass one restaurant in front of another, it does not belong.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import Integer, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant.models import AiUsage
from app.core import usage as usage_mod
from app.hotels.models import Hotel
from app.platform_admin.cost_map import PLATFORM, SHARED, classify
from app.platform_admin.models import (
    ANON_HOTEL,
    OPERATOR_HOTEL,
    CloudCostDaily,
    UsageDaily,
)

#: Node kinds. The UI keys shape and colour off these, so they are part of the
#: contract and not free-form labels.
PLATFORM_NODE = "platform"
RESTAURANT = "restaurant"
ANON = "anonymous"
OPERATOR = "operator"
ORPHAN = "orphan"
SERVICE = "service"
MODEL = "model"


def _f(v: Any) -> float:
    return float(v or 0)


async def build(
    db: AsyncSession, *, start: date, end: date, include_silent: bool = True
) -> dict:
    """Nodes and edges for the period. Five queries, none of them per-hotel."""

    # ── 1. every restaurant that EXISTS, traffic or not ───────────────────
    hotels = (
        await db.execute(
            select(
                Hotel.id, Hotel.name, Hotel.username, Hotel.is_active, Hotel.created_at
            )
        )
    ).all()

    # ── 2. HTTP, grouped by hotel ─────────────────────────────────────────
    http_rows = (
        await db.execute(
            select(
                UsageDaily.hotel_id,
                func.sum(UsageDaily.requests),
                func.sum(UsageDaily.db_selects),
                func.sum(UsageDaily.db_writes),
                func.sum(UsageDaily.errors_5xx),
                func.sum(UsageDaily.duration_ms),
            )
            .where(UsageDaily.day >= start, UsageDaily.day <= end)
            .group_by(UsageDaily.hotel_id)
        )
    ).all()
    http = {
        r[0]: {
            "requests": int(r[1] or 0),
            "db_selects": int(r[2] or 0),
            "db_writes": int(r[3] or 0),
            "errors_5xx": int(r[4] or 0),
            "avg_ms": round(_f(r[5]) / max(1, int(r[1] or 1))),
        }
        for r in http_rows
    }

    # ── 3. AI, grouped by hotel ───────────────────────────────────────────
    ai_rows = (
        await db.execute(
            select(
                AiUsage.hotel_id,
                func.count(AiUsage.id),
                func.sum(AiUsage.input_tokens),
                func.sum(AiUsage.output_tokens),
                func.sum(AiUsage.cost_usd),
                func.avg(AiUsage.latency_ms),
                func.sum(func.cast(~AiUsage.ok, Integer)),
                func.max(AiUsage.created_at),
            )
            .where(
                AiUsage.created_at >= _dt(start),
                AiUsage.created_at < _dt(end) + timedelta(days=1),
            )
            .group_by(AiUsage.hotel_id)
        )
    ).all()
    ai = {
        r[0]: {
            "calls": int(r[1] or 0),
            "tokens_in": int(r[2] or 0),
            "tokens_out": int(r[3] or 0),
            "cost_usd": _f(r[4]),
            "avg_latency_ms": round(_f(r[5])),
            "failures": int(r[6] or 0),
            "last_used": r[7].isoformat() if r[7] else None,
        }
        for r in ai_rows
    }

    # ── 4. AI per (hotel, model) — THE CROSS-LINKS ────────────────────────
    # This is the query that makes the picture a graph rather than a tree: the
    # same model node is pointed at by several restaurants.
    link_rows = (
        await db.execute(
            select(
                AiUsage.hotel_id,
                AiUsage.model,
                func.count(AiUsage.id),
                func.sum(AiUsage.input_tokens + AiUsage.output_tokens),
                func.sum(AiUsage.cost_usd),
                func.avg(AiUsage.latency_ms),
            )
            .where(
                AiUsage.created_at >= _dt(start),
                AiUsage.created_at < _dt(end) + timedelta(days=1),
                AiUsage.model != "",
            )
            .group_by(AiUsage.hotel_id, AiUsage.model)
        )
    ).all()

    # ── 6. WHAT EACH RESTAURANT ACTUALLY USES ─────────────────────────────
    #
    #     "unders hotel what are all ther..what using"
    #
    # Grouped by the AREA of the endpoint — `/api/inventory/items` is the
    # inventory area — because that is the closest thing we measure to "a
    # feature somebody used". It is EVIDENCE rather than configuration: the
    # features map on `hotels` says what is switched ON, which is a different
    # and much weaker claim than what anybody opened.
    #
    # Attached to the restaurant rather than promoted to its own ring of nodes.
    # Thirty-three feature nodes per restaurant would triple the node count to
    # say something that belongs on one node's own card, and the map's whole
    # argument is that thirteen big legible nodes beat a hundred small ones.
    area_rows = (
        await db.execute(
            select(
                UsageDaily.hotel_id,
                func.split_part(UsageDaily.endpoint, "/", 3).label("area"),
                func.sum(UsageDaily.requests),
            )
            .where(UsageDaily.day >= start, UsageDaily.day <= end)
            .group_by(UsageDaily.hotel_id, "area")
        )
    ).all()
    areas: dict[Any, list[dict]] = {}
    for hid, area, reqs in area_rows:
        if not area:
            continue
        areas.setdefault(hid, []).append({"area": area, "requests": int(reqs or 0)})
    for v in areas.values():
        v.sort(key=lambda r: -r["requests"])

    # ── 5. the AWS bill, grouped by service ───────────────────────────────
    cost_rows = (
        await db.execute(
            select(
                CloudCostDaily.service,
                CloudCostDaily.usage_type,
                func.sum(CloudCostDaily.amount_usd),
            )
            .where(
                CloudCostDaily.day >= start,
                CloudCostDaily.day <= end,
                CloudCostDaily.record_type.notin_(("Credit", "Refund")),
            )
            .group_by(CloudCostDaily.service, CloudCostDaily.usage_type)
        )
    ).all()

    # ══ assemble ══════════════════════════════════════════════════════════
    nodes: list[dict] = []
    edges: list[dict] = []

    known_ids = {h[0] for h in hotels}
    total_requests = sum(v["requests"] for v in http.values())

    # -- services, and the pools they sit in --
    by_service: dict[str, dict] = {}
    for service, utype, amount in cost_rows:
        amount = Decimal(amount or 0)
        pool = classify(service, utype)
        # Bedrock is N service keys with the MODEL NAME INSIDE each one, so it
        # is folded into a single node here and split by model on the edges.
        key = "Amazon Bedrock" if "bedrock" in service.lower() else service
        s = by_service.setdefault(
            key, {"usd": Decimal(0), "pools": set(), "lines": 0}
        )
        s["usd"] += amount
        s["pools"].add(pool)
        s["lines"] += 1

    cost_total = sum((s["usd"] for s in by_service.values()), Decimal(0))

    nodes.append({
        "id": "platform",
        "kind": PLATFORM_NODE,
        "label": "DineAI",
        "detail": {
            "restaurants": len(hotels),
            "requests": total_requests,
            "measured": bool(http),
            "aws_usd": _f(cost_total),
            "period": {"from": start.isoformat(), "to": end.isoformat()},
        },
    })

    # -- restaurants --
    for hid, name, handle, is_active, created in hotels:
        h = http.get(hid)
        a = ai.get(hid)
        nodes.append({
            "id": str(hid),
            "kind": RESTAURANT,
            "label": name,
            "detail": {
                "handle": handle,
                "is_active": bool(is_active),
                "created_at": created.isoformat() if created else None,
                #: The areas they actually opened, busiest first. Measured, not
                #: configured — "switched on" and "used" are different claims.
                "areas": (areas.get(hid) or [])[:12],
            },
            # PER CHANNEL, because a node can be alive on one and silent on the
            # other and a single boolean would have to call one of them a lie.
            "channels": {
                "http": _channel(h, "requests"),
                "ai": _channel(a, "calls"),
            },
            "metrics": {**(h or {}), **{f"ai_{k}": v for k, v in (a or {}).items()}},
        })
        if h and h["requests"]:
            edges.append(_edge(str(hid), "platform", "http", h["requests"],
                               measured=True, label=f"{h['requests']:,} requests"))

    # -- the anonymous sentinel: 72% of everything, and nobody's --
    anon = http.get(ANON_HOTEL)
    if anon:
        nodes.append({
            "id": str(ANON_HOTEL),
            "kind": ANON,
            "label": "Public traffic",
            "detail": {
                "what": (
                    "Requests belonging to no signed-in restaurant: public pages, "
                    "sign-in, diner QR menus, health checks."
                ),
                "share_of_requests": (
                    round(100 * anon["requests"] / total_requests, 1)
                    if total_requests
                    else None
                ),
            },
            "channels": {"http": _channel(anon, "requests"), "ai": _channel(None, "calls")},
            "metrics": anon,
        })
        edges.append(_edge(str(ANON_HOTEL), "platform", "http", anon["requests"],
                           measured=True, label=f"{anon['requests']:,} requests"))

    # -- US, running the Control Room --
    op = http.get(OPERATOR_HOTEL)
    if op:
        nodes.append({
            "id": str(OPERATOR_HOTEL),
            "kind": OPERATOR,
            "label": "Control Room",
            "detail": {
                "what": (
                    "Our own operator traffic. Counted, but never billed to a "
                    "restaurant — an operator is always signed in as a user of "
                    "some hotel, and without this bucket every Control Room "
                    "page load landed on whichever one that was."
                ),
            },
            "channels": {
                "http": _channel(op, "requests"),
                "ai": _channel(None, "calls"),
            },
            "metrics": op,
        })
        edges.append(_edge(str(OPERATOR_HOTEL), "platform", "http", op["requests"],
                           measured=True, label=f"{op['requests']:,} requests"))

    # -- orphans: usage whose restaurant is gone --
    for hid in sorted(set(ai) | set(http), key=str):
        if hid in known_ids or hid in (ANON_HOTEL, OPERATOR_HOTEL):
            continue
        a, h = ai.get(hid), http.get(hid)
        nodes.append({
            "id": str(hid),
            "kind": ORPHAN,
            "label": "Deleted restaurant",
            "detail": {
                "what": (
                    "Usage recorded against a restaurant that no longer exists. "
                    "Kept so the totals still add up."
                ),
            },
            "channels": {"http": _channel(h, "requests"), "ai": _channel(a, "calls")},
            "metrics": {**(h or {}), **{f"ai_{k}": v for k, v in (a or {}).items()}},
            # The UI draws this edge stopping short of the platform: charge with
            # nowhere to go.
            "severed": True,
        })

    # -- AWS services --
    #
    # SEVEN OF SEVENTEEN BILLED NOTHING. Glue, SQS, SNS, Textract, KMS,
    # Transcribe, Secrets Manager — services that exist on the account and cost
    # nothing this period. As nodes they are half the picture carrying none of
    # the information, and a map you have to visually filter is a map that is
    # costing you something.
    #
    # They are COUNTED AND STATED rather than silently dropped: `meta.silent`
    # carries the number and the names, so "nothing is hidden" stays true
    # without spending a node on each. The moment one of them starts billing it
    # crosses the threshold and appears, at its real size, in rank order — which
    # is exactly when it is worth looking at.
    silent_services = [
        name for name, s in by_service.items() if abs(s["usd"]) < Decimal("0.005")
    ]
    for name, s in sorted(by_service.items(), key=lambda kv: -kv[1]["usd"]):
        if abs(s["usd"]) < Decimal("0.005"):
            continue
        pool = SHARED if SHARED in s["pools"] else (
            PLATFORM if PLATFORM in s["pools"] else sorted(s["pools"])[0]
        )
        nodes.append({
            "id": f"svc:{name}",
            "kind": SERVICE,
            "label": name.replace("Amazon ", "").replace("AWS ", ""),
            "detail": {"aws_name": name, "pool": pool, "lines": s["lines"]},
            "metrics": {"usd": _f(s["usd"])},
            "channels": {"cost": {"measured": True, "fired": s["usd"] > 0}},
        })
        edges.append(_edge(
            "platform", f"svc:{name}", "cost", _f(s["usd"]),
            # THE BILL IS MEASURED. What is modelled is any per-restaurant SHARE
            # of it, which is why those edges route through the platform rather
            # than joining a restaurant straight to a service.
            measured=True,
            label=f"${_f(s['usd']):.2f}",
        ))

    # -- models, and the restaurants pointing at them --
    models: dict[str, dict] = {}
    for hid, model, calls, tokens, cost, latency in link_rows:
        m = models.setdefault(
            model, {"calls": 0, "tokens": 0, "usd": Decimal(0), "users": 0}
        )
        m["calls"] += int(calls or 0)
        m["tokens"] += int(tokens or 0)
        m["usd"] += Decimal(cost or 0)
        m["users"] += 1
        edges.append(_edge(
            str(hid), f"model:{model}", "ai", int(calls or 0),
            measured=True,
            label=f"{int(calls or 0):,} calls · {int(tokens or 0):,} tokens",
            # LATENCY DRIVES THE PULSE SPEED. A six-times-slower restaurant is
            # then visible without anyone clicking anything, and no other screen
            # in the product shows this at all.
            latency_ms=round(_f(latency)),
        ))

    for model, m in sorted(models.items(), key=lambda kv: -kv[1]["calls"]):
        nodes.append({
            "id": f"model:{model}",
            "kind": MODEL,
            "label": _pretty_model(model),
            "detail": {"model_id": model, "restaurants": m["users"]},
            "metrics": {
                "calls": m["calls"],
                "tokens": m["tokens"],
                "usd": _f(m["usd"]),
            },
            "channels": {"ai": {"measured": True, "fired": m["calls"] > 0}},
        })
        # Every model hangs off Bedrock, which is the thing AWS actually bills.
        if "Amazon Bedrock" in by_service:
            edges.append(_edge(f"model:{model}", "svc:Amazon Bedrock", "ai",
                               m["calls"], measured=True, label=None))

    if not include_silent:
        live = {e["source"] for e in edges} | {e["target"] for e in edges}
        nodes = [n for n in nodes if n["id"] in live or n["kind"] == PLATFORM_NODE]

    return {
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "nodes": nodes,
        "edges": edges,
        "meta": {
            # So the UI can say "counters started on X" instead of drawing a
            # zero for a period nobody was watching.
            "measured_from": (
                d.isoformat()
                if (d := (await db.execute(select(func.min(UsageDaily.day)))).scalar())
                else None
            ),
            #: Services on the account that billed NOTHING this period. Kept as a
            #: count and a list rather than as nodes — see the service loop.
            "silent": {"services": sorted(silent_services)},
            #: AI calls with no model string recorded. Real calls, real tokens,
            #: attached to no model node — so the model edges will not sum to
            #: the AI total and the page must say why rather than let somebody
            #: discover the gap by subtracting.
            "unattributed_ai_calls": max(
                0,
                sum(v["calls"] for v in ai.values())
                - sum(m["calls"] for m in models.values()),
            ),
            "totals": {
                "requests": total_requests,
                "aws_usd": _f(cost_total),
                "ai_calls": sum(v["calls"] for v in ai.values()),
                "ai_tokens": sum(v["tokens_in"] + v["tokens_out"] for v in ai.values()),
            },
            "basis_version": usage_mod.BASIS_VERSION,
            "generated_at": datetime.now(UTC).isoformat(),
        },
    }


def _dt(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time(), tzinfo=UTC)


def _channel(stats: dict | None, key: str) -> dict:
    """Has this channel ever fired, and do we actually know?

    `measured: False` is NOT `fired: False`. The first says we were not
    watching; the second says we were and nothing happened. Rendering them the
    same is how a page states as fact that a restaurant did nothing.
    """
    if stats is None:
        return {"measured": False, "fired": False, "value": None}
    return {"measured": True, "fired": bool(stats.get(key)), "value": stats.get(key)}


def _edge(
    source: str,
    target: str,
    kind: str,
    weight: float,
    *,
    measured: bool,
    label: str | None,
    latency_ms: int | None = None,
) -> dict:
    return {
        "id": f"{source}->{target}:{kind}",
        "source": source,
        "target": target,
        "kind": kind,
        "weight": weight,
        #: A pulse means "this happened". A drift means "this is apportioned".
        #: Nothing unmeasured may ever emit a discrete packet, so the UI keys
        #: its animation off this flag and not off the weight.
        "measured": measured,
        "label": label,
        "latency_ms": latency_ms,
    }


def _pretty_model(model: str) -> str:
    """`eu.anthropic.claude-sonnet-4-6-20260321-v1:0` is not a label.

    Trimmed for the picture only — the raw id stays in `detail.model_id`,
    because that is the string somebody needs when they go looking in AWS.
    """
    m = model.split(".")[-1]
    m = m.split(":")[0]
    parts = [p for p in m.split("-") if not p.isdigit() and len(p) < 12]
    out = " ".join(p.capitalize() for p in parts if p not in ("v1", "claude"))
    return f"Claude {out}".strip() if out else model
