"""Expense service: categories, expense CRUD, and summaries (feeds the P&L)."""
import uuid
from datetime import date as date_type
from decimal import Decimal

from sqlalchemy import func, select
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


async def category_usage_counts(db: AsyncSession, hotel_id: uuid.UUID) -> dict[uuid.UUID, int]:
    """category_id -> number of expenses using it (drives the safe-archive warning)."""
    rows = await db.execute(
        select(Expense.category_id, func.count())
        .where(Expense.hotel_id == hotel_id)
        .group_by(Expense.category_id)
    )
    return {cid: n for cid, n in rows.all()}


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


def _next_month(d: date_type) -> date_type:
    """Same day next month, clamped to that month's length (31 Jan → 28 Feb)."""
    import calendar

    year = d.year + (d.month == 12)
    month = (d.month % 12) + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return date_type(year, month, day)


async def materialize_recurring(db: AsyncSession, hotel_id: uuid.UUID) -> int:
    """Carry recurring costs forward: every MONTHLY-recurring expense that is the
    latest in its chain spawns next month's copy once that date arrives. Runs
    lazily whenever the list is viewed — idempotent (the chain link is unique),
    capped, and best-effort. Turning is_recurring OFF stops the chain."""
    today = date_type.today()
    rows = await db.execute(
        select(Expense).where(
            Expense.hotel_id == hotel_id,
            Expense.is_recurring.is_(True),
            Expense.recurrence == "MONTHLY",
        )
    )
    all_rec = list(rows.scalars().all())
    has_successor = {e.recurred_from for e in all_rec if e.recurred_from}
    created = 0
    for e in all_rec:
        cur = e
        # walk forward from the latest link only
        if cur.id in has_successor:
            continue
        for _ in range(12):  # cap: never explode on ancient rows
            nxt = _next_month(cur.date)
            if nxt > today:
                break
            copy = Expense(
                hotel_id=hotel_id,
                category_id=cur.category_id,
                date=nxt,
                amount=cur.amount,
                vat_amount=cur.vat_amount,
                description=cur.description,
                vendor_id=cur.vendor_id,
                payment_method=cur.payment_method,
                is_recurring=True,
                recurrence="MONTHLY",
                recurred_from=cur.id,
            )
            db.add(copy)
            await db.flush()
            created += 1
            cur = copy
    if created:
        await db.commit()
    return created


async def month_duplicates(
    db: AsyncSession, hotel_id: uuid.UUID, category_id: uuid.UUID, on: date_type
) -> list[Expense]:
    """Existing expenses in the SAME fixed category and calendar month — the
    'rent already logged, don't double-spend' warning."""
    start = on.replace(day=1)
    end = _next_month(start)
    rows = await db.execute(
        select(Expense).where(
            Expense.hotel_id == hotel_id,
            Expense.category_id == category_id,
            Expense.date >= start,
            Expense.date < end,
        )
    )
    return list(rows.scalars().all())


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
    out = []
    for e, c in rows.all():
        desc = e.description or ""
        from_payroll = "[payroll:" in desc
        if from_payroll:
            desc = desc.split("[payroll:")[0].strip()
        out.append({
            "id": e.id,
            "category_id": e.category_id,
            "category_name": c.name,
            "kind": c.kind,
            "date": e.date,
            "amount": e.amount,
            "vat_amount": e.vat_amount,
            "description": desc or None,
            "payment_method": e.payment_method,
            "is_recurring": e.is_recurring,
            "recurrence": e.recurrence,
            "auto_added": e.recurred_from is not None,
            "from_payroll": from_payroll,
        })
    return out


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
