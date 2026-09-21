"""The exportable lists, declared once each.

Every list a restaurant would want to carry to a new account lives here, and
each is a single declaration that produces its CSV, its XLSX and its import
template. There is deliberately no second place to keep in step — that is the
whole reason the inventory round trip broke.

    "so i exported the invebtory, likweise i need vebdor but here export
     feature is missing..exployee here also export fteayre not there... like
     this so many export featrue not available issue even in menu recipe"

He was moving a restaurant to a new account and found the door only opened one
way, and only for one list.
"""

from __future__ import annotations

from app.core.roundtrip import Field, ListSpec, yes_no_back

# ── vendors ───────────────────────────────────────────────────────────────
#
# Name is the only required field. A supplier with nothing but a name is a real
# thing a restaurant has — the phone number is on somebody's wall — and refusing
# the row would lose it entirely. Everything else fills in later.

VENDORS = ListSpec(
    name="Vendors",
    title="DineAI — Vendors",
    subtitle="One row per supplier. Name is required; everything else is optional.",
    fields=[
        Field("name", "Name", required=True, aliases=("vendor", "supplier", "company"), width=30),
        Field("category", "Category", aliases=("type", "group"), width=18),
        Field("contact_person", "Contact", aliases=("contact person", "person"), width=22),
        Field(
            "mobile", "Phone",
            aliases=("mobile", "telephone", "tel", "contact number"), width=18,
        ),
        Field("email", "Email", aliases=("e-mail", "email address"), width=26),
        Field("address", "Address", width=34),
        Field("vat_number", "VAT number", aliases=("vat", "vat no", "tax number"), width=18),
        Field("payment_type", "Payment type", aliases=("payment", "terms"), width=16),
        Field(
            "payment_frequency", "Payment frequency",
            aliases=("frequency", "pay frequency"), width=18,
        ),
        Field(
            "is_active", "Active",
            aliases=("status", "enabled"), width=10, from_cell=yes_no_back,
        ),
    ],
    sample_rows=[
        ["Fresh Farms", "Produce", "Ravi", "+44 7700 900123", "orders@freshfarms.co.uk",
         "12 Market St, Leicester", "GB123456789", "CREDIT", "WEEKLY", "yes"],
        ["Metro Cash & Carry", "Dry Goods", "", "+44 116 555 0101", "", "", "", "CASH", "", "yes"],
    ],
)

# ── employees ─────────────────────────────────────────────────────────────
#
# ⚠️ NO PAY ON THE DEFAULT EXPORT. Salary and National Insurance are the most
# sensitive fields this product holds, and an export is a file that ends up in
# email and on desktops. `EMPLOYEES_WITH_PAY` exists for a real migration and is
# a deliberate, separately-permissioned choice — not the button somebody presses
# to get a staff list.
#
# Name is required and nothing else is, for the same reason as vendors: a
# restaurant's staff list usually starts as names on paper.

_EMPLOYEE_CORE = [
    Field("full_name", "Name", required=True, aliases=("employee", "staff", "name"), width=26),
    Field("employee_code", "Code", aliases=("employee code", "id", "ref"), width=12),
    Field("job_title", "Job title", aliases=("role", "position", "job"), width=20),
    Field("mobile", "Phone", aliases=("mobile", "telephone", "tel"), width=18),
    Field("address", "Address", width=30),
    Field("emergency_contact", "Emergency contact", aliases=("next of kin",), width=22),
    Field("emergency_phone", "Emergency phone", width=18),
    Field("is_active", "Active", aliases=("status",), width=10, from_cell=yes_no_back),
]

EMPLOYEES = ListSpec(
    name="Employees",
    title="DineAI — Employees",
    subtitle="One row per person. Name is required. Pay is NOT included in this file.",
    fields=list(_EMPLOYEE_CORE),
    sample_rows=[
        ["Anita Sharma", "E001", "Chef", "+44 7700 900111", "",
         "Raj Sharma", "+44 7700 900112", "yes"],
        ["Tom Blake", "E002", "Waiter", "", "", "", "", "yes"],
    ],
)

EMPLOYEES_WITH_PAY = ListSpec(
    name="Employees (with pay)",
    title="DineAI — Employees, including pay",
    subtitle=(
        "Contains salary and National Insurance numbers. Share it the way you would "
        "share a payslip."
    ),
    fields=[
        *_EMPLOYEE_CORE,
        Field("salary_type", "Pay basis", aliases=("salary type",), width=14),
        Field("monthly_salary", "Monthly salary", kind="number", right=True, width=16),
        Field("hourly_rate", "Hourly rate", kind="number", right=True, width=14),
        Field("ni_number", "NI number", aliases=("ni", "national insurance"), width=16),
    ],
    sample_rows=[
        ["Anita Sharma", "E001", "Chef", "", "", "", "", "yes", "MONTHLY", 2600, "", "QQ123456C"],
    ],
)

#: Every list that can leave and come back, by the slug used in the URL. The
#: routes are generated from this, so adding a list here is the whole change.
EXPORTABLE: dict[str, ListSpec] = {
    "vendors": VENDORS,
    "employees": EMPLOYEES,
    "employees-with-pay": EMPLOYEES_WITH_PAY,
}
