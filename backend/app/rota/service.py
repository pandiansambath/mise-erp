"""Rota service: shifts, scheduled hours, forecast labour cost + labour % of sales."""
import uuid
from datetime import date as date_type
from datetime import time
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.models import Employee
from app.rota.models import Shift
from app.sales import service as sales_service

_Q2 = Decimal("0.01")
_MONTHLY_HOURS = Decimal("173")  # UK avg (~37.5h/wk) — salaried→hourly estimate


def shift_hours(start: time, end: time, break_minutes: int = 0) -> Decimal:
    s = Decimal(start.hour) + Decimal(start.minute) / 60
    e = Decimal(end.hour) + Decimal(end.minute) / 60
    if e <= s:
        e += 24  # overnight shift
    net = (e - s) - Decimal(break_minutes or 0) / 60  # paid hours exclude the unpaid break
    if net < 0:
        net = Decimal("0")
    return net.quantize(_Q2)


def hourly_rate(emp: Employee) -> Decimal:
    if emp.hourly_rate:
        return emp.hourly_rate
    if emp.monthly_salary:
        return (emp.monthly_salary / _MONTHLY_HOURS).quantize(_Q2)
    return Decimal("0")


async def _employees(db: AsyncSession, hotel_id: uuid.UUID) -> dict[uuid.UUID, Employee]:
    rows = await db.execute(select(Employee).where(Employee.hotel_id == hotel_id))
    return {e.id: e for e in rows.scalars()}


async def create_shift(db: AsyncSession, hotel_id: uuid.UUID, **fields) -> Shift:
    sh = Shift(hotel_id=hotel_id, **fields)
    db.add(sh)
    await db.commit()
    await db.refresh(sh)
    return sh


async def get_shift(db: AsyncSession, shift_id: uuid.UUID, hotel_id: uuid.UUID) -> Shift | None:
    sh = await db.get(Shift, shift_id)
    return sh if sh is not None and sh.hotel_id == hotel_id else None


async def delete_shift(db: AsyncSession, sh: Shift) -> None:
    await db.delete(sh)
    await db.commit()


async def list_shifts(
    db: AsyncSession, hotel_id: uuid.UUID, date_from: date_type, date_to: date_type
) -> list[dict]:
    emps = await _employees(db, hotel_id)
    rows = await db.execute(
        select(Shift)
        .where(Shift.hotel_id == hotel_id, Shift.date >= date_from, Shift.date <= date_to)
        .order_by(Shift.date, Shift.start_time)
    )
    out: list[dict] = []
    for sh in rows.scalars():
        emp = emps.get(sh.employee_id)
        h = shift_hours(sh.start_time, sh.end_time, sh.break_minutes)
        rate = hourly_rate(emp) if emp else Decimal("0")
        out.append(
            {
                "id": sh.id,
                "employee_id": sh.employee_id,
                "employee_name": emp.full_name if emp else "(removed)",
                "date": sh.date,
                "start_time": sh.start_time,
                "end_time": sh.end_time,
                "break_minutes": sh.break_minutes,
                "hours": h,
                "cost": (h * rate).quantize(_Q2),
                "notes": sh.notes,
            }
        )
    return out


async def labour_summary(
    db: AsyncSession, hotel_id: uuid.UUID, date_from: date_type, date_to: date_type
) -> dict:
    shifts = await list_shifts(db, hotel_id, date_from, date_to)
    by: dict[uuid.UUID, dict] = {}
    total_h = Decimal("0")
    total_c = Decimal("0")
    for s in shifts:
        total_h += s["hours"]
        total_c += s["cost"]
        slot = by.setdefault(
            s["employee_id"],
            {
                "employee_id": s["employee_id"],
                "employee_name": s["employee_name"],
                "hours": Decimal("0"),
                "cost": Decimal("0"),
            },
        )
        slot["hours"] += s["hours"]
        slot["cost"] += s["cost"]
    sales = await sales_service.range_summary(db, hotel_id, date_from, date_to)
    net = sales["net"]
    pct = (total_c / net * 100).quantize(_Q2) if net > 0 else Decimal("0.00")
    return {
        "date_from": date_from,
        "date_to": date_to,
        "total_hours": total_h.quantize(_Q2),
        "total_cost": total_c.quantize(_Q2),
        "net_sales": net,
        "labour_pct": pct,
        "by_employee": sorted(by.values(), key=lambda x: x["cost"], reverse=True),
    }
