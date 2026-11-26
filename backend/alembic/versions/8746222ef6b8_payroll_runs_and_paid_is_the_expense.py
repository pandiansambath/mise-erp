"""payroll runs, day lines, and a wage is an expense only once it is paid

    "When i give approve.. it appearing in expenses... why.... still we didn't
     click mark as paid button.. then what's the use of mark as paid button."

Approving a payslip used to write the wage into Expenses. From here only paying
it does, so the rows that are already there have to be put right:

  PAID payslips      nothing moves. Their expense is linked to them
                     (`expenses.payroll_id`) and the day and the method of that
                     expense become the day and the method of the payment.

  APPROVED, unpaid   their expense is MOVED, whole, into `payroll_parked_wages`.
                     Moved and not deleted, because some of these people were
                     paid and nobody pressed the button: the Payroll page says
                     so and offers to put each one back, on its own day, by its
                     own method, in one press. Until then the wage is not in
                     Expenses, which is what "not marked paid" now means.

  rows whose payslip is gone   left exactly as they are. Money that went out
                     stays in the books whatever happened to its payslip.

Every existing payslip is put in a run, one for each period a restaurant has
run, so the page can list them the same way as the new ones. They keep no day
lines: they cover the whole of their dates, which is how they always counted.

⚠️ NOTHING HERE MAY FAIL ON LIVE DATA. The unique index is on a new column that
only this migration fills, one expense per payslip; a second expense for the
same payslip (there should be none) simply stays unlinked. `payroll_id` is
matched as TEXT, so a description with a broken marker in it is skipped and not
cast.

Revision ID: 8746222ef6b8
Revises: 8fe5478fb0e8
"""
import re
import uuid
from datetime import date, timedelta

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op
from app.core.ai_views import create_statements

revision: str = "8746222ef6b8"
down_revision: str | None = "8fe5478fb0e8"
branch_labels = None
depends_on = None

# `SELECT *` is expanded once, when a view is made: these two have new columns.
_VIEWS = ("ai_payroll", "ai_expenses")

_MARKER = r"\[payroll:([0-9a-fA-F-]{36})\]"
_WEEK = re.compile(r"^(\d{4})-W(\d{2})$")
_MONTH = re.compile(r"^(\d{4})-(\d{2})$")
_CUSTOM = re.compile(r"^(\d{4}-\d{2}-\d{2})→(\d{4}-\d{2}-\d{2})$")


def _drop_views() -> None:
    for v in _VIEWS:
        op.execute(f"DROP VIEW IF EXISTS {v}")


def _make_views() -> None:
    for v in _VIEWS:
        op.execute(next(s for s in create_statements() if f" VIEW {v} AS " in s))


def _range_of(label: str, fallback: date) -> tuple[date, date]:
    """The dates a label means. A label nobody can read covers the day it was run."""
    try:
        if m := _WEEK.match(label):
            start = date.fromisocalendar(int(m[1]), int(m[2]), 1)
            return start, start + timedelta(days=6)
        if m := _MONTH.match(label):
            y, mo = int(m[1]), int(m[2])
            return date(y, mo, 1), date(y + (mo == 12), mo % 12 + 1, 1) - timedelta(days=1)
        if m := _CUSTOM.match(label):
            return date.fromisoformat(m[1]), date.fromisoformat(m[2])
    except ValueError:
        pass
    return fallback, fallback


def upgrade() -> None:
    op.create_table(
        "payroll_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("setup", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("hotel_id", "number", name="uq_payroll_run_number"),
    )
    op.create_index("ix_payroll_runs_hotel_id", "payroll_runs", ["hotel_id"])

    op.add_column(
        "payroll",
        sa.Column(
            "run_id", sa.Uuid(), sa.ForeignKey("payroll_runs.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("ix_payroll_run_id", "payroll", ["run_id"])
    op.add_column(
        "payroll",
        sa.Column("basis", sa.String(12), nullable=False, server_default="ATTENDANCE"),
    )
    op.add_column("payroll", sa.Column("pay_type", sa.String(10), nullable=True))
    op.add_column("payroll", sa.Column("rate", sa.Numeric(12, 2), nullable=True))
    op.add_column(
        "payroll", sa.Column("minutes", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column(
        "payroll",
        sa.Column("day_lines", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "payroll", sa.Column("additions", sa.Numeric(12, 2), nullable=False, server_default="0")
    )
    op.add_column(
        "payroll", sa.Column("held", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column("payroll", sa.Column("note", sa.Text(), nullable=True))
    op.add_column(
        "payroll", sa.Column("approved_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True)
    )
    op.add_column(
        "payroll", sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("payroll", sa.Column("paid_on", sa.Date(), nullable=True))
    op.add_column("payroll", sa.Column("paid_method", sa.String(20), nullable=True))
    op.add_column("payroll", sa.Column("paid_reference", sa.String(120), nullable=True))
    op.add_column(
        "payroll", sa.Column("paid_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True)
    )
    op.add_column("payroll", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("payroll", sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "payroll_days",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column(
            "payroll_id", sa.Uuid(), sa.ForeignKey("payroll.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "employee_id", sa.Uuid(), sa.ForeignKey("employees.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("minutes", sa.Integer(), nullable=False),
        sa.Column("half_days", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("typed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("again", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("payroll_id", "date", name="uq_payroll_day"),
    )
    op.create_index("ix_payroll_days_hotel_id", "payroll_days", ["hotel_id"])
    op.create_index("ix_payroll_days_payroll_id", "payroll_days", ["payroll_id"])
    op.create_index("ix_payroll_days_emp_date", "payroll_days", ["employee_id", "date"])

    op.create_table(
        "payroll_adjustments",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column(
            "payroll_id", sa.Uuid(), sa.ForeignKey("payroll.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("label", sa.String(80), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
    )
    op.create_index("ix_payroll_adjustments_hotel_id", "payroll_adjustments", ["hotel_id"])
    op.create_index("ix_payroll_adjustments_payroll_id", "payroll_adjustments", ["payroll_id"])

    op.create_table(
        "payroll_advance_recoveries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column(
            "payroll_id", sa.Uuid(), sa.ForeignKey("payroll.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "advance_id", sa.Uuid(), sa.ForeignKey("salary_advances.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
    )
    for col in ("hotel_id", "payroll_id", "advance_id"):
        op.create_index(
            f"ix_payroll_advance_recoveries_{col}", "payroll_advance_recoveries", [col]
        )

    op.create_table(
        "payroll_parked_wages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("hotel_id", sa.Uuid(), sa.ForeignKey("hotels.id"), nullable=False),
        sa.Column(
            "payroll_id", sa.Uuid(), sa.ForeignKey("payroll.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "category_id", sa.Uuid(),
            sa.ForeignKey("expense_categories.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("payment_method", sa.String(20), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    for col in ("hotel_id", "payroll_id"):
        op.create_index(f"ix_payroll_parked_wages_{col}", "payroll_parked_wages", [col])

    op.add_column(
        "expenses",
        sa.Column(
            "payroll_id", sa.Uuid(), sa.ForeignKey("payroll.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    _backfill()

    op.create_index("ix_expenses_payroll_id", "expenses", ["payroll_id"], unique=True)

    op.drop_constraint("uq_payroll_emp_period", "payroll", type_="unique")
    op.create_index("ix_payroll_emp_period", "payroll", ["employee_id", "pay_period"])
    op.create_unique_constraint(
        "uq_payroll_run_employee", "payroll", ["run_id", "employee_id"]
    )

    _drop_views()
    _make_views()


def _backfill() -> None:
    bind = op.get_bind()

    # ── one run for each period a restaurant has run ────────────────────────
    groups = bind.execute(
        sa.text(
            """
            SELECT hotel_id, pay_period, min(period_start) AS ps, max(period_end) AS pe,
                   min(created_at) AS made, (array_agg(processed_by))[1] AS by_user
              FROM payroll
             GROUP BY hotel_id, pay_period
             ORDER BY hotel_id, min(created_at), pay_period
            """
        )
    ).all()
    number: dict = {}
    for g in groups:
        made = g.made.date() if g.made is not None else date.today()
        start, end = _range_of(g.pay_period, made)
        if g.ps is not None and g.pe is not None:
            start, end = g.ps, g.pe
        number[g.hotel_id] = number.get(g.hotel_id, 0) + 1
        run_id = uuid.uuid4()
        bind.execute(
            sa.text(
                """
                INSERT INTO payroll_runs
                    (id, hotel_id, number, period_start, period_end, setup, created_by, created_at)
                VALUES
                    (:id, :hotel, :number, :start, :end,
                     jsonb_build_object('label', CAST(:label AS text)),
                     :by_user, coalesce(:made, now()))
                """
            ).bindparams(
                sa.bindparam("id", type_=sa.Uuid()),
                sa.bindparam("hotel", type_=sa.Uuid()),
                sa.bindparam("by_user", type_=sa.Uuid()),
                sa.bindparam("start", type_=sa.Date()),
                sa.bindparam("end", type_=sa.Date()),
                sa.bindparam("made", type_=sa.DateTime(timezone=True)),
            ),
            {
                "id": run_id, "hotel": g.hotel_id, "number": number[g.hotel_id],
                "start": start, "end": end, "label": g.pay_period,
                "by_user": g.by_user, "made": g.made,
            },
        )
        bind.execute(
            sa.text(
                "UPDATE payroll SET run_id = :run WHERE hotel_id = :hotel AND pay_period = :label"
            ).bindparams(
                sa.bindparam("run", type_=sa.Uuid()), sa.bindparam("hotel", type_=sa.Uuid())
            ),
            {"run": run_id, "hotel": g.hotel_id, "label": g.pay_period},
        )

    op.execute("UPDATE payroll SET minutes = round(total_hours * 60)::int")

    # ── which expense is which payslip's ────────────────────────────────────
    # One each: the oldest, should there ever be two.
    op.execute(
        f"""
        UPDATE expenses e
           SET payroll_id = m.payroll_id
          FROM (
                SELECT DISTINCT ON (p.id) x.id AS expense_id, p.id AS payroll_id
                  FROM expenses x
                  JOIN payroll p
                    ON p.hotel_id = x.hotel_id
                   AND p.id::text = lower(substring(x.description from '{_MARKER}'))
                 WHERE x.description LIKE '%[payroll:%'
                 ORDER BY p.id, x.created_at, x.id
               ) m
         WHERE e.id = m.expense_id
        """
    )

    # ── paid: the payment is what the expense says ──────────────────────────
    op.execute(
        """
        UPDATE payroll p
           SET paid_on = e.date, paid_method = e.payment_method, paid_at = e.created_at
          FROM expenses e
         WHERE e.payroll_id = p.id AND p.status = 'PAID'
        """
    )
    op.execute(
        """
        UPDATE payroll
           SET paid_on = coalesce(processed_at, created_at)::date
         WHERE status = 'PAID' AND paid_on IS NULL
        """
    )

    # ── approved and never paid: out of Expenses, into the drawer beside it ─
    op.execute(
        f"""
        INSERT INTO payroll_parked_wages
            (id, hotel_id, payroll_id, category_id, date, amount, payment_method,
             description, created_at)
        SELECT e.id, e.hotel_id, p.id, e.category_id, e.date, e.amount, e.payment_method,
               e.description, e.created_at
          FROM expenses e
          JOIN payroll p
            ON p.hotel_id = e.hotel_id
           AND p.id::text = lower(substring(e.description from '{_MARKER}'))
         WHERE e.description LIKE '%[payroll:%'
           AND p.status <> 'PAID'
        """
    )
    # Nothing should point at one of these. Should something, it must not be the
    # reason a deploy fails.
    op.execute(
        "UPDATE expenses SET recurred_from = NULL "
        "WHERE recurred_from IN (SELECT id FROM payroll_parked_wages)"
    )
    op.execute(
        "UPDATE petty_cash SET expense_id = NULL "
        "WHERE expense_id IN (SELECT id FROM payroll_parked_wages)"
    )
    op.execute("DELETE FROM expenses WHERE id IN (SELECT id FROM payroll_parked_wages)")


def downgrade() -> None:
    _drop_views()

    # Back to one payslip per person per label. Two runs of the same dates were
    # impossible before this, so a later one is told apart by its run's number.
    op.execute(
        """
        UPDATE payroll p
           SET pay_period = left(p.pay_period, 23) || '#' || r.number
          FROM payroll_runs r
         WHERE r.id = p.run_id
           AND EXISTS (SELECT 1 FROM payroll q
                        WHERE q.employee_id = p.employee_id
                          AND q.pay_period = p.pay_period
                          AND (q.created_at, q.id) < (p.created_at, p.id))
        """
    )
    op.drop_constraint("uq_payroll_run_employee", "payroll", type_="unique")
    op.drop_index("ix_payroll_emp_period", table_name="payroll")
    op.create_unique_constraint(
        "uq_payroll_emp_period", "payroll", ["employee_id", "pay_period"]
    )

    # What was parked goes back where it was.
    op.execute(
        """
        INSERT INTO expenses
            (id, hotel_id, category_id, date, amount, vat_amount, description,
             payment_method, is_recurring, created_at)
        SELECT w.id, w.hotel_id, w.category_id, w.date, w.amount, 0, w.description,
               w.payment_method, false, coalesce(w.created_at, now())
          FROM payroll_parked_wages w
         WHERE w.category_id IS NOT NULL
        """
    )

    op.drop_index("ix_expenses_payroll_id", table_name="expenses")
    op.drop_column("expenses", "payroll_id")
    op.drop_table("payroll_parked_wages")
    op.drop_table("payroll_advance_recoveries")
    op.drop_table("payroll_adjustments")
    op.drop_table("payroll_days")
    op.drop_index("ix_payroll_run_id", table_name="payroll")
    for col in (
        "emailed_at", "paid_at", "paid_by", "paid_reference", "paid_method", "paid_on",
        "approved_at", "approved_by", "note", "held", "additions", "day_lines", "minutes",
        "rate", "pay_type", "basis", "run_id",
    ):
        op.drop_column("payroll", col)
    op.drop_index("ix_payroll_runs_hotel_id", table_name="payroll_runs")
    op.drop_table("payroll_runs")

    _make_views()
