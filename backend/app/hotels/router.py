"""Hotel (tenant) settings — Super Admin configures the attendance break policy."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.auth.schemas import HotelOut, HotelUpdate
from app.core.database import get_db
from app.hotels.models import Hotel

router = APIRouter(prefix="/hotels", tags=["hotels"])


@router.get("/me", response_model=HotelOut)
async def my_hotel(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> HotelOut:
    hotel = await db.get(Hotel, user.hotel_id)
    return HotelOut.model_validate(hotel)


@router.patch("/me", response_model=HotelOut)
async def update_my_hotel(
    payload: HotelUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> HotelOut:
    hotel = await db.get(Hotel, user.hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(hotel, key, value)
    await db.commit()
    await db.refresh(hotel)
    return HotelOut.model_validate(hotel)
