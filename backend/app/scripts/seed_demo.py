"""Seed realistic demo data for NIRAI so the UI is alive to click through.

Idempotent: safe to run repeatedly (get-or-create; stock only set when empty).

    python -m app.scripts.seed_demo
"""
import asyncio
from decimal import Decimal

from sqlalchemy import select

import app.auth.models  # noqa: F401  (register users table for FK resolution)
from app.inventory import service as inv
from app.inventory.models import Item
from app.recipes import service as rec
from app.recipes.models import Recipe
from app.vendors import service as ven
from app.vendors.models import Vendor

# item name -> (unit, category, min_stock, opening_stock, opening_cost)
ITEMS = {
    "Dawat Basmati": ("kg", "Rice", "20", "60", "5.20"),
    "Idly Rice": ("kg", "Rice", "10", "25", "1.00"),
    "Chicken (biryani cut)": ("kg", "Meat & Poultry", "10", "18", "8.00"),
    "Chicken Breast B/L": ("kg", "Meat & Poultry", "10", "6", "9.20"),  # low stock
    "White Onion": ("kg", "Vegetables", "15", "8", "0.55"),  # low stock
    "Tomato": ("kg", "Vegetables", "10", "20", "1.10"),
    "Paneer": ("kg", "Dairy", "5", "12", "6.99"),
    "Sunflower Oil": ("litre", "Oils", "10", "30", "1.72"),
    "Ginger": ("kg", "Vegetables", "3", "5", "2.40"),
    "Garlic (peeled)": ("kg", "Vegetables", "3", "4", "5.40"),
    "Green Chilli": ("kg", "Vegetables", "2", "3", "3.10"),
    "Urad Dal": ("kg", "Pulses", "5", "10", "2.20"),
}

VENDORS = ["Farm2Land", "Rudra", "SK", "Exotic"]

# item -> {vendor: price}
PRICES = {
    "Dawat Basmati": {"Farm2Land": "5.50", "Rudra": "5.20", "SK": "5.35"},
    "Idly Rice": {"Rudra": "1.00", "SK": "1.15"},
    "Chicken (biryani cut)": {"Farm2Land": "8.50", "SK": "8.00", "Exotic": "8.90"},
    "Chicken Breast B/L": {"Farm2Land": "9.20", "SK": "8.75"},
    "White Onion": {"Farm2Land": "0.55", "Rudra": "0.62", "SK": "0.58"},
    "Tomato": {"Farm2Land": "1.25", "SK": "1.10", "Exotic": "1.35"},
    "Paneer": {"Farm2Land": "6.99", "Exotic": "7.99"},
    "Sunflower Oil": {"Rudra": "1.72", "SK": "1.85"},
    "Ginger": {"Farm2Land": "2.40", "SK": "2.65"},
    "Garlic (peeled)": {"Farm2Land": "5.40", "Exotic": "5.95"},
    "Green Chilli": {"Farm2Land": "3.10", "SK": "3.40"},
    "Urad Dal": {"Rudra": "2.20", "SK": "2.35"},
}

# recipe -> (servings, selling_price, [(item, qty, unit)])
RECIPES = {
    "Chicken Biryani": (
        50,
        "12.95",
        [
            ("Dawat Basmati", "5", "kg"),
            ("Chicken (biryani cut)", "4", "kg"),
            ("White Onion", "2", "kg"),
            ("Sunflower Oil", "1", "litre"),
            ("Ginger", "0.3", "kg"),
            ("Garlic (peeled)", "0.3", "kg"),
            ("Green Chilli", "0.2", "kg"),
        ],
    ),
    "Masala Dosa": (
        30,
        "7.50",
        [
            ("Idly Rice", "3", "kg"),
            ("Urad Dal", "1", "kg"),
            ("White Onion", "1", "kg"),
            ("Sunflower Oil", "0.5", "litre"),
        ],
    ),
    "Paneer Butter Masala": (
        20,
        "9.95",
        [
            ("Paneer", "2", "kg"),
            ("Tomato", "2", "kg"),
            ("White Onion", "1", "kg"),
            ("Sunflower Oil", "0.5", "litre"),
        ],
    ),
}


async def get_or_create_item(db, name, unit, category, min_stock):
    res = await db.execute(select(Item).where(Item.name == name))
    item = res.scalar_one_or_none()
    if item:
        return item
    return await inv.create_item(
        db, name=name, unit=unit, category=category, min_stock_level=Decimal(min_stock)
    )


async def get_or_create_vendor(db, name):
    res = await db.execute(select(Vendor).where(Vendor.name == name))
    v = res.scalar_one_or_none()
    if v:
        return v
    return await ven.create_vendor(db, name=name, category="FOOD")


async def get_or_create_recipe(db, name, servings, price):
    res = await db.execute(select(Recipe).where(Recipe.name == name))
    r = res.scalar_one_or_none()
    if r:
        return r
    return await rec.create_recipe(
        db, name=name, servings_default=servings, selling_price=Decimal(price), category="Main"
    )


async def main() -> None:
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        items: dict[str, Item] = {}
        for name, (unit, cat, mn, opening, cost) in ITEMS.items():
            item = await get_or_create_item(db, name, unit, cat, mn)
            items[name] = item
            # Opening stock only if empty (keeps re-runs idempotent).
            if item.current_stock == 0 and Decimal(opening) > 0:
                await inv.record_movement(
                    db, item, "PURCHASE_IN", Decimal(opening), unit_cost=Decimal(cost)
                )

        vendors: dict[str, Vendor] = {}
        for vname in VENDORS:
            vendors[vname] = await get_or_create_vendor(db, vname)

        for item_name, vendor_prices in PRICES.items():
            for vname, price in vendor_prices.items():
                await ven.upsert_vendor_item(
                    db, vendors[vname].id, items[item_name].id, Decimal(price)
                )

        for rname, (servings, price, ingredients) in RECIPES.items():
            recipe = await get_or_create_recipe(db, rname, servings, price)
            for item_name, qty, unit in ingredients:
                await rec.upsert_ingredient(
                    db, recipe.id, items[item_name].id, Decimal(qty), unit
                )
            await rec.calculate_recipe_cost(db, recipe.id)

        print(
            f"Seeded {len(ITEMS)} items, {len(VENDORS)} vendors, {len(RECIPES)} recipes "
            "with prices, stock, and computed margins."
        )


if __name__ == "__main__":
    asyncio.run(main())
