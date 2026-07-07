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
