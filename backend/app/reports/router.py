"""Reporting endpoints: P&L, dashboard KPIs, and CSV/Excel export. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.hotels.models import Hotel
from app.reports import budget, export, insights, mbr, mbr_export, service
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


@router.get("/sales-trend")
async def sales_trend(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> dict:
    """Net sales per day in ONE query — feeds the dashboard trend and the
    calendar heatmaps (replaces N per-day P&L calls)."""
    return {"days": await service.sales_trend(db, user.hotel_id, date_from, date_to)}


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



# ── the Monthly Business Report ────────────────────────────────────────────
#
#     "i need one consolidated super spceial export feature in pnl area that
#      includes litrelly al thre details like expense , sales, money ectetc
#      (for particluar days or whatever we choose)"
#     "have in excel, csv, pdf, words in all fomr"
#     "ask user whther to iunclude tis calcuateion or not or leave empty to
#      keep default whihc give all the consoldiated things as our sampe report"
#
# Modelled on `docs/Nirai_August_2026_Updated_MBR_v2.pdf`, which he sent as the
# specification.

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

#: One writer per extension, so the four endpoints below are one endpoint.
_MBR_WRITERS = {
    "csv": (mbr_export.to_csv, "text/csv"),
    "xlsx": (mbr_export.to_xlsx, XLSX_MIME),
    "pdf": (mbr_export.to_pdf, "application/pdf"),
    "docx": (mbr_export.to_docx, DOCX_MIME),
}


@router.get("/mbr/sections")
async def mbr_sections(user: User = Depends(require("reports:read"))) -> dict:
    """What can be put in the report, for the picker.

    Served rather than hardcoded in the browser, so a section added to `mbr.py`
    appears in the chooser without a second edit — the shape of bug where a new
    feature exists and nothing offers it.
    """
    return {"sections": [{"key": k, "label": lab} for k, lab in mbr.CATALOGUE]}


async def _build_mbr(db, user, date_from, date_to, sections: str | None) -> dict:
    hotel = await db.get(Hotel, user.hotel_id)
    # EMPTY MEANS EVERYTHING — asking for nothing is how somebody says "the
    # usual", not how they ask for a blank document.
    want = [s for s in (sections or "").split(",") if s.strip()] or None
    return await mbr.build(
        db,
        user.hotel_id,
        date_from,
        date_to,
        want,
        hotel_name=(hotel.name if hotel else "") or "",
        # `base_currency`, NOT `currency`. A getattr for the wrong name falls
        # through to "GBP" without complaining, which is right for his
        # restaurant and silently wrong for every other one.
        currency=(hotel.base_currency if hotel else None) or "GBP",
    )


@router.get("/mbr")
async def mbr_preview(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    sections: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> dict:
    """The report as JSON, so it can be SEEN before it is downloaded.

    He has asked for a preview before a final action more than once, and a
    report is the easiest thing in the world to download, open, and discover is
    the wrong three weeks.
    """
    report = await _build_mbr(db, user, date_from, date_to, sections)
    return {
        "hotel_name": report["hotel_name"],
        "date_from": report["date_from"],
        "date_to": report["date_to"],
        "currency": report["currency"],
        "sections": [
            {
                "key": s.key,
                "title": s.title,
                "note": s.note,
                "columns": s.columns,
                "money_cols": s.money_cols,
                "rows": [
                    [mbr_export.fmt(v, money=i in s.money_cols, currency=report["currency"])
                     for i, v in enumerate(row)]
                    for row in s.rows
                ],
                "total": (
                    [mbr_export.fmt(v, money=i in s.money_cols, currency=report["currency"])
                     for i, v in enumerate(s.total)]
                    if s.total else None
                ),
            }
            for s in report["sections"]
        ],
    }


@router.get("/mbr.{fmt}")
async def mbr_download(
    fmt: str,
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    sections: str | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> Response:
    """The same report in whichever of the four formats was asked for."""
    writer = _MBR_WRITERS.get(fmt.lower())
    if writer is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "That format is not one we make. Choose csv, xlsx, pdf or docx.",
        )
    render, media = writer
    report = await _build_mbr(db, user, date_from, date_to, sections)
    stem = (report["hotel_name"] or "dineai").lower().replace(" ", "-")
    fname = f"{stem}-report-{date_from}-to-{date_to}.{fmt.lower()}"
    return Response(
        content=render(report),
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
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


@router.get("/pnl.pdf")
async def pnl_pdf(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("reports:read")),
) -> Response:
    """The period's P&L as a one-page branded PDF — the monthly snapshot archive."""
    data = await service.pnl(db, user.hotel_id, date_from, date_to)
    fname = f"mise-pnl-{date_from}-to-{date_to}.pdf"
    return Response(
        content=export.to_pdf(data),
        media_type="application/pdf",
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
