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


# ── Money Intelligence ───────────────────────────────────────────────────────
class StockByCategory(BaseModel):
    category: str
    value: Decimal


class StockValue(BaseModel):
    total: Decimal
    item_count: int
    by_category: list[StockByCategory]


class DishMarginRow(BaseModel):
    recipe_id: uuid.UUID
    name: str
    selling_price: Decimal | None
    cost_per_serving: Decimal | None
    margin_pct: Decimal | None


class DishMargins(BaseModel):
    avg_margin_pct: Decimal | None
    priced_count: int
    total_count: int
    ranked: list[DishMarginRow]  # every priced dish, best margin → thinnest
    no_price: list[DishMarginRow]


class PriceAlert(BaseModel):
    item_id: uuid.UUID
    item_name: str
    prev_price: Decimal
    latest_price: Decimal
    change_pct: Decimal
    vendor_name: str | None
    last_ordered: date_type


class WasteSummary(BaseModel):
    total: Decimal
    entry_count: int


class BreakEven(BaseModel):
    fixed_costs: Decimal
    contribution_margin_pct: Decimal
    break_even_sales: Decimal | None
    net_sales: Decimal
    gap: Decimal | None
    break_even_per_day: Decimal | None
    days_elapsed: int


class MenuDish(BaseModel):
    recipe_id: uuid.UUID
    name: str
    qty_sold: int
    margin_pct: Decimal | None
    selling_price: Decimal | None
    cost_per_serving: Decimal | None
    revenue: Decimal
    klass: str  # star | plowhorse | puzzle | dog | none


class MenuEngineering(BaseModel):
    date_from: date_type
    date_to: date_type
    has_data: bool
    total_units: int
    revenue: Decimal
    theoretical_food_cost: Decimal
    theoretical_food_cost_pct: Decimal
    dishes: list[MenuDish]


class MoneyCentre(BaseModel):
    date_from: date_type
    date_to: date_type
    net_sales: Decimal
    net_profit: Decimal
    food_cost_pct: Decimal
    gross_margin_pct: Decimal
    net_margin_pct: Decimal
    stock_value: StockValue
    waste: WasteSummary
    break_even: BreakEven
    dish_margins: DishMargins
    price_alerts: list[PriceAlert]
