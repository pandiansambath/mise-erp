"""Leave, and the two places it must be obeyed.

Recording time off is the easy half. The half that matters is that the rota and
the attendance sheet know about it, because a leave record nobody consults is
just a note.

So this module answers three questions, and the callers are as important as the
answers:

* **Who is off on this day?** — the rota asks before scheduling, and the
  attendance page asks before calling somebody absent.
* **Does this new leave clash with a shift already rota'd?** — asked when leave
  is booked, so the conflict surfaces while it can still be fixed cheaply.
* **Does this new shift clash with approved leave?** — asked when a shift is
  added, and this is the one the owner described: refuse, and say why, rather
  than let the rota quietly promise a person who will not be there.

Only APPROVED leave blocks anything. A request that has not been agreed is not
yet a fact about the world, and treating it as one would let anybody remove
themselves from the rota by asking.
"""
from __future__ import annotations

import uuid
from datetime import date as date_type

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.models import Employee, Leave, LeaveStatus
from app.rota.models import Shift


async def on_day(db: AsyncSession, hotel_id: uuid.UUID, day: date_type) -> list[Leave]:
    """Every approved leave covering this day."""
    rows = await db.execute(
        select(Leave).where(
            Leave.hotel_id == hotel_id,
            Leave.status == LeaveStatus.APPROVED.value,
            Leave.start_date <= day,
            Leave.end_date >= day,
        )
    )
    return list(rows.scalars())


async def employee_ids_off(
    db: AsyncSession, hotel_id: uuid.UUID, day: date_type
) -> set[uuid.UUID]:
    """Just the ids — what the rota and attendance views actually need."""
    return {leave.employee_id for leave in await on_day(db, hotel_id, day)}


async def is_off(
    db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID, day: date_type
) -> Leave | None:
    """The leave covering this person on this day, if any."""
    rows = await db.execute(
        select(Leave).where(
            Leave.hotel_id == hotel_id,
            Leave.employee_id == employee_id,
            Leave.status == LeaveStatus.APPROVED.value,
            Leave.start_date <= day,
            Leave.end_date >= day,
        )
    )
    return rows.scalars().first()


async def shifts_clashing(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    employee_id: uuid.UUID,
    start: date_type,
    end: date_type,
) -> list[Shift]:
    """Shifts already rota'd inside a leave range.

    Booking leave over an existing shift is legitimate — plans change — so this
    warns rather than refuses. Silently leaving the shift there is what must not
    happen: the rota would still show someone who is on holiday.
    """
    rows = await db.execute(
        select(Shift).where(
            Shift.hotel_id == hotel_id,
            Shift.employee_id == employee_id,
            Shift.date >= start,
            Shift.date <= end,
        )
    )
    return list(rows.scalars())


async def blocking_leave(
    db: AsyncSession, hotel_id: uuid.UUID, employee_id: uuid.UUID, day: date_type
) -> tuple[Leave, str] | None:
    """Is this person on approved leave on this day? Returns the leave and a
    message meant to be shown to whoever is building the rota.

    The message names the person and the dates, because "on leave" alone sends
    someone hunting through the leave list to find out until when.
    """
    leave = await is_off(db, hotel_id, employee_id, day)
    if leave is None:
        return None
    employee = await db.get(Employee, employee_id)
    who = employee.full_name if employee else "That person"
    same_day = leave.start_date == leave.end_date
    when = (
        leave.start_date.isoformat()
        if same_day
        else f"{leave.start_date.isoformat()} to {leave.end_date.isoformat()}"
    )
    return leave, (
        f"{who} is on approved {leave.kind.lower()} leave ({when}). "
        "Cancel the leave first if this shift really needs to go ahead."
    )
