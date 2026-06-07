"""Expense service: categories, expense CRUD, and summaries (feeds the P&L)."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.expenses.models import Expense, ExpenseCategory, ExpenseKind

# Default categories seeded per hotel.
DEFAULT_CATEGORIES = [
    ("Rent", "FIXED"),
    ("Staff Salaries", "FIXED"),
    ("Electricity", "FIXED"),
    ("Gas", "FIXED"),
    ("Water", "FIXED"),
    ("Internet & Phone", "FIXED"),
    ("Insurance", "FIXED"),
    ("Council Rates", "FIXED"),
    ("Waste Collection", "FIXED"),
    ("Maintenance", "FIXED"),
    ("Vegetables", "VARIABLE"),
    ("Meat & Fish", "VARIABLE"),
    ("Dairy", "VARIABLE"),
    ("Groceries & Dry Goods", "VARIABLE"),
    ("Packaging", "VARIABLE"),
    ("Cleaning Supplies", "VARIABLE"),
    ("Marketing", "VARIABLE"),
    ("Repairs", "VARIABLE"),
    ("Miscellaneous", "VARIABLE"),
]


# ── Categories ────────────────────────────────────────────────────────────
async def list_categories(
    db: AsyncSession, hotel_id: uuid.UUID, *, active_only: bool = True
) -> list[ExpenseCategory]:
    stmt = select(ExpenseCategory).where(ExpenseCategory.hotel_id == hotel_id)
    if active_only:
        stmt = stmt.where(ExpenseCategory.is_active.is_(True))
    result = await db.execute(stmt.order_by(ExpenseCategory.kind, ExpenseCategory.name))
    return list(result.scalars().all())


async def get_category(
    db: AsyncSession, category_id: uuid.UUID, hotel_id: uuid.UUID
) -> ExpenseCategory | None:
    cat = await db.get(ExpenseCategory, category_id)
    if cat is None or cat.hotel_id != hotel_id:
        return None
    return cat


async def create_category(
    db: AsyncSession, hotel_id: uuid.UUID, name: str, kind: str
) -> ExpenseCategory:
    cat = ExpenseCategory(hotel_id=hotel_id, name=name, kind=kind)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


async def update_category(db: AsyncSession, cat: ExpenseCategory, **fields) -> ExpenseCategory:
    for k, v in fields.items():
        if v is not None:
            setattr(cat, k, v)
    await db.commit()
    await db.refresh(cat)
    return cat


async def ensure_default_categories(db: AsyncSession, hotel_id: uuid.UUID) -> None:
    if await list_categories(db, hotel_id, active_only=False):
        return
    for name, kind in DEFAULT_CATEGORIES:
        db.add(ExpenseCategory(hotel_id=hotel_id, name=name, kind=kind))
    await db.commit()


# ── Expenses ────────────────────────────────────────────────────────────────
async def create_expense(db: AsyncSession, hotel_id: uuid.UUID, **fields) -> Expense:
    exp = Expense(hotel_id=hotel_id, **fields)
    db.add(exp)
    await db.commit()
    await db.refresh(exp)
    return exp


async def get_expense(
    db: AsyncSession, expense_id: uuid.UUID, hotel_id: uuid.UUID
) -> Expense | None:
    exp = await db.get(Expense, expense_id)
    if exp is None or exp.hotel_id != hotel_id:
        return None
    return exp


async def update_expense(db: AsyncSession, exp: Expense, **fields) -> Expense:
    for k, v in fields.items():
        if v is not None:
            setattr(exp, k, v)
    await db.commit()
    await db.refresh(exp)
    return exp


async def delete_expense(db: AsyncSession, exp: Expense) -> None:
    await db.delete(exp)
    await db.commit()


async def list_expenses(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    *,
    date_from: date_type | None = None,
    date_to: date_type | None = None,
    category_id: uuid.UUID | None = None,
) -> list[dict]:
    stmt = (
        select(Expense, ExpenseCategory)
        .join(ExpenseCategory, Expense.category_id == ExpenseCategory.id)
        .where(Expense.hotel_id == hotel_id)
    )
    if date_from:
        stmt = stmt.where(Expense.date >= date_from)
    if date_to:
        stmt = stmt.where(Expense.date <= date_to)
    if category_id:
        stmt = stmt.where(Expense.category_id == category_id)
    rows = await db.execute(stmt.order_by(Expense.date.desc()))
    return [
        {
            "id": e.id,
            "category_id": e.category_id,
            "category_name": c.name,
            "kind": c.kind,
            "date": e.date,
            "amount": e.amount,
            "vat_amount": e.vat_amount,
            "description": e.description,
            "payment_method": e.payment_method,
            "is_recurring": e.is_recurring,
        }
        for e, c in rows.all()
    ]


async def summary(
    db: AsyncSession, hotel_id: uuid.UUID, date_from: date_type, date_to: date_type
) -> dict:
    rows = await db.execute(
        select(Expense, ExpenseCategory)
        .join(ExpenseCategory, Expense.category_id == ExpenseCategory.id)
        .where(
            Expense.hotel_id == hotel_id,
            Expense.date >= date_from,
            Expense.date <= date_to,
        )
    )
    fixed = variable = vat = Decimal("0")
    by_cat: dict[uuid.UUID, dict] = {}
    for e, c in rows.all():
        vat += e.vat_amount
        if c.kind == ExpenseKind.FIXED.value:
            fixed += e.amount
        else:
            variable += e.amount
        slot = by_cat.setdefault(
            c.id,
            {"category_id": c.id, "category_name": c.name, "kind": c.kind, "total": Decimal("0")},
        )
        slot["total"] += e.amount

    return {
        "date_from": date_from,
        "date_to": date_to,
        "fixed_total": fixed,
        "variable_total": variable,
        "vat_total": vat,
        "grand_total": fixed + variable,
        "by_category": sorted(by_cat.values(), key=lambda r: r["total"], reverse=True),
    }
