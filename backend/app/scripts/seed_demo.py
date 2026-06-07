"""Seed realistic demo data for NIRAI so the UI is alive to click through.

Idempotent: safe to re-run (get-or-create; stock/movements only added when empty).
Vendor prices are auto-generated around each item's base cost so price
comparison always has a clear cheapest vendor.

    python -m app.scripts.seed_demo
"""
import asyncio
from decimal import Decimal

from sqlalchemy import func, select

import app.auth.models  # noqa: F401  (register users table for FK resolution)
from app.inventory import service as inv
from app.inventory.models import Item, StockMovement
from app.recipes import service as rec
from app.recipes.models import Recipe
from app.vendors import service as ven
from app.vendors.models import Vendor

# name -> (unit, category, min_stock, opening_stock, base_price_gbp)
ITEMS: dict[str, tuple[str, str, str, str, str]] = {
    # Vegetables
    "White Onion": ("kg", "Vegetables", "15", "8", "0.58"),  # low stock
    "Red Onion": ("kg", "Vegetables", "10", "22", "0.72"),
    "Tomato": ("kg", "Vegetables", "10", "20", "1.15"),
    "Ginger": ("kg", "Vegetables", "3", "5", "2.50"),
    "Garlic (peeled)": ("kg", "Vegetables", "3", "4", "5.40"),
    "Green Chilli": ("kg", "Vegetables", "2", "3", "3.20"),
    "Coriander Leaves": ("kg", "Vegetables", "2", "1", "4.00"),  # low stock
    "Mint": ("kg", "Vegetables", "1", "2", "5.00"),
    "Curry Leaves": ("kg", "Vegetables", "1", "2", "8.00"),
    "Potato": ("kg", "Vegetables", "20", "40", "0.65"),
    "Carrot": ("kg", "Vegetables", "8", "15", "0.80"),
    "Bell Pepper (Red)": ("kg", "Vegetables", "5", "9", "2.20"),
    "Cauliflower": ("piece", "Vegetables", "10", "18", "0.85"),
    "Spinach": ("kg", "Vegetables", "3", "5", "1.90"),
    "Lemon": ("piece", "Vegetables", "30", "60", "0.18"),
    "Brinjal": ("kg", "Vegetables", "4", "7", "1.60"),
    # Dairy
    "Whole Milk": ("litre", "Dairy", "20", "40", "0.95"),
    "Paneer": ("kg", "Dairy", "5", "12", "6.99"),
    "Single Cream": ("litre", "Dairy", "4", "6", "2.79"),
    "Double Cream": ("litre", "Dairy", "4", "5", "3.40"),
    "Natural Yogurt": ("kg", "Dairy", "8", "15", "1.10"),
    "Greek Yogurt": ("kg", "Dairy", "4", "6", "2.20"),
    "Butter Unsalted": ("kg", "Dairy", "5", "8", "5.50"),
    "Cheddar Cheese": ("kg", "Dairy", "3", "4", "6.20"),
    # Meat & Poultry
    "Chicken Breast B/L": ("kg", "Meat & Poultry", "10", "6", "9.20"),  # low stock
    "Chicken (biryani cut)": ("kg", "Meat & Poultry", "10", "18", "8.00"),
    "Chicken Thigh B/L": ("kg", "Meat & Poultry", "8", "14", "7.40"),
    "Lamb (on the bone)": ("kg", "Meat & Poultry", "8", "12", "11.50"),
    "Mutton B/L": ("kg", "Meat & Poultry", "6", "9", "13.00"),
    "Eggs": ("tray", "Meat & Poultry", "5", "12", "3.20"),
    # Fish
    "Tilapia": ("kg", "Fish", "5", "8", "6.50"),
    "King Fish": ("kg", "Fish", "4", "6", "12.00"),
    "Prawns": ("kg", "Fish", "4", "5", "14.50"),
    # Rice, Flour, Pulses
    "Dawat Basmati": ("kg", "Rice & Flour", "20", "60", "5.20"),
    "Idly Rice": ("kg", "Rice & Flour", "10", "25", "1.00"),
    "Chapati Flour": ("kg", "Rice & Flour", "15", "30", "0.90"),
    "Gram Flour (Besan)": ("kg", "Rice & Flour", "5", "8", "1.40"),
    "Urad Dal": ("kg", "Pulses", "5", "10", "2.20"),
    "Toor Dal": ("kg", "Pulses", "5", "9", "1.90"),
    "Chana Dal": ("kg", "Pulses", "4", "7", "1.70"),
    # Spices
    "Cumin Seeds": ("kg", "Spices", "2", "4", "7.50"),
    "Coriander Seeds": ("kg", "Spices", "2", "4", "4.20"),
    "Turmeric Powder": ("kg", "Spices", "2", "3", "3.80"),
    "Red Chilli Powder": ("kg", "Spices", "3", "5", "4.50"),
    "Garam Masala": ("kg", "Spices", "1", "3", "9.00"),
    "Cardamom": ("kg", "Spices", "1", "1", "28.00"),  # low stock
    "Cinnamon": ("kg", "Spices", "1", "2", "12.00"),
    "Black Pepper": ("kg", "Spices", "1", "2", "11.00"),
    "Saffron": ("kg", "Spices", "1", "1", "1800.00"),
    "Bay Leaves": ("kg", "Spices", "1", "2", "10.00"),
    # Oils
    "Sunflower Oil": ("litre", "Oils", "10", "30", "1.72"),
    "Ghee": ("kg", "Oils", "5", "8", "6.80"),
    # Packaging & Cleaning
    "Aluminium Containers": ("pack", "Packaging", "10", "25", "4.50"),
    "Carry Bags (Large)": ("pack", "Packaging", "10", "20", "3.20"),
    "Vinyl Gloves": ("box", "Packaging", "5", "12", "4.99"),
    "Blue Roll": ("pack", "Cleaning", "5", "10", "5.99"),
    "Steel Scrubber": ("pack", "Cleaning", "5", "8", "1.20"),
}

VENDORS = ["Farm2Land", "Rudra", "SK", "Exotic"]
# Deterministic price spread around base cost -> there's always a clear cheapest.
PRICE_FACTORS = [Decimal("0.96"), Decimal("1.00"), Decimal("1.06"), Decimal("1.11")]

# recipe -> (servings, selling_price, [(item, qty, unit)])
RECIPES: dict[str, tuple[int, str, list[tuple[str, str, str]]]] = {
    "Chicken Biryani": (
        50, "12.95",
        [("Dawat Basmati", "5", "kg"), ("Chicken (biryani cut)", "4", "kg"),
         ("White Onion", "2", "kg"), ("Sunflower Oil", "1", "litre"),
         ("Ginger", "0.3", "kg"), ("Garlic (peeled)", "0.3", "kg"),
         ("Green Chilli", "0.2", "kg"), ("Garam Masala", "0.1", "kg"),
         ("Mint", "0.1", "kg")],
    ),
    "Mutton Biryani": (
        40, "14.95",
        [("Dawat Basmati", "4", "kg"), ("Mutton B/L", "3.5", "kg"),
         ("Red Onion", "2", "kg"), ("Ghee", "0.5", "kg"),
         ("Ginger", "0.3", "kg"), ("Garlic (peeled)", "0.3", "kg"),
         ("Garam Masala", "0.12", "kg")],
    ),
    "Vegetable Biryani": (
        40, "9.95",
        [("Dawat Basmati", "4", "kg"), ("Carrot", "1", "kg"),
         ("Cauliflower", "6", "piece"), ("Bell Pepper (Red)", "0.5", "kg"),
         ("Sunflower Oil", "0.8", "litre"), ("Garam Masala", "0.1", "kg")],
    ),
    "Masala Dosa": (
        30, "7.50",
        [("Idly Rice", "3", "kg"), ("Urad Dal", "1", "kg"),
         ("Potato", "2", "kg"), ("White Onion", "1", "kg"),
         ("Sunflower Oil", "0.5", "litre"), ("Turmeric Powder", "0.05", "kg")],
    ),
    "Plain Dosa": (
        30, "5.50",
        [("Idly Rice", "3", "kg"), ("Urad Dal", "1", "kg"),
         ("Sunflower Oil", "0.4", "litre")],
    ),
    "Idli (plate)": (
        40, "4.95",
        [("Idly Rice", "3", "kg"), ("Urad Dal", "1.2", "kg")],
    ),
    "Chicken 65": (
        20, "8.95",
        [("Chicken Breast B/L", "2", "kg"), ("Gram Flour (Besan)", "0.4", "kg"),
         ("Red Chilli Powder", "0.05", "kg"), ("Curry Leaves", "0.05", "kg"),
         ("Sunflower Oil", "0.6", "litre")],
    ),
    "Paneer Butter Masala": (
        20, "9.95",
        [("Paneer", "2", "kg"), ("Tomato", "2", "kg"), ("White Onion", "1", "kg"),
         ("Butter Unsalted", "0.3", "kg"), ("Double Cream", "0.5", "litre")],
    ),
    "Butter Chicken": (
        25, "10.95",
        [("Chicken Thigh B/L", "3", "kg"), ("Tomato", "2", "kg"),
         ("Butter Unsalted", "0.4", "kg"), ("Double Cream", "0.6", "litre"),
         ("Garam Masala", "0.1", "kg")],
    ),
    "Chicken Chettinad": (
        25, "10.50",
        [("Chicken (biryani cut)", "3", "kg"), ("White Onion", "1.5", "kg"),
         ("Black Pepper", "0.08", "kg"), ("Curry Leaves", "0.05", "kg"),
         ("Coriander Seeds", "0.1", "kg")],
    ),
    "Prawn Masala": (
        15, "12.95",
        [("Prawns", "2", "kg"), ("White Onion", "1", "kg"), ("Tomato", "1", "kg"),
         ("Red Chilli Powder", "0.04", "kg"), ("Sunflower Oil", "0.4", "litre")],
    ),
    "Gobi Manchurian": (
        20, "6.95",
        [("Cauliflower", "10", "piece"), ("Gram Flour (Besan)", "0.5", "kg"),
         ("Bell Pepper (Red)", "0.4", "kg"), ("Sunflower Oil", "0.7", "litre")],
    ),
    "Mango Lassi": (
        30, "3.50",
        [("Natural Yogurt", "4", "kg"), ("Whole Milk", "2", "litre")],
    ),
}

# Some consumption history (item -> qty used) so movement lists aren't empty.
CONSUMPTION = {
    "White Onion": "6", "Tomato": "8", "Chicken (biryani cut)": "5",
    "Dawat Basmati": "10", "Paneer": "3", "Sunflower Oil": "4",
}
WASTE = {"Coriander Leaves": "0.5", "Tomato": "1"}


async def _get_or_create_item(db, name, unit, category, min_stock):
    res = await db.execute(select(Item).where(Item.name == name))
    item = res.scalar_one_or_none()
    if item:
        return item
    return await inv.create_item(
        db, name=name, unit=unit, category=category, min_stock_level=Decimal(min_stock)
    )


async def _get_or_create_vendor(db, name):
    res = await db.execute(select(Vendor).where(Vendor.name == name))
    v = res.scalar_one_or_none()
    return v or await ven.create_vendor(db, name=name, category="FOOD")


async def _get_or_create_recipe(db, name, servings, price):
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
        # ── Items + opening stock ──
        items: dict[str, Item] = {}
        for name, (unit, cat, mn, opening, base) in ITEMS.items():
            item = await _get_or_create_item(db, name, unit, cat, mn)
            items[name] = item
            if item.current_stock == 0 and Decimal(opening) > 0:
                await inv.record_movement(
                    db, item, "PURCHASE_IN", Decimal(opening), unit_cost=Decimal(base)
                )

        # ── Vendors + auto-generated prices (2-4 vendors per item) ──
        vendors = {name: await _get_or_create_vendor(db, name) for name in VENDORS}
        for i, (name, (_u, _c, _m, _o, base)) in enumerate(ITEMS.items()):
            n_vendors = 2 + (i % 3)  # 2..4 vendors
            for j in range(n_vendors):
                vname = VENDORS[(i + j) % len(VENDORS)]
                price = (Decimal(base) * PRICE_FACTORS[j]).quantize(Decimal("0.01"))
                await ven.upsert_vendor_item(db, vendors[vname].id, items[name].id, price)

        # ── Consumption + waste history (only if no movements beyond opening) ──
        for name, qty in CONSUMPTION.items():
            it = items[name]
            count = await db.scalar(
                select(func.count()).select_from(StockMovement).where(
                    StockMovement.item_id == it.id
                )
            )
            if count and count <= 1 and it.current_stock >= Decimal(qty):
                await inv.record_movement(db, it, "CONSUMPTION", Decimal(qty))
        for name, qty in WASTE.items():
            it = items[name]
            if it.current_stock >= Decimal(qty):
                await inv.record_movement(db, it, "WASTE", Decimal(qty), notes="Spoiled")

        # ── Recipes + ingredients + computed cost/margin ──
        for rname, (servings, price, ingredients) in RECIPES.items():
            recipe = await _get_or_create_recipe(db, rname, servings, price)
            for item_name, qty, unit in ingredients:
                if item_name in items:
                    await rec.upsert_ingredient(
                        db, recipe.id, items[item_name].id, Decimal(qty), unit
                    )
            await rec.calculate_recipe_cost(db, recipe.id)

        print(
            f"Seeded {len(ITEMS)} items, {len(VENDORS)} vendors, {len(RECIPES)} recipes "
            "with prices, stock, consumption/waste history, and computed margins."
        )


if __name__ == "__main__":
    asyncio.run(main())
