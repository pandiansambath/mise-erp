"""Let the assistant read the database — safely.

Hand-written tools can only answer questions somebody anticipated. That is why
the Copilot kept saying "open the X page": not a privacy rule, a gap. A master
assistant has to be able to LOOK, not only to call the twenty-nine things we
thought of.

So the model writes SQL. Everything here exists to make that safe rather than
clever, because text-to-SQL with a weak guard is a cross-tenant leak waiting for
the right question.

**The tenant boundary is not the model's job.** Queries run against `ai_*`
VIEWS, each of which filters on `current_setting('app.hotel_id')` in its own
definition (migration f65b872b1efa). The model never names a base table, so it
cannot forget the filter, cannot be prompted out of it, and cannot join sideways
into another hotel. An earlier draft of this module relied on a session variable
alone — with no row-level security on this database that filtered nothing, and
`SELECT * FROM items` would have returned every hotel's stock. Hence views.

On top of that: one plain SELECT, no comments, no second statement, a forced
LIMIT, a statement timeout, and a read-only transaction.
"""
from __future__ import annotations

import logging
import re

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User

log = logging.getLogger("mise.assistant.query")

MAX_ROWS = 200
STATEMENT_TIMEOUT_MS = 4000

# Only these. An allow-list, so a new table stays invisible until somebody
# decides it is safe — rather than being exposed the moment it is created.
READABLE = {
    "ai_items", "ai_vendors", "ai_vendor_items", "ai_recipes",
    "ai_recipe_ingredients", "ai_indents", "ai_indent_items",
    "ai_purchase_orders", "ai_po_items", "ai_price_history",
    "ai_expenses", "ai_expense_categories", "ai_daily_sales", "ai_dish_sales",
    "ai_sales_channels", "ai_menu_items", "ai_orders", "ai_order_items",
    "ai_employees", "ai_attendance", "ai_payroll", "ai_salary_advances",
    "ai_shifts", "ai_documents", "ai_safety_logs", "ai_party_quotes",
    "ai_party_quote_lines", "ai_budget_targets", "ai_job_postings",
    "ai_job_applications",
}

_SELECT_ONLY = re.compile(r"^\s*(select|with)\b", re.I)
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|"
    r"vacuum|call|do|merge|reset|listen|notify|pg_sleep|pg_read_file|"
    r"current_setting|set_config)\b",
    re.I,
)
_TABLES = re.compile(r"\b(?:from|join)\s+([a-zA-Z_][\w]*)", re.I)


class UnsafeQuery(ValueError):
    """Rejected before it reached the database."""


def validate(sql: str, allowed: set[str] | None = None) -> str:
    """Reject anything that is not a single plain read over allow-listed views."""
    q = (sql or "").strip().rstrip(";").strip()
    if not q:
        raise UnsafeQuery("Empty query")
    if not _SELECT_ONLY.match(q):
        raise UnsafeQuery("Only SELECT is allowed")
    # A second statement is the classic way past a naive prefix check.
    if ";" in q:
        raise UnsafeQuery("Only one statement is allowed")
    # Comments can hide one from a reviewer, and from this validator.
    if "--" in q or "/*" in q:
        raise UnsafeQuery("Comments are not allowed")
    # current_setting is blocked too: it is how a query would try to read or
    # spoof the scope the views depend on.
    if _FORBIDDEN.search(q):
        raise UnsafeQuery("Only plain read-only queries are allowed")

    allow = allowed if allowed is not None else READABLE
    referenced = {t.lower() for t in _TABLES.findall(q)}
    # `with x as (...) select ... from x` — CTE names are fine.
    ctes = {c.lower() for c in re.findall(r"\b(\w+)\s+as\s*\(", q, re.I)}
    unknown = referenced - allow - ctes
    if unknown:
        raise UnsafeQuery("Can only read: " + ", ".join(sorted(allow))[:400])
    if not (referenced & allow):
        raise UnsafeQuery("No readable view referenced")
    return q


async def run(db: AsyncSession, user: User, sql: str) -> dict:
    """Run a model-written SELECT. The views do the scoping; this does the rest."""
    try:
        q = validate(sql)
    except UnsafeQuery as exc:
        # Handed back to the MODEL, not the user — it can correct and retry.
        return {"error": str(exc)}

    if not re.search(r"\blimit\s+\d+", q, re.I):
        q = f"{q} LIMIT {MAX_ROWS}"

    try:
        await db.execute(text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"))
        await db.execute(text("SET LOCAL transaction_read_only = on"))
        # What every ai_* view filters on. Set server-side from the session's
        # authenticated user — never from anything the model produced.
        await db.execute(
            text("SELECT set_config('app.hotel_id', :hid, true)"),
            {"hid": str(user.hotel_id)},
        )
        rows = [dict(r._mapping) for r in (await db.execute(text(q))).fetchall()[:MAX_ROWS]]
    except Exception as exc:  # noqa: BLE001 — surfaced to the model to retry
        log.warning("assistant query failed: %s", str(exc)[:300], extra={"code": "DINE-A3005"})
        await db.rollback()
        return {"error": "That query didn't run — try asking a different way."}
    finally:
        # Never leave a read-only transaction open for the next caller.
        await db.rollback()

    return {"row_count": len(rows), "rows": rows, "truncated": len(rows) >= MAX_ROWS}


# ── Operator scope: the same machinery WITHOUT the hotel filter ─────────────
#
# The Control Room legitimately sees every hotel — that is its whole job. So it
# queries the base tables directly rather than the ai_* views.
#
# Two things are still excluded, and they are not negotiable:
#   users            — carries password_hash. Staff facts come from employees.
#   chats/chat_messages — hotel-to-hotel private messaging. The operator runs
#                         the platform; they are not a party to those.
OPERATOR_READABLE = {
    "hotels", "items", "vendors", "vendor_items", "recipes", "recipe_ingredients",
    "indents", "indent_items", "purchase_orders", "po_items", "price_history",
    "expenses", "expense_categories", "daily_sales", "dish_sales", "sales_channels",
    "menu_items", "orders", "order_items", "employees", "attendance", "payroll",
    "shifts", "documents", "safety_logs", "party_quotes", "budget_targets",
    "job_postings", "job_applications", "ai_usage", "audit_events",
    "assistant_threads", "custom_roles",
}


async def run_operator(db: AsyncSession, sql: str) -> dict:
    """Cross-hotel read for the Control Room. Caller MUST have checked the
    platform-owner flag — this function deliberately applies no tenant scope."""
    try:
        q = validate(sql, allowed=OPERATOR_READABLE)
    except UnsafeQuery as exc:
        return {"error": str(exc)}

    if not re.search(r"limit\s+\d+", q, re.I):
        q = f"{q} LIMIT {MAX_ROWS}"

    try:
        await db.execute(text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"))
        await db.execute(text("SET LOCAL transaction_read_only = on"))
        rows = [dict(r._mapping) for r in (await db.execute(text(q))).fetchall()[:MAX_ROWS]]
    except Exception as exc:  # noqa: BLE001
        log.warning("operator query failed: %s", str(exc)[:300], extra={"code": "DINE-A3005"})
        await db.rollback()
        return {"error": "That query didn't run — try asking a different way."}
    finally:
        await db.rollback()

    return {"row_count": len(rows), "rows": rows, "truncated": len(rows) >= MAX_ROWS}
