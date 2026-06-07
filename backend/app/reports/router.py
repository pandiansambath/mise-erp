"""Reporting endpoints: P&L, dashboard KPIs, and CSV/Excel export. Hotel-scoped."""
from datetime import date as date_type

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.reports import export, service
from app.reports.schemas import Dashboard, PnL

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
