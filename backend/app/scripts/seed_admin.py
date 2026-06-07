"""Bootstrap the first Super Admin so the system can be logged into.

Usage (inside the backend container):
    ADMIN_EMAIL=owner@nirai.com ADMIN_PASSWORD='StrongPass123!' \
        python -m app.scripts.seed_admin
"""
import asyncio
import os

from app.auth.models import Role
from app.auth.service import create_user, get_user_by_email
from app.core.database import AsyncSessionLocal
from app.scripts.seed_demo import NIRAI_ID, get_or_create_hotel


async def main() -> None:
    email = os.getenv("ADMIN_EMAIL", "owner@nirai.com")
    password = os.getenv("ADMIN_PASSWORD", "ChangeMe123!")

    async with AsyncSessionLocal() as db:
        hotel = await get_or_create_hotel(
            db, hotel_id=NIRAI_ID, name="NIRAI", country="GB", currency="GBP", city="London"
        )
        if await get_user_by_email(db, email):
            print(f"Super Admin '{email}' already exists — nothing to do.")
            return
        user = await create_user(db, email, password, Role.SUPER_ADMIN.value, hotel.id)
        print(f"Created Super Admin: {user.email} (id={user.id}) in hotel {hotel.name}")


if __name__ == "__main__":
    asyncio.run(main())
