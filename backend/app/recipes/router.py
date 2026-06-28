"""Recipe endpoints: CRUD, ingredients, and cost/margin calculation. Hotel-scoped."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.hotels.models import Hotel
from app.inventory.service import get_item
from app.recipes import pdf as recipe_pdf
from app.recipes import service
from app.recipes.schemas import (
    AllergenRow,
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
    try:
        recipe = await service.create_recipe(
            db, user.hotel_id, **payload.model_dump(exclude_none=True)
        )
    except service.DuplicateRecipeError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return RecipeOut.model_validate(recipe)


@router.get("", response_model=list[RecipeOut])
async def list_recipes(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> list[RecipeOut]:
    recipes = await service.list_recipes(
        db, user.hotel_id, active_only=not include_inactive
    )
    return [RecipeOut.model_validate(r) for r in recipes]


# Defined before /{recipe_id} so the literal path isn't captured as a recipe id.
@router.get("/allergen-matrix", response_model=list[AllergenRow])
async def allergen_matrix(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> list[AllergenRow]:
    """Per-dish allergen matrix (Natasha's Law) — allergens derived from ingredients."""
    rows = await service.allergen_matrix(db, user.hotel_id)
    return [AllergenRow.model_validate(r) for r in rows]


@router.get("/allergen-matrix.pdf")
async def export_allergen_pdf(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> Response:
    """The allergen matrix as a clean, branded PDF (server-side, not a screen-print)."""
    hotel = await db.get(Hotel, user.hotel_id)
    rows = await service.allergen_matrix(db, user.hotel_id)
    data = recipe_pdf.allergen_pdf(hotel.name if hotel else "Mise", rows)
    return Response(
        content=data, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="allergen-matrix.pdf"'},
    )


class PartyQuoteLine(BaseModel):
    name: str
    qty: int = 0
    unit_price: float | None = None
    unit_cost: float = 0.0


class PartyQuoteRequest(BaseModel):
    customer: str = ""
    when: str = ""
    currency: str = "GBP "
    lines: list[PartyQuoteLine]


@router.post("/party-quote.pdf")
async def export_party_quote_pdf(
    payload: PartyQuoteRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> Response:
    """Render the party-order quote as a clean, branded PDF (not a browser screen-print)."""
    hotel = await db.get(Hotel, user.hotel_id)
    data = recipe_pdf.party_quote_pdf(
        hotel.name if hotel else "Mise", payload.customer, payload.when,
        payload.currency, [ln.model_dump() for ln in payload.lines],
    )
    return Response(
        content=data, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="party-order-quote.pdf"'},
    )


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
