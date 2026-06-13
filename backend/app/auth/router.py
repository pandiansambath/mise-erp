"""Auth & user-management endpoints. User management is hotel-scoped."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.deps import get_current_user, require
from app.auth.models import Role, User
from app.auth.schemas import (
    ChangePassword,
    HotelOut,
    LoginRequest,
    MeResponse,
    RegisterHotel,
    TokenResponse,
    UserCreate,
    UserOut,
    UserUpdate,
)
from app.core.database import get_db
from app.core.security import create_access_token
from app.hotels.models import Hotel

router = APIRouter(prefix="/auth", tags=["auth"])

# Sensible default currency per country for self-signup.
_CURRENCY_BY_COUNTRY = {"GB": "GBP", "IN": "INR", "US": "USD", "AE": "AED", "EU": "EUR"}


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


@router.post("/register-hotel", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register_hotel(
    payload: RegisterHotel, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    """Public self-signup: create a hotel + its first Super Admin, then log them in."""
    if await service.get_user_by_email(db, payload.email):
        raise HTTPException(status.HTTP_409_CONFLICT, "That email already has an account")
    country = payload.country.upper()
    hotel = Hotel(
        name=payload.hotel_name.strip(),
        country=country,
        city=payload.city,
        base_currency=_CURRENCY_BY_COUNTRY.get(country, "GBP"),
    )
    db.add(hotel)
    await db.flush()
    user = await service.create_user(
        db, payload.email, payload.password, Role.SUPER_ADMIN.value, hotel.id
    )
    await db.refresh(hotel)  # create_user committed; reload before serialising
    token = create_access_token(subject=str(user.id), role=user.role)
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


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePassword,
    current: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Change your own password (requires the current one). No email/infra needed."""
    if payload.new_password == payload.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be different")
    ok = await service.change_password(db, current, payload.current_password, payload.new_password)
    if not ok:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")


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
