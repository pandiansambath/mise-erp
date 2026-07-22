"""Expense endpoints. Hotel-scoped."""
import uuid
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.auth.deps import require
from app.auth.models import User
from app.core.database import get_db
from app.expenses import service
from app.expenses.schemas import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    ExpenseCreate,
    ExpenseOut,
    ExpenseSummary,
    ExpenseUpdate,
)

router = APIRouter(prefix="/expenses", tags=["expenses"])


# ── Categories ────────────────────────────────────────────────────────────
@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("expenses:read")),
) -> list[CategoryOut]:
    await service.ensure_default_categories(db, user.hotel_id)
    cats = await service.list_categories(db, user.hotel_id, active_only=False)
    counts = await service.category_usage_counts(db, user.hotel_id)
    return [
        CategoryOut(
            id=c.id, name=c.name, kind=c.kind, is_active=c.is_active,
            usage_count=counts.get(c.id, 0),
        )
        for c in cats
    ]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(
    payload: CategoryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("expenses:write")),
) -> CategoryOut:
    cat = await service.create_category(db, user.hotel_id, payload.name, payload.kind)
    return CategoryOut.model_validate(cat)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
async def update_category(
    category_id: uuid.UUID,
    payload: CategoryUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("expenses:write")),
) -> CategoryOut:
    cat = await service.get_category(db, category_id, user.hotel_id)
    if cat is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    cat = await service.update_category(db, cat, **payload.model_dump(exclude_unset=True))
    return CategoryOut.model_validate(cat)


# ── Expenses ────────────────────────────────────────────────────────────────
@router.get("", response_model=list[ExpenseOut])
async def list_expenses(
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    category_id: uuid.UUID | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("expenses:read")),
) -> list[ExpenseOut]:
    # Carry-forward: recurring costs whose next month has arrived appear
    # automatically the moment anyone opens the list. Never blocks the view.
    try:
        await service.materialize_recurring(db, user.hotel_id)
    except Exception:  # noqa: BLE001
        await db.rollback()
    rows = await service.list_expenses(
        db, user.hotel_id, date_from=date_from, date_to=date_to, category_id=category_id
    )
    return [ExpenseOut.model_validate(r) for r in rows]


@router.post("", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(
    payload: ExpenseCreate,
    force: bool = Query(default=False),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("expenses:write")),
) -> ExpenseOut:
    cat_check = await service.get_category(db, payload.category_id, user.hotel_id)
    if cat_check is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    # Fixed costs (rent, gas…) happen ONCE a month — a second entry in the same
    # month is almost always a double-count. Warn (409); the UI confirms + forces.
    if cat_check.kind == "FIXED" and not force:
        dups = await service.month_duplicates(
            db, user.hotel_id, payload.category_id, payload.date
        )
        if dups:
            d0 = dups[0]
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{cat_check.name} is already logged this month — "
                f"£{d0.amount} on {d0.date.strftime('%d %b')}. Logging it again "
                "would double-count the cost.",
            )
    exp = await service.create_expense(
        db, user.hotel_id, created_by=user.id, **payload.model_dump(exclude_none=True)
    )
    # response needs category_name + kind; re-fetch via list-shaped dict
    cat = await service.get_category(db, exp.category_id, user.hotel_id)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="expense.add",
        summary=f"Added expense: {cat.name} £{exp.amount} ({exp.payment_method or 'n/a'})",
        entity_type="expense", entity_id=exp.id,
    )
    return ExpenseOut.model_validate(
        {
            "id": exp.id,
            "category_id": exp.category_id,
            "category_name": cat.name,
            "kind": cat.kind,
            "date": exp.date,
            "amount": exp.amount,
            "vat_amount": exp.vat_amount,
            "description": exp.description,
            "payment_method": exp.payment_method,
            "is_recurring": exp.is_recurring,
            "recurrence": exp.recurrence,
            "auto_added": exp.recurred_from is not None,
            "from_payroll": False,
        }
    )


@router.patch("/{expense_id}", response_model=ExpenseOut)
async def update_expense(
    expense_id: uuid.UUID,
    payload: ExpenseUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("expenses:write")),
) -> ExpenseOut:
    exp = await service.get_expense(db, expense_id, user.hotel_id)
    if exp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")
    exp = await service.update_expense(db, exp, **payload.model_dump(exclude_unset=True))
    cat = await service.get_category(db, exp.category_id, user.hotel_id)
    return ExpenseOut.model_validate(
        {
            "id": exp.id,
            "category_id": exp.category_id,
            "category_name": cat.name,
            "kind": cat.kind,
            "date": exp.date,
            "amount": exp.amount,
            "vat_amount": exp.vat_amount,
            "description": exp.description,
            "payment_method": exp.payment_method,
            "is_recurring": exp.is_recurring,
            "recurrence": exp.recurrence,
            "auto_added": exp.recurred_from is not None,
            "from_payroll": False,
        }
    )


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(
    expense_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("expenses:write")),
) -> None:
    exp = await service.get_expense(db, expense_id, user.hotel_id)
    if exp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Expense not found")
    amount = exp.amount
    await service.delete_expense(db, exp)
    await audit.record(
        db, hotel_id=user.hotel_id, user=user, action="expense.delete",
        summary=f"Deleted expense £{amount} on {exp.date}",
        entity_type="expense", entity_id=expense_id,
    )


@router.get("/summary", response_model=ExpenseSummary)
async def expense_summary(
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require("expenses:read")),
) -> ExpenseSummary:
    return ExpenseSummary.model_validate(
        await service.summary(db, user.hotel_id, date_from, date_to)
    )
