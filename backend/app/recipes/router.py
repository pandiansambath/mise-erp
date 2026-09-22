"""Recipe endpoints: CRUD, ingredients, and cost/margin calculation. Hotel-scoped."""
import re
import uuid
from difflib import SequenceMatcher

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.assistant import bedrock
from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core import list_commit, list_io, lists, roundtrip, template_io
from app.core.config import settings
from app.core.database import get_db
from app.core.template_io import XLSX_MIME
from app.hotels.models import Hotel
from app.inventory import service as inv_service
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

# Handwritten-note parsing: strip a leading "1." / "3)" and pull a trailing quantity.
_NUM_PREFIX_RE = re.compile(r"^\s*\d+\s*[.)]\s*")
_QTY_RE = re.compile(r"(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?\s*$")
_UNIT_MAP = {
    "gms": "g", "gm": "g", "gram": "g", "grams": "g", "g": "g",
    "kg": "kg", "kgs": "kg", "ml": "ml", "l": "litre", "ltr": "litre",
    "litre": "litre", "liter": "litre", "nos": "piece", "no": "piece",
    "pcs": "piece", "pc": "piece", "piece": "piece", "tray": "tray",
    "pack": "pack", "packet": "pack",
}


def _parse_note_line(line: str) -> tuple[str, str | None, str | None]:
    """A handwritten line → (item name, qty, unit). Best-effort."""
    s = _NUM_PREFIX_RE.sub("", line.strip())
    qty: str | None = None
    unit: str | None = None
    name = s
    m = _QTY_RE.search(s)
    if m:
        qty = m.group(1)
        raw_unit = (m.group(2) or "").lower()
        unit = _UNIT_MAP.get(raw_unit, raw_unit or None)
        name = s[: m.start()].strip(" -:·.")
    return name, qty, unit


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


@router.post("/scan-note")
async def scan_note(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> dict:
    """Read a HANDWRITTEN recipe note and turn each line into a suggested
    ingredient (item name + qty), matched to your inventory. Returns an editable
    preview — nothing is added until the user confirms.

    Read by the assistant model rather than a separate document service: it
    handles handwriting better, it can be given this kitchen's actual item names
    so the matching is not a guess, and it is one dependency instead of two.
    """
    data = await file.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")

    items = await inv_service.list_items(db, user.hotel_id)
    try:
        read = await run_in_threadpool(
            bedrock.understand_document,
            data,
            file.content_type or "image/jpeg",
            kind="recipe",
            filename=file.filename or "",
            known_items=[
                {"id": str(i.id), "name": i.name, "unit": i.unit or ""} for i in items
            ],
        )
    except Exception as exc:  # noqa: BLE001 — shown to the operator as-is
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Could not read the note: {exc}"
        ) from exc

    # The model returns structured ingredients; keep the same shape the rest of
    # this endpoint already produced so the UI does not change.
    lines = [
        " ".join(
            str(x)
            for x in [ing.get("qty"), ing.get("unit"), ing.get("name")]
            if x not in (None, "")
        )
        for ing in (read.get("ingredients") or [])
    ]
    out: list[dict] = []
    for ln in lines:
        name, qty, unit = _parse_note_line(ln)
        if not name or len(name) < 2:
            continue
        best = None
        best_score = 0.0
        for it in items:
            score = SequenceMatcher(None, name.lower(), it.name.lower()).ratio()
            if score > best_score:
                best, best_score = it, score
        matched = best_score >= 0.5 and best is not None
        out.append({
            "raw": ln,
            "name": name,
            "qty": qty,
            "unit": unit,
            "item_id": str(best.id) if matched else None,
            "item_name": best.name if matched else None,
            "matched_unit": best.unit if matched else None,
            "confidence": round(best_score, 2),
        })
    return {"lines": out}


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
    data = recipe_pdf.allergen_pdf(hotel.name if hotel else "DineAI", rows)
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
        hotel.name if hotel else "DineAI", payload.customer, payload.when,
        payload.currency, [ln.model_dump() for ln in payload.lines],
    )
    return Response(
        content=data, media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="party-order-quote.pdf"'},
    )


# ── the round trip ────────────────────────────────────────────────────────
#
#     "like this so many export featrue not available issue even in menu recipe"
#
# ⚠️ ABOVE `/{recipe_id}`, like the comment further up already warns: Starlette
# matches in declaration order, so a literal path declared after it is parsed
# as a recipe id and 422s while looking, in the source, like it exists.


def _menu_file(content: bytes, media: str, name: str) -> Response:
    return Response(
        content=content, media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@router.get("/export.csv")
async def export_menu_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> Response:
    rows = await service.list_recipes(db, user.hotel_id, active_only=False)
    return _menu_file(
        roundtrip.to_csv(lists.RECIPES, rows), "text/csv", "dineai-menu.csv"
    )


@router.get("/export.xlsx")
async def export_menu_xlsx(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:read")),
) -> Response:
    rows = await service.list_recipes(db, user.hotel_id, active_only=False)
    return _menu_file(
        roundtrip.to_xlsx(lists.RECIPES, rows), XLSX_MIME, "dineai-menu.xlsx"
    )


@router.get("/import-template.xlsx")
async def menu_template(user: User = Depends(require("recipes:read"))) -> Response:
    return _menu_file(
        template_io.template_xlsx(lists.RECIPES.template()),
        XLSX_MIME, "dineai-menu-template.xlsx",
    )


class _RecipesRowsIn(BaseModel):
    """Rows from typing, or from the AI reading something. Not from a file."""

    rows: list[dict] = Field(default_factory=list)


@router.post("/import/preview-rows")
async def preview_recipes_rows(
    payload: _RecipesRowsIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> dict:
    """Classify rows that never came from a file. Writes nothing.

    Typing and the AI both produce rows, and `classify()` takes rows — it was
    split out of `build_plan` for precisely this and then had no HTTP door, so
    the only way to reach a preview was to upload something. Typed entry had
    no duplicate check at all.

    Same classify, same rules, same screen, same commit endpoint. A second
    path here would be the same thing built twice at half the quality.
    """
    rows = [r for r in payload.rows if isinstance(r, dict)][:list_commit.MAX_COMMIT_ROWS]
    allowed = {f.key for f in lists.RECIPES.fields}
    cleaned = [{k: v for k, v in r.items() if k in allowed} for r in rows]
    existing = await service.list_recipes(db, user.hotel_id, active_only=False)
    return list_io.classify(cleaned, lists.RECIPES, existing).as_dict()


@router.post("/import/read-ai")
async def read_recipes_with_ai(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> dict:
    """Read ANY documents as this list, with the AI. Writes nothing.

        "everytime they wont have a tempate ... let them add whatever
         document they have like csv image pdf word whatsever"

    A spreadsheet with unfamiliar headings, a supplier's PDF, twenty
    photographs of a handwritten book. The deterministic reader runs first
    and is free; this is for everything it cannot parse, and telling somebody
    to go and fill in a blank template instead is the extra job he is
    describing.

    N FILES, ONE PREVIEW. Each is read separately — a photo of page three
    knows nothing about page two — then pooled before a single `classify`,
    so a dish appearing on two photographs is caught as a duplicate of itself
    rather than added twice.
    """
    from app.assistant import docbytes, ingest
    from app.assistant.provider import ProviderError

    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No files")
    if len(files) > 25:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "That is more than 25 files. Send them in a couple of goes so you "
            "can check each batch.",
        )

    rows: list[dict] = []
    read: list[str] = []
    failed: list[dict] = []

    for f in files:
        data = await f.read()
        name = f.filename or "file"
        if not data:
            continue
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            failed.append({"name": name, "why": "too large"})
            continue
        if docbytes.is_unreadable(name):
            failed.append({"name": name, "why": "that is an archive or a video"})
            continue
        try:
            got = await ingest.read_as(data, f.content_type or "", name, "recipes")
        except ProviderError as exc:
            # ONE BAD FILE MUST NOT LOSE THE OTHER NINETEEN. He is uploading a
            # stack of photographs; failing the batch on the blurry one is
            # the worst possible way to spend his afternoon.
            failed.append({"name": name, "why": str(exc)[:120]})
            continue
        rows.extend(got)
        read.append(name)

    if not rows:
        return {
            "plan": None,
            "read": read,
            "failed": failed,
            "why": (
                "I read those, but couldn't find any recipes in them. If they "
                "are the right documents, tell me what I missed and I'll look "
                "again."
            ),
        }

    existing = await service.list_recipes(db, user.hotel_id, active_only=False)
    plan = list_io.classify(rows[:list_commit.MAX_COMMIT_ROWS], lists.RECIPES, existing)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="recipes.read_ai",
        summary=f"AI read {len(read)} document(s) as recipes ({len(rows)} rows, nothing saved yet)",
    )
    return {
        "plan": plan.as_dict(),
        "read": read,
        "failed": failed,
        "truncated": len(rows) > list_commit.MAX_COMMIT_ROWS,
    }


@router.post("/import/inspect")
async def inspect_recipes_import(
    file: UploadFile = File(...),
    user: User = Depends(require("recipes:write")),
) -> dict:
    """What is in this file, and what we would guess each column means.

    Reads nothing from the database and writes nothing. It exists so a file
    whose headings we do not recognise is a QUESTION rather than a dead end —
    and so a guess is never silently acted on.
    """
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {settings.max_upload_mb} MB",
        )
    return template_io.inspect_upload(
        data, file.filename or "", file.content_type or "", lists.RECIPES.template()
    )


@router.post("/import/preview")
async def preview_menu_import(
    file: UploadFile = File(...),
    # THE MAPPING THE PERSON CONFIRMED, as a JSON string: this request is
    # multipart because it carries a file, and multipart has no objects.
    mapping: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> dict:
    """What would happen. Writes nothing."""
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds {settings.max_upload_mb} MB",
        )
    existing = await service.list_recipes(db, user.hotel_id, active_only=False)
    plan = list_io.build_plan(
        data, file.filename or "", file.content_type or "", lists.RECIPES,
        existing, list_io._mapping(mapping),
    )
    return plan.as_dict()


class _MenuCommitIn(BaseModel):
    rows: list[dict] = Field(default_factory=list)
    source: str = "file"


@router.post("/import/commit")
async def commit_menu_import(
    payload: _MenuCommitIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("recipes:write")),
) -> dict:
    """Write the decided dishes.

    `calculated_cost` is exported and NOT accepted back — it is derived from
    the recipe lines and the current supplier prices, so taking it from a
    spreadsheet would let a stale number overwrite one the product computes.
    The spec simply does not declare it, and `clean_decisions` whitelists to
    the spec, so there is nothing to remember here.
    """
    decisions, errors = list_commit.clean_decisions(payload.rows, lists.RECIPES)
    if errors:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(errors[:3]))

    existing = await service.list_recipes(db, user.hotel_id, active_only=False)

    async def _create(values: dict):
        return await service.create_recipe(db, user.hotel_id, **_typed(values))

    async def _update(target, values: dict):
        return await service.update_recipe(db, target, **_typed(values))

    report = await list_commit.apply(
        decisions, lists.RECIPES, existing, create=_create, update=_update
    )
    out = report.as_dict(sent=len(decisions))
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="recipes.import",
        summary=(
            f"Imported menu from {payload.source}: {out['counts']['created']} added, "
            f"{out['counts']['updated']} updated, {out['counts']['failed']} failed"
        ),
    )
    return out


def _typed(values: dict) -> dict:
    """Make the parsed row match the COLUMN TYPES, not just the spec.

    `parse_upload` reads every `kind="number"` field as `float(Decimal(...))`,
    which is right for money — `selling_price` is Numeric(10,2) and `pay_rate`
    on the staff list is too. `servings_default` is the first INTEGER column
    any list has had, and asyncpg does not round for you: it refuses 1.0 for an
    int4 parameter outright, so every dish carrying a serving count would land
    in `failed` with a driver message nobody can act on.

    A None is dropped rather than passed on. `servings_default` and
    `is_active` are NOT NULL with python-side defaults, and naming one in the
    constructor overrides its default with NULL — a file path never sends one
    (an empty cell is simply absent), but the assistant builds its rows in
    prose and can.
    """
    out = {k: v for k, v in values.items() if v is not None}
    n = out.get("servings_default")
    if n is not None:
        try:
            out["servings_default"] = max(1, int(round(float(n))))
        except (TypeError, ValueError):
            out.pop("servings_default")
    return out


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
