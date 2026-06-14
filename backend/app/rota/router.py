"""Rota endpoints: shifts + labour summary. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.rota import service
from app.rota.schemas import LabourSummary, ShiftCreate, ShiftOut

router = APIRouter(prefix="/rota", tags=["rota"])


@router.post("/shifts", response_model=ShiftOut, status_code=status.HTTP_201_CREATED)
async def create_shift(
    payload: ShiftCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> ShiftOut:
    await service.create_shift(db, user.hotel_id, **payload.model_dump())
    # re-read via list so the response carries employee_name + computed hours/cost
    rows = await service.list_shifts(db, user.hotel_id, payload.date, payload.date)
    return ShiftOut.model_validate(rows[-1])


@router.get("/shifts", response_model=list[ShiftOut])
async def list_shifts(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> list[ShiftOut]:
    rows = await service.list_shifts(db, user.hotel_id, date_from, date_to)
    return [ShiftOut.model_validate(r) for r in rows]


@router.delete("/shifts/{shift_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shift(
    shift_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:write")),
) -> None:
    sh = await service.get_shift(db, shift_id, user.hotel_id)
    if sh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shift not found")
    await service.delete_shift(db, sh)


@router.get("/labour", response_model=LabourSummary)
async def labour_summary(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("employees:read")),
) -> LabourSummary:
    return LabourSummary.model_validate(
        await service.labour_summary(db, user.hotel_id, date_from, date_to)
    )
