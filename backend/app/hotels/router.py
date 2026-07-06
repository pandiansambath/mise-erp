"""Hotel (tenant) settings — Super Admin configures the break policy + brand logo."""
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.auth.schemas import HotelOut, HotelUpdate
from app.core.database import get_db
from app.core.storage import get_storage
from app.hotels.models import Hotel

router = APIRouter(prefix="/hotels", tags=["hotels"])

_LOGO_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg"}


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


@router.post("/logo", response_model=HotelOut)
async def upload_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> HotelOut:
    """Upload the hotel's brand logo (PNG/JPG). Replaces the default Mise mark in the
    app UI and on PDFs. Stored in S3/local; served publicly from /hotels/{id}/logo."""
    ext = _LOGO_TYPES.get((file.content_type or "").lower())
    if ext is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be a PNG or JPG image")
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Logo too large (max 2 MB)")
    hotel = await db.get(Hotel, user.hotel_id)
    storage = get_storage()
    if hotel.logo_key:
        try:
            storage.delete(hotel.logo_key)
        except Exception:  # noqa: BLE001 — best-effort cleanup of the old file
            pass
    hotel.logo_key = storage.save(user.hotel_id, uuid.uuid4(), f"logo{ext}", data)
    await db.commit()
    await db.refresh(hotel)
    return HotelOut.model_validate(hotel)


@router.delete("/logo", response_model=HotelOut)
async def delete_logo(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("hotel:config")),
) -> HotelOut:
    """Remove the hotel logo — reverts to the default Mise mark everywhere."""
    hotel = await db.get(Hotel, user.hotel_id)
    if hotel.logo_key:
        try:
            get_storage().delete(hotel.logo_key)
        except Exception:  # noqa: BLE001
            pass
        hotel.logo_key = None
        await db.commit()
        await db.refresh(hotel)
    return HotelOut.model_validate(hotel)


@router.get("/{hotel_id}/logo")
async def get_logo(hotel_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """Serve a hotel's logo image. PUBLIC (no auth) so <img> tags + PDFs can load it —
    logos aren't sensitive. 404 when the hotel has no logo."""
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None or not hotel.logo_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No logo")
    try:
        data = get_storage().read(hotel.logo_key)
    except FileNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No logo") from exc
    media = "image/png" if hotel.logo_key.endswith(".png") else "image/jpeg"
    return Response(
        content=data, media_type=media, headers={"Cache-Control": "public, max-age=300"}
    )
