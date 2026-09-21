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

# ── recipes / the menu ────────────────────────────────────────────────────
#
# "like this so many export featrue not available issue even in menu recipe"
#
# ⚠️ THE DISH, NOT ITS INGREDIENTS. A recipe's real value is its lines — 180g
# of paneer, 40ml of cream — and those are a SECOND table with a foreign key
# per row, which does not fit one row per dish. Carrying them would need a
# nested format, and a nested format is not something a person can open in
# Excel and edit, which is the entire point of these files.
#
# So this exports the menu: what you sell, what it costs you, what you charge.
# A restaurant moving accounts gets its dish list, its prices and its margins
# on day one and rebuilds the ingredient lines as it goes — which is the same
# order it built them the first time.
#
# `calculated_cost` is exported and NOT importable: it is derived from the
# recipe lines and the current supplier prices, so accepting it back would let
# a stale number in a spreadsheet overwrite a figure the product computes. It
# is here to be read, in the file, by a person deciding what to charge.

RECIPES = ListSpec(
    name="Menu",
    title="DineAI — Menu & dishes",
    subtitle=(
        "One row per dish. Name is required. Ingredient lines are not in this "
        "file — add those on the Recipes page once the dishes are in."
    ),
    fields=[
        Field("name", "Dish", required=True, aliases=("recipe", "item", "name"), width=30),
        Field("category", "Category", aliases=("type", "group", "course"), width=18),
        Field(
            "servings_default", "Serves", kind="number",
            aliases=("servings", "portions", "yield"), right=True, width=10,
        ),
        Field(
            "selling_price", "Price", kind="number",
            aliases=("selling price", "menu price", "sell"), right=True, width=12,
        ),
        Field("is_active", "On the menu", aliases=("active", "status"),
              width=12, from_cell=yes_no_back),
    ],
    sample_rows=[
        ["Paneer Butter Masala", "Mains", 1, 12.50, "yes"],
        ["Masala Dosa", "Breakfast", 1, 8.00, "yes"],
    ],
)


#: Every list that can leave and come back, by the slug used in the URL. The
#: routes are generated from this, so adding a list here is the whole change.
# ── stock items ───────────────────────────────────────────────────────────
#
# ALIASES COME FROM THE EXPORTER, not from a second list of English typed here.
# That is not tidiness: the way this round trip broke the first time was the
# exporter writing "In stock" while the importer accepted "Opening stock" and
# four aliases that did not include it, so the quantity column was dropped on
# every re-import WITHOUT AN ERROR.
#
# Price is deliberately absent. An item's cost comes from the vendor's price
# list, per the pricing law — a cost typed into a stock sheet would be a second
# source of truth for the number this whole product exists to get right.

def _unstar(v: str) -> str:
    """Drop the ★ the exporter uses to mark the chosen supplier."""
    from app.inventory.export import CHOSEN_MARK

    s = (v or "").strip()
    return s[len(CHOSEN_MARK):].strip() if s.startswith(CHOSEN_MARK.strip()) else s


def _exp_header(key: str) -> str:
    """The header the CSV exporter writes this field under, lower-cased."""
    from app.inventory.export import ITEM_IMPORT_HEADERS

    return ITEM_IMPORT_HEADERS.get(key, key).lower()


ITEMS = ListSpec(
    name="Stock",
    title="DineAI — Stock items",
    subtitle=(
        "One row per item. Name and Unit are required. Supplier is optional and "
        "links to that vendor's existing price — you never type a price here."
    ),
    fields=[
        Field("name", "Name", required=True,
              aliases=("item", "product", "ingredient", _exp_header("name")), width=30),
        Field("unit", "Unit", required=True,
              aliases=("uom", "units", _exp_header("unit")), width=12),
        Field("category", "Category",
              aliases=("type", "group", _exp_header("category")), width=18),
        Field("current_stock", "Opening stock", kind="number",
              aliases=("stock", "quantity", "qty", "opening", _exp_header("current_stock")),
              right=True, width=14),
        Field("supplier", "Supplier",
              aliases=("vendor", "supplier name", _exp_header("supplier")), width=24,
              # THE EXPORT WRITES "★ Fresh Farms" so a person can see which
              # supplier is chosen. `_find_vendor` already strips the mark
              # before matching; the COMPARISON did not, so a re-imported
              # export read "★ Exotic" against "Exotic" and called it a change.
              from_cell=_unstar),
    ],
    sample_rows=[
        ["Basmati Rice", "kg", "Dry Goods", 25, "Fresh Farms"],
        ["Paneer", "kg", "Dairy", 10, ""],
    ],
)


EXPORTABLE: dict[str, ListSpec] = {
    "inventory": ITEMS,
    "vendors": VENDORS,
    "employees": EMPLOYEES,
    "employees-with-pay": EMPLOYEES_WITH_PAY,
    "recipes": RECIPES,
}
