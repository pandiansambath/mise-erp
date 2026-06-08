"""Recipe service: CRUD, ingredients, and the cost/margin calculation engine.

Cost = sum(ingredient.quantity * cheapest active-vendor price). If no vendor
price exists for an item we fall back to its weighted-average purchase cost,
and if that's also unknown we flag the recipe as having missing prices (so the
margin shown is never silently wrong).
"""
import uuid
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import Item
from app.recipes.models import Recipe, RecipeIngredient
from app.vendors.models import Vendor, VendorItem


class DuplicateRecipeError(ValueError):
    """Raised when a recipe with the same name AND serving size already exists.

    (Same name with a *different* serving size is intentionally allowed.)
    """

_Q4 = Decimal("0.0001")
_Q2 = Decimal("0.01")


# ── Recipe CRUD (hotel-scoped) ──────────────────────────────────────────────
async def create_recipe(db: AsyncSession, hotel_id: uuid.UUID, **fields) -> Recipe:
    name = fields.get("name", "")
    servings = fields.get("servings_default", 1)
    if name:
        exists = await db.execute(
            select(Recipe.id).where(
                Recipe.hotel_id == hotel_id,
                func.lower(Recipe.name) == name.strip().lower(),
                Recipe.servings_default == servings,
            ).limit(1)
        )
        if exists.first() is not None:
            raise DuplicateRecipeError(
                f'"{name.strip()}" at {servings} serves already exists — '
                "edit it, or use a different serving size"
            )
    recipe = Recipe(hotel_id=hotel_id, **fields)
    db.add(recipe)
    await db.commit()
    await db.refresh(recipe)
    return recipe


async def get_recipe(db: AsyncSession, recipe_id: uuid.UUID, hotel_id: uuid.UUID) -> Recipe | None:
    recipe = await db.get(Recipe, recipe_id)
    if recipe is None or recipe.hotel_id != hotel_id:
        return None
    return recipe


async def list_recipes(
    db: AsyncSession, hotel_id: uuid.UUID, *, active_only: bool = True
) -> list[Recipe]:
    stmt = select(Recipe).where(Recipe.hotel_id == hotel_id)
    if active_only:
        stmt = stmt.where(Recipe.is_active.is_(True))
    result = await db.execute(stmt.order_by(Recipe.name))
    return list(result.scalars().all())


async def update_recipe(db: AsyncSession, recipe: Recipe, **fields) -> Recipe:
    for key, value in fields.items():
        if value is not None:
            setattr(recipe, key, value)
    await db.commit()
    await db.refresh(recipe)
    return recipe


# ── Ingredients ──────────────────────────────────────────────────────────────
async def upsert_ingredient(
    db: AsyncSession, recipe_id: uuid.UUID, item_id: uuid.UUID, quantity: Decimal, unit: str
) -> RecipeIngredient:
    result = await db.execute(
        select(RecipeIngredient).where(
            RecipeIngredient.recipe_id == recipe_id, RecipeIngredient.item_id == item_id
        )
    )
    ing = result.scalar_one_or_none()
    if ing is None:
        ing = RecipeIngredient(recipe_id=recipe_id, item_id=item_id)
        db.add(ing)
    ing.quantity = quantity
    ing.unit = unit
    await db.commit()
    await db.refresh(ing)
    return ing


async def list_ingredients(db: AsyncSession, recipe_id: uuid.UUID) -> list[RecipeIngredient]:
    result = await db.execute(
        select(RecipeIngredient).where(RecipeIngredient.recipe_id == recipe_id)
    )
    return list(result.scalars().all())


async def delete_ingredient(db: AsyncSession, recipe_id: uuid.UUID, item_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(RecipeIngredient).where(
            RecipeIngredient.recipe_id == recipe_id, RecipeIngredient.item_id == item_id
        )
    )
    ing = result.scalar_one_or_none()
    if ing is None:
        return False
    await db.delete(ing)
    await db.commit()
    return True


async def _best_price(
    db: AsyncSession, item_id: uuid.UUID, hotel_id: uuid.UUID
) -> tuple[Decimal | None, str | None, str | None]:
    """Price used for costing: the PREFERRED vendor if one is set, else the cheapest
    active vendor. Returns (price, vendor_name, source) where source is
    'preferred' | 'cheapest' | None."""
    base = (
        select(VendorItem.price_per_unit, Vendor.name)
        .join(Vendor, VendorItem.vendor_id == Vendor.id)
        .where(
            VendorItem.item_id == item_id,
            Vendor.hotel_id == hotel_id,
            Vendor.is_active.is_(True),
        )
    )
    pref = await db.execute(base.where(VendorItem.is_preferred.is_(True)).limit(1))
    row = pref.first()
    if row:
        return (row[0], row[1], "preferred")
    cheapest = await db.execute(base.order_by(VendorItem.price_per_unit.asc()).limit(1))
    row = cheapest.first()
    return (row[0], row[1], "cheapest") if row else (None, None, None)


# ── The costing engine ───────────────────────────────────────────────────────
async def calculate_recipe_cost(
    db: AsyncSession, recipe_id: uuid.UUID, hotel_id: uuid.UUID
) -> dict | None:
    """Compute (and persist) a recipe's cost/serving and profit margin from
    current cheapest vendor prices. Returns a full breakdown, or None if the
    recipe doesn't exist in this hotel."""
    recipe = await get_recipe(db, recipe_id, hotel_id)
    if recipe is None:
        return None

    ingredients = await list_ingredients(db, recipe_id)
    total = Decimal("0")
    breakdown: list[dict] = []
    has_missing = False

    for ing in ingredients:
        item = await db.get(Item, ing.item_id)
        price, vendor_name, vsrc = await _best_price(db, ing.item_id, hotel_id)
        if price is not None:
            source = vsrc  # "preferred" or "cheapest"
        elif item is not None and item.average_cost and item.average_cost > 0:
            price, source = item.average_cost, "average_cost"
        else:
            price, source, has_missing = Decimal("0"), "none", True

        line_cost = (ing.quantity * price).quantize(_Q4, ROUND_HALF_UP)
        total += line_cost
        breakdown.append(
            {
                "item_id": ing.item_id,
                "item_name": item.name if item else "(deleted item)",
                "quantity": ing.quantity,
                "unit": ing.unit,
                "unit_price": price,
                "price_source": source,
                "vendor_name": vendor_name,
                "line_cost": line_cost,
            }
        )

    servings = recipe.servings_default or 1
    total = total.quantize(_Q4, ROUND_HALF_UP)
    cost_per_serving = (total / servings).quantize(_Q4, ROUND_HALF_UP)

    margin = None
    if recipe.selling_price and recipe.selling_price > 0:
        margin = (
            (recipe.selling_price - cost_per_serving) / recipe.selling_price * 100
        ).quantize(_Q2, ROUND_HALF_UP)

    recipe.calculated_cost = cost_per_serving
    recipe.profit_margin = margin
    await db.commit()

    return {
        "recipe_id": recipe.id,
        "recipe_name": recipe.name,
        "servings": servings,
        "total_cost": total,
        "cost_per_serving": cost_per_serving,
        "selling_price": recipe.selling_price,
        "profit_margin_pct": margin,
        "has_missing_prices": has_missing,
        "ingredients": breakdown,
    }
