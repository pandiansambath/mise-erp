"""Auth & user-management endpoints. User management is hotel-scoped."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.deps import get_current_user, require
from app.auth.models import User
from app.auth.schemas import (
    HotelOut,
    LoginRequest,
    MeResponse,
    TokenResponse,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.core.database import get_db
from app.core.security import create_access_token
from app.hotels.models import Hotel

router = APIRouter(prefix="/auth", tags=["auth"])


async def _hotel_or_404(db: AsyncSession, hotel_id: uuid.UUID) -> Hotel:
    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Hotel not found")
    return hotel


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = await service.authenticate(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect email or password"
        )
    token = create_access_token(subject=str(user.id), role=user.role)
    hotel = await _hotel_or_404(db, user.hotel_id)
    return TokenResponse(
        access_token=token,
        user=UserOut.model_validate(user),
        hotel=HotelOut.model_validate(hotel),
    )


@router.get("/me", response_model=MeResponse)
async def me(
    current: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> MeResponse:
    hotel = await _hotel_or_404(db, current.hotel_id)
    return MeResponse(user=UserOut.model_validate(current), hotel=HotelOut.model_validate(hotel))


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require("users:write")),
) -> UserOut:
    if await service.get_user_by_email(db, payload.email):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
    # New users join the admin's hotel.
    user = await service.create_user(
        db, payload.email, payload.password, payload.role, admin.hotel_id
    )
    return UserOut.model_validate(user)


@router.get("/users", response_model=list[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require("users:read")),
) -> list[UserOut]:
    users = await service.list_users(db, admin.hotel_id)
    return [UserOut.model_validate(u) for u in users]


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require("users:write")),
) -> UserOut:
    user = await service.get_user_by_id(db, user_id)
    if user is None or user.hotel_id != admin.hotel_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user = await service.update_user(db, user, role=payload.role, is_active=payload.is_active)
    return UserOut.model_validate(user)
