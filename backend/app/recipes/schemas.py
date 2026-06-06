"""Pydantic schemas for recipes + cost breakdown."""
import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class RecipeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    servings_default: int = Field(default=1, gt=0)
    category: str | None = None
    selling_price: Decimal | None = Field(default=None, ge=0)


class RecipeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    servings_default: int | None = Field(default=None, gt=0)
    category: str | None = None
    selling_price: Decimal | None = Field(default=None, ge=0)
    is_active: bool | None = None


class RecipeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    category: str | None
    servings_default: int
    selling_price: Decimal | None
    calculated_cost: Decimal
    profit_margin: Decimal | None
    is_active: bool


class IngredientUpsert(BaseModel):
    item_id: uuid.UUID
    quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=20)


class IngredientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    recipe_id: uuid.UUID
    item_id: uuid.UUID
    quantity: Decimal
    unit: str


class IngredientCost(BaseModel):
    item_id: uuid.UUID
    item_name: str
    quantity: Decimal
    unit: str
    unit_price: Decimal
    price_source: str  # "vendor" | "average_cost" | "none"
    vendor_name: str | None
    line_cost: Decimal


class RecipeCostBreakdown(BaseModel):
    recipe_id: uuid.UUID
    recipe_name: str
    servings: int
    total_cost: Decimal
    cost_per_serving: Decimal
    selling_price: Decimal | None
    profit_margin_pct: Decimal | None
    has_missing_prices: bool
    ingredients: list[IngredientCost]
