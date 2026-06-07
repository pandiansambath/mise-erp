"""Seed 5 demo hotels (3 UK, 2 India), each its own isolated tenant with an
owner login + full catalog. Idempotent.

    python -m app.scripts.seed_hotels
"""
import asyncio

from app.scripts.seed_demo import get_or_create_hotel, get_or_create_owner, seed_hotel

# (hotel_id, name, country, currency, city, owner_email)
HOTELS = [
    ("d0000000-0000-0000-0000-000000000001", "NIRAI", "GB", "GBP", "London", "owner@nirai.com"),
    ("d0000000-0000-0000-0000-000000000002", "Spice Route", "GB", "GBP", "London", "owner@spiceroute.com"),
    ("d0000000-0000-0000-0000-000000000003", "Curry House", "GB", "GBP", "Manchester", "owner@curryhouse.com"),
    ("d0000000-0000-0000-0000-000000000004", "Anand Bhavan", "IN", "INR", "Chennai", "owner@anandbhavan.com"),
    ("d0000000-0000-0000-0000-000000000005", "Madras Cafe", "IN", "INR", "Bangalore", "owner@madrascafe.com"),
]


async def main() -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        for hid, name, country, currency, city, email in HOTELS:
            hotel = await get_or_create_hotel(
                db, hotel_id=hid, name=name, country=country, currency=currency, city=city
            )
            await get_or_create_owner(db, email=email, hotel_id=hotel.id)
            await seed_hotel(db, hotel)
            print(f"  ✓ {name} ({country}, {currency}) — login {email} / Passw0rd!")

    print("\nSeeded 5 hotels. Each owner sees ONLY their own restaurant's data.")


if __name__ == "__main__":
    asyncio.run(main())
