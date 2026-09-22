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
from app.inventory.models import Item
from app.recipes.models import Recipe
from app.vendors.models import Vendor


async def _count(db: AsyncSession, model, hotel_id: uuid.UUID) -> int:
    rows = await db.execute(
        select(func.count()).select_from(model).where(model.hotel_id == hotel_id)
    )
    return int(rows.scalar_one() or 0)


# Each step names the page that does it and the assistant import that can do it
# in bulk, because typing 200 stock items by hand is the reason an onboarding
# gets abandoned halfway.
#: THE FIVE, IN HIS ORDER — and the order is the dependency order, not a
#: preference. A stock row names its supplier, so doing stock first
#: guarantees every one of those names has nothing to match against. That is
#: the whole reason step 2 can show "Rice -> Local Supplier" at all.
#:
#: Sales and expenses used to be steps six and seven. They are not setup; they
#: are what you do every day once you are set up, and putting them here made
#: the list a wall. They keep their own prompts on the dashboard.
STEPS = [
    {
        "key": "vendors",
        "title": "Who you buy from",
        "why": "Everything else hangs off this — prices, stock, what a dish costs.",
        "href": "/vendors",
        "list": "vendors",
        "model": Vendor,
        "noun": "suppliers",
    },
    {
        "key": "items",
        "title": "What you keep in stock",
        "why": "Recipes cannot be costed until this has something in it.",
        "href": "/inventory",
        "list": "inventory",
        "model": Item,
        "noun": "items",
        #: Step 2 matches each item's supplier column against step 1's names.
        "matches": "vendors",
    },
    {
        "key": "employees",
        "title": "Your team",
        "why": "Rota, attendance and payroll wait on this.",
        "href": "/employees",
        "list": "employees",
        "model": Employee,
        "noun": "people",
    },
    {
        "key": "recipes",
        "title": "Your menu",
        "why": "No margins until there are dishes.",
        "href": "/recipes",
        "list": "recipes",
        "model": Recipe,
        "noun": "dishes",
    },
    {
        "key": "recipe_lines",
        "title": "What goes into each dish",
        "why": "This is the one that turns a menu into a profit number.",
        "href": "/recipes",
        #: ⚠️ NO `list` YET. The ingredient-lines importer is not built, so
        #: this step is reachable and honest about being hand-entry only.
        #: A stepper that says "of 5" while one of them silently does nothing
        #: is worse than four steps.
        "list": None,
        "model": Recipe,
        "noun": "dishes costed",
        "lines_only": True,
    },
]

#: Where the decisions live. Counted progress never goes here — only what a
#: person chose, which cannot be recomputed from the data.
PREFS_KEY = "onboarding"


async def status(db: AsyncSession, hotel_id: uuid.UUID) -> dict:
    """Which steps are done, and which one to do next.

    `next_key` is the first unfinished step in dependency order — the single
    most useful field here, because "you have six things to do" is paralysing
    and "do this one" is not.
    """
    saved = await _saved(db, hotel_id)
    skipped = set(saved.get("skipped") or [])

    steps = []
    for spec in STEPS:
        n = await _count(db, spec["model"], hotel_id)
        if spec.get("lines_only"):
            # "Done" here is not a row count. A menu of forty dishes with no
            # ingredients costs nothing and tells him nothing, so the step is
            # finished when at least one dish actually has lines.
            n = await _costed_dishes(db, hotel_id)
        steps.append(
            {
                "key": spec["key"],
                "title": spec["title"],
                "why": spec["why"],
                "href": spec["href"],
                "list": spec.get("list"),
                "matches": spec.get("matches"),
                "noun": spec["noun"],
                "count": n,
                "done": n > 0,
                "skipped": spec["key"] in skipped,
            }
        )

    done = [s for s in steps if s["done"]]
    # A SKIPPED STEP IS NOT PENDING. He said skip; continuing to offer it as
    # "do this next" is not helpfulness, it is not listening.
    pending = [s for s in steps if not s["done"] and not s["skipped"]]
    return {
        "steps": steps,
        "done_count": len(done),
        "total": len(steps),
        "complete": not pending,
        "next_key": pending[0]["key"] if pending else None,
        "current_step": saved.get("current_step") or (pending[0]["key"] if pending else None),
        "skipped": sorted(skipped),
        "dismissed": bool(saved.get("dismissed")),
        "snoozed_until": saved.get("snoozed_until"),
        "drafts": saved.get("drafts") or {},
        # A restaurant that has never entered anything at all gets a different
        # welcome from one that is halfway through.
        "fresh": not done,
    }


async def needs_setup(db: AsyncSession, hotel_id: uuid.UUID) -> bool:
    """Is this restaurant completely empty? Cheap enough to run on every login.

    Sign-in reads this to choose between the dashboard and setup, replacing a
    900ms timer on the verify-email page that was the ONLY route to onboarding
    — so a new owner never once saw it.

    TRUE only while all four are empty. Not "any": a restaurant that has
    entered one supplier has found its way, and being redirected off the
    dashboard at every sign-in is nagging rather than helpful.

    SHORT-CIRCUITS, and that is the whole reason this is not `status()`. Almost
    every login is an established restaurant, so the first `EXISTS` returns
    immediately and the other three never run. `status()` counts every row of
    six tables to build a progress screen; asking that question on the sign-in
    path would put six aggregates in front of every person opening the app.

    Counted, never stored. A hotel that is genuinely emptied — after the
    delete-everything feature, say — gets its guidance back automatically,
    which a stored flag would not do.
    """
    for model in (Item, Vendor, Recipe, Employee):
        found = await db.scalar(
            select(func.count()).select_from(model).where(model.hotel_id == hotel_id).limit(1)
        )
        if found:
            return False
    return True


async def _saved(db: AsyncSession, hotel_id: uuid.UUID) -> dict:
    """The decisions he has made, from `hotels.prefs`.

    NOT localStorage. The clock preference had to be moved out of it for
    exactly this reason — "both are same superadmin but 1 is from incognito" —
    and onboarding is worse, because he starts on a laptop and carries on with
    a phone in the kitchen.
    """
    from app.hotels.models import Hotel

    hotel = await db.get(Hotel, hotel_id)
    prefs = (getattr(hotel, "prefs", None) or {}) if hotel else {}
    got = prefs.get(PREFS_KEY)
    return got if isinstance(got, dict) else {}


async def remember(db: AsyncSession, hotel_id: uuid.UUID, **changes) -> dict:
    """Merge a decision into `hotels.prefs`, leaving the rest alone."""
    from sqlalchemy.orm.attributes import flag_modified

    from app.hotels.models import Hotel

    hotel = await db.get(Hotel, hotel_id)
    if hotel is None:
        return {}
    prefs = dict(getattr(hotel, "prefs", None) or {})
    block = dict(prefs.get(PREFS_KEY) or {})
    block.update({k: v for k, v in changes.items() if v is not None})
    prefs[PREFS_KEY] = block
    hotel.prefs = prefs
    # A JSON column mutated in place is not seen as dirty by SQLAlchemy, and
    # the write silently does nothing. Assigning a NEW dict above mostly
    # covers it; this makes it certain.
    flag_modified(hotel, "prefs")
    await db.commit()
    return block


async def _costed_dishes(db: AsyncSession, hotel_id: uuid.UUID) -> int:
    """Dishes that actually have ingredient lines.

    The last step is about cost, and a dish with no lines costs nothing. A
    plain count of `recipes` would mark it done the moment the menu imported,
    which is the point at which he has the LEAST idea what anything costs.
    """
    from app.recipes.models import Recipe as R
    from app.recipes.models import RecipeIngredient as RI

    return int(
        await db.scalar(
            select(func.count(func.distinct(RI.recipe_id)))
            .select_from(RI)
            .join(R, R.id == RI.recipe_id)
            .where(R.hotel_id == hotel_id)
        )
        or 0
    )
