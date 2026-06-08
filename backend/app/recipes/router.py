"""Recipe endpoints: CRUD, ingredients, and cost/margin calculation. Hotel-scoped."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.inventory.service import get_item
from app.recipes import service
from app.recipes.schemas import (
    IngredientOut,
    IngredientUpsert,
    RecipeCostBreakdown,
    RecipeCreate,
    RecipeOut,
    RecipeUpdate,
)

router = APIRouter(prefix="/recipes", tags=["recipes"])


@router.post("", response_model=RecipeOut, status_code=status.HTTP_201_CREATED)
async def create_recipe(
    payload: RecipeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> RecipeOut:
    recipe = await service.create_recipe(db, user.hotel_id, **payload.model_dump(exclude_none=True))
    return RecipeOut.model_validate(recipe)


@router.get("", response_model=list[RecipeOut])
async def list_recipes(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> list[RecipeOut]:
    recipes = await service.list_recipes(db, user.hotel_id)
    return [RecipeOut.model_validate(r) for r in recipes]


@router.get("/{recipe_id}", response_model=RecipeOut)
async def get_recipe(
    recipe_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> RecipeOut:
    recipe = await service.get_recipe(db, recipe_id, user.hotel_id)
    if recipe is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    return RecipeOut.model_validate(recipe)


@router.patch("/{recipe_id}", response_model=RecipeOut)
async def update_recipe(
    recipe_id: uuid.UUID,
    payload: RecipeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> RecipeOut:
    recipe = await service.get_recipe(db, recipe_id, user.hotel_id)
    if recipe is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    recipe = await service.update_recipe(db, recipe, **payload.model_dump(exclude_unset=True))
    return RecipeOut.model_validate(recipe)


@router.post(
    "/{recipe_id}/ingredients", response_model=IngredientOut, status_code=status.HTTP_201_CREATED
)
async def add_ingredient(
    recipe_id: uuid.UUID,
    payload: IngredientUpsert,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> IngredientOut:
    if await service.get_recipe(db, recipe_id, user.hotel_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    if await get_item(db, payload.item_id, user.hotel_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    ing = await service.upsert_ingredient(
        db, recipe_id, payload.item_id, payload.quantity, payload.unit
    )
    return IngredientOut.model_validate(ing)


@router.get("/{recipe_id}/ingredients", response_model=list[IngredientOut])
async def list_ingredients(
    recipe_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> list[IngredientOut]:
    if await service.get_recipe(db, recipe_id, user.hotel_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    ings = await service.list_ingredients(db, recipe_id)
    return [IngredientOut.model_validate(i) for i in ings]


@router.delete("/{recipe_id}/ingredients/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ingredient(
    recipe_id: uuid.UUID,
    item_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> None:
    if await service.get_recipe(db, recipe_id, user.hotel_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    await service.delete_ingredient(db, recipe_id, item_id)


@router.get("/{recipe_id}/cost", response_model=RecipeCostBreakdown)
async def recipe_cost(
    recipe_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> RecipeCostBreakdown:
    """Compute cost/serving and profit margin from current cheapest vendor prices."""
    result = await service.calculate_recipe_cost(db, recipe_id, user.hotel_id)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recipe not found")
    return RecipeCostBreakdown.model_validate(result)
