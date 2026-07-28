"""Canonical registry of per-hotel FEATURES (entitlements) and the PLANS that sell them.

Two ideas live here and they are deliberately separate:

  * a **Feature** is one capability of the product, keyed by a short string. Each
    hotel carries a JSON map ``features`` of ``key -> bool``.
  * a **Plan** is what a customer buys. It names, for EVERY feature, whether that
    plan includes it — no shorthand, no "the rest default on". If a feature is
    missing from a plan's map, `plan_features` raises at import-time via the
    self-check at the bottom, because a silently-ungated feature is revenue lost
    and a silently-blocked one is a support ticket.

To add a feature: add a Feature here AND give every Plan an explicit verdict on it.
If it should be *enforced* (not just hidden in the nav), gate its router on
``require_feature`` too.
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
    core: bool = False  # True = in every plan; the product is pointless without it


# Order here is the order shown in the Control Room.
FEATURES: tuple[Feature, ...] = (
    # ── Core: the money spine. Every plan gets these or there is no product. ──
    Feature("dashboard", "Dashboard", "The daily money & stock overview.", core=True),
    Feature("inventory", "Inventory", "Stock levels, lots, valuation.", core=True),
    Feature("vendors", "Vendors", "Suppliers and their price lists.", core=True),
    Feature("purchasing", "Purchasing", "Indents, purchase orders, receiving.", core=True),
    Feature("recipes", "Recipes & costing", "Dish recipes and live plate cost.", core=True),
    Feature("sales", "Sales", "Takings by channel and day.", core=True),
    Feature("expenses", "Expenses", "Running-cost / overhead tracking.", core=True),
    Feature("reports", "Reports (P&L)", "Profit & loss reports and downloads.", core=True),
    Feature("settings", "Settings", "Hotel profile, branding, preferences.", core=True),
    # ── Operations ────────────────────────────────────────────────────────────
    Feature("waste", "Waste log", "Log wasted stock and its cost.", enforced=True),
    Feature("stock_take", "Stock-take", "Physical stock counts & variance.", enforced=True),
    Feature(
        "price_comparison", "Price Comparison",
        "Cheapest-supplier comparison across vendors.", enforced=True,
    ),
    Feature("party_orders", "Party Orders", "Large event/party order planning.", enforced=True),
    Feature(
        "money", "Money & petty cash",
        "Petty cash, payment methods, drill-down.", enforced=True,
    ),
    # ── Compliance ────────────────────────────────────────────────────────────
    Feature(
        "food_safety", "Food Safety logs",
        "Fridge/temperature & cleaning logs.", enforced=True,
    ),
    Feature(
        "allergens", "Allergens sheet",
        "Per-dish allergen matrix (Natasha's Law).", enforced=True,
    ),
    Feature("documents", "Documents", "Document storage, requests and onboarding.", enforced=True),
    Feature("audit", "Audit trail", "Who changed what, when.", enforced=True),
    # ── People ────────────────────────────────────────────────────────────────
    Feature("employees", "Employees", "Staff records, salaries, visas.", enforced=True),
    Feature("attendance", "Attendance", "Clock-in, days & hours worked.", enforced=True),
    Feature("rota", "Rota", "Shift scheduling + forecast labour cost.", enforced=True),
    Feature("payroll", "Payroll", "Run pay, advances and payslips.", enforced=True),
    Feature(
        "self_service", "Staff self-service",
        "Staff log in to see rota, payslips, docs.", enforced=True,
    ),
    Feature(
        "hiring", "Hiring & job portal",
        "Post jobs, receive and track applicants.", enforced=True,
    ),
    Feature(
        "talent", "Talent board & chat",
        "Staff lending posts + hotel-to-hotel chat.", enforced=True,
    ),
    # ── Guests / revenue ──────────────────────────────────────────────────────
    Feature("ordering", "Online Ordering", "Public menu + pickup orders.", enforced=True),
    Feature(
        "delivery", "Delivery & Live Tracking",
        "Riders, GPS tracking, delivery fees.", enforced=True,
    ),
    Feature(
        "branded_site", "Branded hotel site",
        "Your own <handle>.dineai.cloud page.", enforced=True,
    ),
    # ── AI — priced separately because it is the only variable-cost feature ───
    Feature("ai_copilot", "AI Copilot", "The in-app AI assistant.", enforced=True),
    Feature(
        "ai_scan", "AI bill & recipe scanning",
        "Photograph paperwork, AI reads it.", enforced=True,
    ),
    Feature(
        "ai_insights", "AI daily insights",
        "Proactive 'make today better' nudges.", enforced=True,
    ),
    # ── Group-level ───────────────────────────────────────────────────────────
    Feature(
        "multi_site", "Multi-site rollup",
        "Compare and consolidate several venues.", enforced=True,
    ),
    Feature("api_access", "API access", "Programmatic access for integrations.", enforced=True),
)

_BY_KEY = {f.key: f for f in FEATURES}
ALL_KEYS: tuple[str, ...] = tuple(f.key for f in FEATURES)
CORE_KEYS: tuple[str, ...] = tuple(f.key for f in FEATURES if f.core)
AI_KEYS: tuple[str, ...] = ("ai_copilot", "ai_scan", "ai_insights")


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
            "default": f.default, "enforced": f.enforced, "core": f.core,
            "is_ai": f.key in AI_KEYS,
        }
        for f in FEATURES
    ]


# ── Subscription PLANS ───────────────────────────────────────────────────────
@dataclass(frozen=True)
class Plan:
    key: str
    label: str
    price_hint: str                 # marketing string, e.g. "£39/mo"
    price_annual_hint: str          # annual equivalent (pay 10, get 12)
    max_users: int                  # user cap (grandfathers hotels already over it)
    includes: dict[str, bool]       # EVERY feature key -> in this plan or not
    # AI is metered, not just on/off. 0 = no AI on this plan.
    ai_daily_requests: int
    ai_monthly_tokens: int
    trial_days: int
    blurb: str
    highlights: tuple[str, ...]


def _plan_map(on: tuple[str, ...]) -> dict[str, bool]:
    """Build the explicit verdict for every feature: core + `on` are included."""
    included = set(CORE_KEYS) | set(on)
    return {k: (k in included) for k in ALL_KEYS}


# Kitchen — the money spine only. Deliberately NO AI: it is the one feature with a
# variable per-use cost, so the cheapest tier must never be able to generate the
# biggest bill.
_KITCHEN_ON: tuple[str, ...] = (
    "waste", "stock_take", "ordering", "branded_site",
)

# Service — the full operating system for a single venue.
_SERVICE_ON: tuple[str, ...] = _KITCHEN_ON + (
    "price_comparison", "party_orders", "money",
    "food_safety", "allergens", "documents", "audit",
    "employees", "attendance", "rota", "payroll", "self_service", "hiring", "talent",
    "delivery",
    "ai_copilot", "ai_scan", "ai_insights",
)

# Group — everything, several venues.
_GROUP_ON: tuple[str, ...] = _SERVICE_ON + ("multi_site", "api_access")


PLANS: tuple[Plan, ...] = (
    Plan(
        "kitchen", "Kitchen", "£39/mo", "£390/yr", 3,
        _plan_map(_KITCHEN_ON),
        ai_daily_requests=0, ai_monthly_tokens=0, trial_days=0,
        blurb="Know what everything costs and what you actually made.",
        highlights=(
            "Inventory, recipes & live plate costing",
            "Vendors, purchasing & consolidated POs",
            "Sales, expenses & a real-time P&L",
            "Waste log and stock-take",
            "Your own branded site with pickup ordering",
            "Up to 3 users",
        ),
    ),
    Plan(
        "service", "Service", "£99/mo", "£990/yr", 15,
        _plan_map(_SERVICE_ON),
        ai_daily_requests=300, ai_monthly_tokens=8_000_000, trial_days=14,
        blurb="The whole operation — people, compliance, delivery and AI.",
        highlights=(
            "Everything in Kitchen",
            "AI Copilot + photograph a bill or handwritten recipe",
            "Payroll, rota, attendance & staff self-service",
            "Food safety, allergens, documents & audit trail",
            "Price comparison and party orders",
            "Delivery with live rider tracking",
            "Hiring portal and the talent board",
            "Up to 15 users · 14-day free trial",
        ),
    ),
    Plan(
        "group", "Group", "£249/mo", "£2,490/yr", 100000,
        _plan_map(_GROUP_ON),
        ai_daily_requests=1000, ai_monthly_tokens=30_000_000, trial_days=14,
        blurb="Several venues, one set of numbers.",
        highlights=(
            "Everything in Service",
            "Multi-site rollup across every venue",
            "Unlimited users",
            "API access for your own integrations",
            "3× the AI allowance",
            "Priority support and onboarding",
        ),
    ),
)

_PLAN_BY_KEY = {p.key: p for p in PLANS}
DEFAULT_PLAN = "service"

# Old plan keys kept working so existing hotels and links don't break.
_LEGACY_PLANS = {"starter": "kitchen", "pro": "service", "enterprise": "group"}


def canonical_plan(key: str) -> str:
    return _LEGACY_PLANS.get(key, key)


def is_valid_plan(key: str) -> bool:
    return canonical_plan(key) in _PLAN_BY_KEY


def get_plan(key: str) -> Plan | None:
    return _PLAN_BY_KEY.get(canonical_plan(key))


def plan_features(plan_key: str) -> dict:
    """The full feature map a plan applies — every key, explicitly on or off."""
    p = get_plan(plan_key)
    return dict(p.includes) if p else {}


def plan_max_users(plan_key: str) -> int:
    p = get_plan(plan_key)
    return p.max_users if p else 100000


def plan_ai_limits(plan_key: str) -> tuple[int, int]:
    """(daily requests, monthly tokens) for this plan. (0, 0) = no AI."""
    p = get_plan(plan_key)
    return (p.ai_daily_requests, p.ai_monthly_tokens) if p else (0, 0)


def plans_public(price_overrides: dict | None = None) -> list[dict]:
    """Serialisable plans for the Control Room, the pricing page and the landing page.
    The operator can override each plan's display price (plan_key -> string)."""
    ov = price_overrides or {}
    return [
        {
            "key": p.key, "label": p.label,
            "price_hint": ov.get(p.key) or p.price_hint,
            "price_annual_hint": p.price_annual_hint,
            "max_users": p.max_users, "blurb": p.blurb,
            "highlights": list(p.highlights),
            "includes": dict(p.includes),
            "ai_daily_requests": p.ai_daily_requests,
            "ai_monthly_tokens": p.ai_monthly_tokens,
            "trial_days": p.trial_days,
            # kept for older callers that read the OFF list
            "off_features": [k for k, on in p.includes.items() if not on],
        }
        for p in PLANS
    ]


def plan_matrix() -> list[dict]:
    """Feature-by-plan grid for the pricing page: one row per feature."""
    return [
        {
            "key": f.key, "label": f.label, "description": f.description,
            "is_ai": f.key in AI_KEYS, "core": f.core,
            "plans": {p.key: p.includes[f.key] for p in PLANS},
        }
        for f in FEATURES
    ]


# Self-check: every plan must have a verdict on every feature. A feature added
# without being priced is revenue quietly lost, so fail loudly at import.
for _p in PLANS:
    _missing = set(ALL_KEYS) - set(_p.includes)
    if _missing:  # pragma: no cover - guards a developer mistake
        raise RuntimeError(f"plan {_p.key!r} does not price: {sorted(_missing)}")
