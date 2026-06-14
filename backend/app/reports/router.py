"""Reporting endpoints: P&L, dashboard KPIs, and CSV/Excel export. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.reports import budget, export, insights, service
from app.reports.schemas import (
    BudgetTargets,
    BudgetVsActual,
    Dashboard,
    MenuEngineering,
    MoneyCentre,
    PnL,
    PricePoint,
)

router = APIRouter(prefix="/reports", tags=["reports"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/pnl", response_model=PnL)
async def profit_and_loss(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> PnL:
    return PnL.model_validate(await service.pnl(db, user.hotel_id, date_from, date_to))


@router.get("/dashboard", response_model=Dashboard)
async def dashboard(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> Dashboard:
    return Dashboard.model_validate(await service.dashboard(db, user.hotel_id))


@router.get("/money", response_model=MoneyCentre)
async def money_centre(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> MoneyCentre:
    """Money Intelligence: stock value, break-even, food-cost %, dish-margin
    leaders/laggards and vendor price-rise alerts. Defaults to month-to-date."""
    data = await insights.money_centre(db, user.hotel_id, date_from, date_to)
    return MoneyCentre.model_validate(data)


@router.get("/price-history/{item_id}", response_model=list[PricePoint])
async def price_history(
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("vendors:read")),
) -> list[PricePoint]:
    """What was actually paid for an item over time (PO receipts), oldest first."""
    rows = await insights.price_history(db, user.hotel_id, item_id)
    return [PricePoint.model_validate(r) for r in rows]


@router.get("/budget", response_model=BudgetVsActual)
async def get_budget(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> BudgetVsActual:
    return BudgetVsActual.model_validate(await budget.budget_vs_actual(db, user.hotel_id))


@router.put("/budget", response_model=BudgetVsActual)
async def put_budget(
    payload: BudgetTargets,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:write")),
) -> BudgetVsActual:
    await budget.set_targets(db, user.hotel_id, **payload.model_dump(exclude_unset=True))
    return BudgetVsActual.model_validate(await budget.budget_vs_actual(db, user.hotel_id))


@router.get("/menu-engineering", response_model=MenuEngineering)
async def menu_engineering(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> MenuEngineering:
    """Menu-engineering matrix (popularity × margin) + theoretical food cost.
    Defaults to month-to-date. Needs dish-sales counts entered on Sales."""
    today = date_to or date_type.today()
    start = date_from or today.replace(day=1)
    return MenuEngineering.model_validate(
        await insights.menu_engineering(db, user.hotel_id, start, today)
    )


@router.get("/pnl.csv")
async def pnl_csv(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> Response:
    data = await service.pnl(db, user.hotel_id, date_from, date_to)
    fname = f"mise-pnl-{date_from}-to-{date_to}.csv"
    return Response(
        content=export.to_csv(data),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@router.get("/pnl.xlsx")
async def pnl_xlsx(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> Response:
    data = await service.pnl(db, user.hotel_id, date_from, date_to)
    fname = f"mise-pnl-{date_from}-to-{date_to}.xlsx"
    return Response(
        content=export.to_xlsx(data),
        media_type=XLSX_MIME,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
