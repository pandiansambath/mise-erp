"""Paying for stock that has already arrived — the only place a PO becomes paid.

    "receive stock into our stock but payment is still pending so that it wont
     added in expense ..but in PO it need to show like payment pending..even in
     that vendor page also it need to show payment pending ... once payment
     done then we can added in expense"

So arriving and being paid are two events. A pay-later order goes into stock
and onto the supplier's balance, and reaches Expenses — cost of sales — only on
the day it is paid. Every route to "paid" comes through `settle()`:

  * "Received & paid" on the receive popup        (service.receive_po, pay=now)
  * "Mark paid" on the order or the supplier page  (service.mark_paid)
  * one payment on the supplier page covering several waiting orders
                                                   (pay_vendor, oldest first)

and `settle()` refuses an order that is already PAID, while every caller holds
that order's row lock. That pair is what makes "a PO's expense is posted
exactly once, whichever path" true rather than hoped for.

Every settlement that moves money is also a VendorPayment, so what is owed
falls through the ledger that already existed (delivered − paid) instead of a
second bookkeeping of the same debt.

NO CREDIT IS CARRIED. Money that does not cover the next whole order is an
ordinary payment against the balance, exactly as before this existed. The app
cannot know which pound paid which delivery — least of all against balances
from before pay-later — and a carried credit could never be kept honest for the
cash drawer, which only learns about cash through dated CASH expenses.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezones import hotel_today, to_local
from app.expenses.models import Expense, ExpenseCategory
from app.hotels.prefs import pref
from app.purchasing.expense_link import post_for_po, received_values
from app.purchasing.models import POPaymentStatus, POStatus, PurchaseOrder
from app.vendors.models import VendorPayment

PAY_METHODS = ("CASH", "BANK", "CARD")
FUTURE_DATE = "A payment can't be dated in the future."
#: Purchases are not posted to Expenses (a hotel setting), so a cash payment
#: through an ORDER would leave the till without any trace in the drawer count.
CASH_NOT_POSTED = (
    "Purchases aren't posted to Expenses in your settings, so a cash payment here "
    "would never reach the till. Pay it on the supplier page and pick the expense "
    "category the cash comes out of — or pay by card or bank."
)
NOTHING_TO_PAY = (
    "Nothing has been received on this order, so there is nothing to pay yet. "
    "Enter what arrived, or receive it as pay later."
)


def before_arrival(received: date) -> str:
    return f"A payment can't be dated before the order arrived ({say_day(received)})."


ZERO = Decimal("0.00")
_Q2 = Decimal("0.01")


class PaidLocked(Exception):
    """Re-receiving an order that was settled by a real payment. → 409.

    Its expense is dated the day it was paid and a payment row says how much;
    changing what arrived now would leave both of them describing a delivery
    that no longer exists.
    """

    def __init__(self, po: PurchaseOrder):
        self.po = po
        super().__init__(
            f"This order was paid on {say_day(po.paid_on)} — its quantities are settled."
        )


class AlreadyPaid(Exception):
    """Settling an order that is already PAID. → 409."""

    def __init__(self, po: PurchaseOrder):
        self.po = po
        if po.paid_on is not None:
            msg = f"{po.po_number} was already paid on {say_day(po.paid_on)}."
        else:
            msg = (
                f"{po.po_number} went into Expenses when it arrived — "
                "there is nothing to pay off."
            )
        super().__init__(msg)


class NotReceived(Exception):
    """Paying for an order that has not arrived. → 409.

    An order on a lorry is not a debt; paying for it here would put food that
    may never come into cost of sales.
    """

    def __init__(self, po: PurchaseOrder):
        self.po = po
        super().__init__(f"{po.po_number} hasn't been received yet — receive it first.")


class BadPayment(ValueError):
    """A future date, an amount out of range, or the cash rule. → 422."""


def say_day(d: date | None) -> str:
    """"30 Oct 2026" — how a person says a date. (Not `%-d`: that is glibc-only.)"""
    return f"{d.day} {d:%b %Y}" if d else "an earlier day"


def money(v: Decimal) -> str:
    """Money as the dict endpoints send it: a string, to the penny."""
    return str(Decimal(v).quantize(_Q2))


# ── the one transition ──────────────────────────────────────────────────────
async def settle(
    db: AsyncSession,
    po: PurchaseOrder,
    hotel,
    *,
    on: date,
    method: str,
    payment: VendorPayment | None,
    created_by: uuid.UUID | None,
):
    """PENDING → PAID, and post the expense on the day it was paid.

    The caller holds the row lock and commits. `payment` must already be
    FLUSHED: its uuid default is applied at INSERT, so before a flush its id is
    None and the link would be stored as NULL without a word.
    """
    if po.payment_status == POPaymentStatus.PAID.value:
        raise AlreadyPaid(po)
    po.payment_status = POPaymentStatus.PAID.value
    po.paid_on = on
    po.paid_method = method
    po.payment_id = payment.id if payment is not None else None
    return await post_for_po(db, po, hotel, created_by=created_by, on=on, method=method)


# ── what is waiting ──────────────────────────────────────────────────────────
async def waiting_orders(
    db: AsyncSession,
    hotel_id: uuid.UUID,
    vendor_id: uuid.UUID,
    *,
    lock: bool = False,
) -> list[tuple[PurchaseOrder, Decimal]]:
    """This supplier's received-but-unpaid orders, oldest arrival first, with
    what each one is due.

    `lock=True` takes the row locks a payment needs, in the same order every
    time — so two payments to one supplier queue rather than deadlock, and a
    Mark paid racing a lump payment waits and then finds the order PAID.
    `populate_existing` because a locked read is worthless if the session
    hands back the copy it already had in memory.
    """
    q = (
        select(PurchaseOrder)
        .where(
            PurchaseOrder.hotel_id == hotel_id,
            PurchaseOrder.vendor_id == vendor_id,
            PurchaseOrder.status == POStatus.RECEIVED.value,
            PurchaseOrder.payment_status == POPaymentStatus.PENDING.value,
        )
        .order_by(PurchaseOrder.received_at.asc().nulls_last(), PurchaseOrder.po_number.asc())
    )
    if lock:
        q = q.with_for_update().execution_options(populate_existing=True)
    pos = list((await db.execute(q)).scalars().all())
    dues = await received_values(db, [p.id for p in pos])
    return [(p, dues.get(p.id, ZERO)) for p in pos]


# ── which orders a payment pays off ──────────────────────────────────────────
@dataclass
class Plan:
    settles: list[dict] = field(default_factory=list)
    settled_total: Decimal = ZERO
    leftover: Decimal = ZERO
    still_waiting: int = 0
    next_waiting: dict | None = None
    refusal: str | None = None
    clear_amounts: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "settles": self.settles,
            "settled_total": money(self.settled_total),
            "leftover": money(self.leftover),
            "still_waiting": self.still_waiting,
            "next_waiting": self.next_waiting,
            "refusal": self.refusal,
            "clear_amounts": self.clear_amounts,
        }


def plan_settlement(
    waiting: list[tuple[uuid.UUID, str, date | None, Decimal]],
    amount: Decimal,
    method: str,
) -> Plan:
    """Oldest first, WHOLE orders only, and stop at the first that won't fit.

    Pure — no database — so the preview and the real payment are the same sum.

    It never skips ahead to a smaller, newer order: paying the oldest debt
    first is how a supplier reads their own statement, and an order that jumps
    the queue because it happens to fit would leave an older one looking
    forgotten. Whatever is left over is an ordinary payment against the
    balance.

    CASH is stricter. Cash leaves the till on the day it is paid, and the till
    only knows about it through one dated CASH expense per order — so a cash
    payment that would part-pay an order is refused, with the amounts that
    clear whole orders offered instead.
    """
    used = ZERO
    settles: list[dict] = []
    for po_id, number, received_on, due in waiting:
        if used + due > amount:
            break
        used += due
        settles.append(
            {
                "po_id": str(po_id),
                "po_number": number,
                "received_on": received_on.isoformat() if received_on else None,
                "amount": money(due),
            }
        )

    leftover = amount - used
    still = len(waiting) - len(settles)
    nxt = waiting[len(settles)] if still else None
    next_waiting = {"po_number": nxt[1], "amount_due": money(nxt[3])} if nxt else None

    refusal = None
    if method == "CASH" and leftover > 0 and nxt is not None:
        refusal = (
            "Cash leaves the till on the day it's paid, so a cash payment has to pay off "
            f"whole orders. £{money(leftover)} would be left part-paying {nxt[1]} "
            f"(£{money(nxt[3])})."
        )

    running = ZERO
    clear: list[dict] = []
    for _id, number, _on, due in waiting:
        running += due
        clear.append({"through": number, "amount": money(running)})

    return Plan(
        settles=settles,
        settled_total=used,
        leftover=leftover,
        still_waiting=still,
        next_waiting=next_waiting,
        refusal=refusal,
        clear_amounts=clear,
    )


class CategoryNotFound(LookupError):
    """The "book the cash as" category is not this hotel's. → 404."""


async def pay_vendor(
    db: AsyncSession,
    hotel,
    vendor,
    *,
    on: date,
    amount: Decimal,
    method: str,
    reference: str | None,
    note: str | None,
    category_id: uuid.UUID | None,
    created_by: uuid.UUID | None,
    dry_run: bool,
) -> dict:
    """Money paid to a supplier, settling their waiting orders oldest first.

    `dry_run` is the preview: the same plan, nothing written, no locks taken.
    """
    amount = Decimal(amount).quantize(_Q2)
    # Settling an order posts its cost on this date, so a future date would put
    # food into a month that has not happened yet.
    future = on > hotel_today(hotel)
    if future and not dry_run:
        raise BadPayment(FUTURE_DATE)

    waiting = await waiting_orders(db, hotel.id, vendor.id, lock=not dry_run)
    # Only orders that had ARRIVED by the payment's date: paying on 15 Oct
    # cannot settle a delivery of 28 Oct, or October's P&L gains food that
    # came later — and a cash one would rewrite a till day already counted.
    waiting = [(po, due) for po, due in waiting if (_received_on(po, hotel) or on) <= on]
    posting = pref(hotel, "post_purchases_to_expenses")
    plan = plan_settlement(
        [
            (po.id, po.po_number, _received_on(po, hotel), due)
            for po, due in waiting
        ],
        amount,
        method,
    )
    if dry_run:
        out = plan.as_dict()
        if future:
            out["refusal"] = FUTURE_DATE
        # The page needs this to keep the category picker on screen: with
        # posting OFF, a cash payment's whole amount is booked to it.
        out["posting"] = bool(posting)
        return out
    if plan.refusal:
        raise BadPayment(plan.refusal)

    # The old "book the cash as" expense survives only for the LEFT-OVER part
    # of a cash payment — which, given the cash rule, can only exist once no
    # order is waiting. The orders it settled carry their own CASH expenses;
    # booking the whole payment again here would count it twice, in the P&L
    # and in the till.
    book_leftover = method == "CASH" and category_id is not None and plan.leftover > 0
    # POSTING OFF: no order gets an expense, so the cash must be booked IN FULL
    # to the category he picks — exactly what this page did before pay-later.
    # Without it the till never hears the cash left (found by review, §70).
    book_all = method == "CASH" and not posting
    if book_all and category_id is None:
        raise BadPayment(
            "Purchases aren't posted to Expenses in your settings, so pick the expense "
            "category this cash comes out of — that is how the till learns it left."
        )
    if book_leftover or book_all:
        cat = await db.get(ExpenseCategory, category_id)
        if cat is None or cat.hotel_id != hotel.id:
            raise CategoryNotFound("Expense category not found")

    payment = VendorPayment(
        hotel_id=hotel.id,
        vendor_id=vendor.id,
        date=on,
        amount=amount,
        method=method,
        reference=reference,
        note=note,
        created_by=created_by,
    )
    db.add(payment)
    await db.flush()  # settle() needs payment.id, which exists only after INSERT

    for po, _due in waiting[: len(plan.settles)]:
        await settle(db, po, hotel, on=on, method=method, payment=payment, created_by=created_by)

    if book_leftover or book_all:
        db.add(
            Expense(
                hotel_id=hotel.id,
                category_id=category_id,
                date=on,
                amount=amount if book_all else plan.leftover,
                payment_method="CASH",
                description=f"Paid {vendor.name}" + (f" ({reference})" if reference else ""),
                created_by=created_by,
            )
        )

    await db.commit()
    return {
        "id": str(payment.id),
        "settled": plan.settles,
        "leftover": money(plan.leftover),
        "still_waiting": plan.still_waiting,
    }


def _received_on(po: PurchaseOrder, hotel) -> date | None:
    """The restaurant's calendar day the order arrived, not UTC's."""
    local = to_local(po.received_at, hotel)
    return local.date() if local else None
