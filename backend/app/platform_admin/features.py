"""Canonical registry of per-hotel FEATURES (entitlements).

Each hotel carries a JSON map ``features`` of ``key -> bool``. A missing key means
"use the default" (almost always enabled), so existing hotels keep everything until
the operator turns something off from the Control Room.

To add a new toggle: add a Feature here. If it should be *enforced* (not just hidden
in the UI), also gate the relevant router/component on ``hotel_feature_enabled``.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Feature:
    key: str
    label: str
    description: str
    default: bool = True
    enforced: bool = False  # True = also blocked server-side, not just hidden


# Order here is the order shown in the Control Room. `enforced=True` = also blocked
# server-side (its API 403s); the rest are hidden from that hotel's UI (nav).
FEATURES: tuple[Feature, ...] = (
    Feature(
        "ai_copilot", "AI Copilot (Ask Mise)",
        "The in-app AI assistant + document onboarding.", enforced=True,
    ),
    Feature(
        "party_orders", "Party Orders",
        "Large event/party order planning.", enforced=True,
    ),
    Feature(
        "food_safety", "Food Safety logs",
        "Fridge/temperature & cleaning safety logs.", enforced=True,
    ),
    Feature(
        "documents", "Documents",
        "Document storage, requests and onboarding.", enforced=True,
    ),
    Feature(
        "price_comparison", "Price Comparison",
        "Cheapest-supplier comparison across vendors.", enforced=True,
    ),
    Feature("reports", "Reports (P&L)", "Profit & loss reports and downloads."),
    Feature("expenses", "Expenses", "Running-cost / overhead tracking."),
    Feature("waste", "Waste log", "Log wasted stock and its cost."),
    Feature("stock_take", "Stock-take", "Physical stock counts & variance."),
    Feature("allergens", "Allergens sheet", "Per-dish allergen matrix (Natasha's Law)."),
    Feature("rota", "Rota", "Shift scheduling + forecast labour cost."),
    Feature("attendance", "Attendance", "Clock-in, days & hours worked."),
    Feature("employees", "Employees", "Staff records, salaries, visas."),
    Feature("payroll", "Payroll", "Run pay, advances and payslips."),
    Feature("ordering", "Online Ordering", "Public menu + pickup/delivery orders."),
    # The Pro upsell: rider door, live GPS tracking, delivery fees. Pickup
    # ordering stays in every plan; this flag sells the full delivery stack.
    Feature("delivery", "Delivery & Live Tracking", "Riders, GPS tracking, delivery fees."),
)

_BY_KEY = {f.key: f for f in FEATURES}


def is_valid_feature(key: str) -> bool:
    return key in _BY_KEY


def default_for(key: str) -> bool:
    f = _BY_KEY.get(key)
    return f.default if f else True


def feature_enabled(features: dict | None, key: str) -> bool:
    """Whether ``key`` is on for a hotel given its stored ``features`` map."""
    if not features or key not in features:
        return default_for(key)
    return bool(features[key])


def registry_public() -> list[dict]:
    """Serialisable registry for the Control Room UI."""
    return [
        {
            "key": f.key, "label": f.label, "description": f.description,
            "default": f.default, "enforced": f.enforced,
        }
        for f in FEATURES
    ]


# ── Subscription PLANS (a named bundle of features + limits) ─────────────────
@dataclass(frozen=True)
class Plan:
    key: str
    label: str
    price_hint: str          # marketing string, e.g. "£29/mo"
    max_users: int           # user cap (grandfathers hotels already over it)
    off_features: tuple[str, ...]  # features OFF on this plan (the rest default on)
    blurb: str
    highlights: tuple[str, ...]


# Starter turns off the AI + HR + premium modules; Pro/Enterprise get everything.
_STARTER_OFF: tuple[str, ...] = (
    "ai_copilot", "party_orders", "food_safety", "documents", "price_comparison",
    "rota", "attendance", "employees", "payroll",
)

PLANS: tuple[Plan, ...] = (
    Plan(
        "starter", "Starter", "£29/mo", 3, _STARTER_OFF,
        "Money + stock basics for a small kitchen.",
        (
            "Inventory, recipes & live costing",
            "Vendors & purchasing (with consolidated POs)",
            "Sales, expenses & a real-time P&L",
            "Up to 3 users",
        ),
    ),
    Plan(
        "pro", "Pro", "£79/mo", 15, (),
        "The full operating system — AI, people, purchasing & scanning.",
        (
            "Everything in Starter",
            "AI Copilot + bill & handwritten-recipe scanning",
            "Payroll, rota & attendance",
            "Documents, food safety & price comparison",
            "Up to 15 users",
        ),
    ),
    Plan(
        "enterprise", "Enterprise", "Let's talk", 100000, (),
        "Everything, unlimited users, priority support.",
        (
            "Everything in Pro",
            "Unlimited users",
            "Priority support + onboarding help",
            "Early access to new modules",
        ),
    ),
)

_PLAN_BY_KEY = {p.key: p for p in PLANS}
DEFAULT_PLAN = "pro"


def is_valid_plan(key: str) -> bool:
    return key in _PLAN_BY_KEY


def plan_features(plan_key: str) -> dict:
    """The feature map a plan applies (only the OFF ones; the rest default on)."""
    p = _PLAN_BY_KEY.get(plan_key)
    return {k: False for k in p.off_features} if p else {}


def plan_max_users(plan_key: str) -> int:
    p = _PLAN_BY_KEY.get(plan_key)
    return p.max_users if p else 100000


def plans_public(price_overrides: dict | None = None) -> list[dict]:
    """Serialisable plans for the Control Room + the public landing page. The operator
    can override each plan's display price (price_overrides: plan_key -> string)."""
    ov = price_overrides or {}
    return [
        {
            "key": p.key, "label": p.label,
            "price_hint": ov.get(p.key) or p.price_hint,
            "max_users": p.max_users, "blurb": p.blurb,
            "highlights": list(p.highlights), "off_features": list(p.off_features),
        }
        for p in PLANS
    ]
