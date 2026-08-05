"""What a new restaurant still has to set up.

A brand-new hotel signs in and lands on a dashboard of zeroes. Every number is
correct and none of it means anything, because the app knows nothing about the
business yet — and nothing on the screen says which of the fifteen sections to
open first, or in what order, or why.

So this answers one question: **what is still missing, and what should be done
next.** It counts rather than storing progress flags, for two reasons:

* a flag can be wrong. Rows cannot: if there are 40 items, the item step is
  done, however it happened — typed in, imported from a spreadsheet, or read
  out of a PDF by the assistant.
* somebody who deletes everything is genuinely back at the start, and the
  guidance should come back with them.

The ORDER is not arbitrary. Items and suppliers first because everything
downstream — recipe costing, purchase orders, price comparison, waste — reads
from them, and doing them in the wrong order produces a recipe that cannot be
costed and an order that cannot be placed. Sales and staff can wait until the
kitchen data exists.
"""
from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.models import Employee
from app.expenses.models import Expense
from app.inventory.models import Item
from app.recipes.models import Recipe
from app.sales.models import DailySales
from app.vendors.models import Vendor


async def _count(db: AsyncSession, model, hotel_id: uuid.UUID) -> int:
    rows = await db.execute(
        select(func.count()).select_from(model).where(model.hotel_id == hotel_id)
    )
    return int(rows.scalar_one() or 0)


# Each step names the page that does it and the assistant import that can do it
# in bulk, because typing 200 stock items by hand is the reason an onboarding
# gets abandoned halfway.
STEPS: tuple[dict, ...] = (
    {
        "key": "items",
        "title": "Add what you keep in stock",
        "why": "Everything else reads from this — recipe costs, orders, waste, price comparison.",
        "href": "/inventory",
        "import_kind": "items",
        "model": Item,
    },
    {
        "key": "vendors",
        "title": "Add your suppliers and their prices",
        "why": "An item nobody prices cannot be ordered or costed.",
        "href": "/vendors",
        "import_kind": "vendors",
        "model": Vendor,
    },
    {
        "key": "recipes",
        "title": "Write up your dishes",
        "why": "This is where a plate's cost — and its real margin — comes from.",
        "href": "/recipes",
        "import_kind": "recipes",
        "model": Recipe,
    },
    {
        "key": "employees",
        "title": "Add your team",
        "why": "Needed before rota, attendance and payroll do anything.",
        "href": "/employees",
        "import_kind": "employees",
        "model": Employee,
    },
    {
        "key": "sales",
        "title": "Record a day's takings",
        "why": "Profit needs both halves. Without sales the P&L is only costs.",
        "href": "/sales",
        "import_kind": "sales",
        "model": DailySales,
    },
    {
        "key": "expenses",
        "title": "Log your standing bills",
        "why": "Rent, gas, insurance. Without them the profit figure flatters you.",
        "href": "/expenses",
        "import_kind": None,
        "model": Expense,
    },
)


async def status(db: AsyncSession, hotel_id: uuid.UUID) -> dict:
    """Which steps are done, and which one to do next.

    `next_key` is the first unfinished step in dependency order — the single
    most useful field here, because "you have six things to do" is paralysing
    and "do this one" is not.
    """
    steps = []
    for spec in STEPS:
        n = await _count(db, spec["model"], hotel_id)
        steps.append(
            {
                "key": spec["key"],
                "title": spec["title"],
                "why": spec["why"],
                "href": spec["href"],
                "import_kind": spec["import_kind"],
                "count": n,
                "done": n > 0,
            }
        )

    done = [s for s in steps if s["done"]]
    pending = [s for s in steps if not s["done"]]
    return {
        "steps": steps,
        "done_count": len(done),
        "total": len(steps),
        "complete": not pending,
        "next_key": pending[0]["key"] if pending else None,
        # A restaurant that has never entered anything at all gets a different
        # welcome from one that is halfway through.
        "fresh": not done,
    }
