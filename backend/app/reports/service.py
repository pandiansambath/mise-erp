"""Reporting: profit & loss and dashboard KPIs — composes sales + expenses + inventory.

P&L model (simple, restaurant-standard):
    Net sales (after delivery commission)
  − Cost of sales (VARIABLE expenses: food, packaging…)
  = Gross profit
  − Operating expenses (FIXED: rent, utilities, salaries…)
  = Net profit
"""
import uuid
from datetime import date as date_type
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.expenses import service as expense_service
from app.inventory import service as inventory_service
from app.recipes import service as recipe_service
from app.sales import service as sales_service

_Q2 = Decimal("0.01")


def _pct(part: Decimal, whole: Decimal) -> Decimal:
    if whole == 0:
        return Decimal("0.00")
    return (part / whole * 100).quantize(_Q2, ROUND_HALF_UP)


async def pnl(
    db: AsyncSession, hotel_id: uuid.UUID, date_from: date_type, date_to: date_type
) -> dict:
    sales = await sales_service.range_summary(db, hotel_id, date_from, date_to)
    exp = await expense_service.summary(db, hotel_id, date_from, date_to)

    gross_sales = sales["gross"]
    commission = sales["commission"]
    net_sales = sales["net"]
    cost_of_sales = exp["variable_total"]
    operating = exp["fixed_total"]
    gross_profit = (net_sales - cost_of_sales).quantize(_Q2)
    net_profit = (gross_profit - operating).quantize(_Q2)
    # Insight only — NOT subtracted from profit (the cost already hit when bought).
    waste = await inventory_service.waste_total(db, hotel_id, date_from, date_to)

    return {
        "date_from": date_from,
        "date_to": date_to,
        "gross_sales": gross_sales,
        "commission": commission,
        "net_sales": net_sales,
        "cost_of_sales": cost_of_sales,
        "gross_profit": gross_profit,
        "operating_expenses": operating,
        "net_profit": net_profit,
        "food_cost_pct": _pct(cost_of_sales, net_sales),
        "gross_margin_pct": _pct(gross_profit, net_sales),
        "net_margin_pct": _pct(net_profit, net_sales),
        "waste_total": waste,
        "expense_breakdown": exp["by_category"],
    }


async def dashboard(db: AsyncSession, hotel_id: uuid.UUID, on: date_type | None = None) -> dict:
    today = on or date_type.today()
    month_start = today.replace(day=1)

    month = await pnl(db, hotel_id, month_start, today)
    today_sales = await sales_service.range_summary(db, hotel_id, today, today)
    low = await inventory_service.low_stock_items(db, hotel_id)
    recipes = await recipe_service.list_recipes(db, hotel_id)

    margins = [parse_pct(r.profit_margin) for r in recipes if r.profit_margin is not None]
    avg_margin = (
        (sum(margins) / len(margins)).quantize(_Q2) if margins else Decimal("0.00")
    )

    return {
        "month_start": month_start,
        "today": today,
        "today_net_sales": today_sales["net"],
        "month_net_sales": month["net_sales"],
        "month_expenses": (month["cost_of_sales"] + month["operating_expenses"]).quantize(_Q2),
        "month_net_profit": month["net_profit"],
        "month_net_margin_pct": month["net_margin_pct"],
        "low_stock_count": len(low),
        "recipe_count": len(recipes),
        "avg_recipe_margin_pct": avg_margin,
    }


def parse_pct(value) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))
