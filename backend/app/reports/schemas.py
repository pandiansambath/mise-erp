"""Schemas for reports."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from pydantic import BaseModel


class CategoryTotal(BaseModel):
    category_id: uuid.UUID
    category_name: str
    kind: str
    total: Decimal


class PnL(BaseModel):
    date_from: date_type
    date_to: date_type
    gross_sales: Decimal
    commission: Decimal
    net_sales: Decimal
    cost_of_sales: Decimal
    gross_profit: Decimal
    operating_expenses: Decimal
    net_profit: Decimal
    food_cost_pct: Decimal
    gross_margin_pct: Decimal
    net_margin_pct: Decimal
    expense_breakdown: list[CategoryTotal]


class Dashboard(BaseModel):
    month_start: date_type
    today: date_type
    today_net_sales: Decimal
    month_net_sales: Decimal
    month_expenses: Decimal
    month_net_profit: Decimal
    month_net_margin_pct: Decimal
    low_stock_count: int
    recipe_count: int
    avg_recipe_margin_pct: Decimal
