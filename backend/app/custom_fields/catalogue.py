"""The ready-made field marketplace.

    "here have a customisation button like — what if super admin wants one
     field like he wants to get staff's address... also from our side we give
     one more option, like ready-made field marketplace."
    "not only for employee field, but also for vendor page — here also we're
     collecting vendor details, so here also we need that field marketplace
     idea."

Two halves of one feature, and the second is the one that matters.

Letting a hotel invent a field is easy and, on its own, not very useful: it
asks somebody who has never designed a form to decide what a "field" is, pick a
type, and get the label right — at the exact moment they are trying to do
something else. Most people faced with that close the dialog.

So the marketplace is the default path and the blank field is the escape hatch.
These are the details restaurants actually keep about their staff and their
suppliers, already named, already typed, already validated, grouped so somebody
can recognise what they need rather than having to think of it. One tap adds
one. It turns "design a form" into "tick the things you keep".

WHY THIS LIVES IN CODE, NOT IN THE DATABASE
Every hotel gets the same catalogue and none of them can edit it, so a table
would be 60 identical rows per tenant that nobody ever changes. Shipping it as
data in the image means adding a field to the marketplace is a deploy, not a
migration, and a hotel that already added "Food Hygiene Certificate" keeps
theirs untouched when we improve the description here.

WHAT IS DELIBERATELY NOT HERE
Nothing that belongs in a real column. "Monthly salary" is not a custom field —
payroll has to compute with it. The catalogue is for facts a restaurant wants
to KEEP and LOOK AT, not facts the software has to reason about. If something
here ever needs to drive logic, that is the signal to promote it to a column.
"""

from __future__ import annotations

from typing import Literal, TypedDict

Entity = Literal["employee", "vendor"]

#: Field types the form renderer knows how to draw and validate.
#:
#: Kept small on purpose. Every type here is one the UI can render, the API can
#: validate, and a CSV export can represent. A type nobody can export is a
#: place for data to go and never come back.
FieldType = Literal[
    "text", "textarea", "number", "money", "date", "select", "checkbox",
    "phone", "email", "url", "file",
]


class CatalogueField(TypedDict, total=False):
    key: str
    label: str
    type: FieldType
    group: str
    hint: str
    options: list[str]
    #: Warn when the date is in the past / approaching. Drives the same alert
    #: machinery as visa expiry, which is why those fields are worth having as
    #: dates rather than as free text.
    expires: bool


# ── STAFF ────────────────────────────────────────────────────────────────────
EMPLOYEE_CATALOGUE: list[CatalogueField] = [
    # Identity and contact — his own example was the staff address, which is
    # already a column; these are the ones next to it that are not.
    {"key": "home_postcode", "label": "Home postcode", "type": "text", "group": "Contact",
     "hint": "Useful for late-shift taxis and travel allowances."},
    {"key": "personal_email", "label": "Personal email", "type": "email", "group": "Contact"},
    {"key": "next_of_kin", "label": "Next of kin", "type": "text", "group": "Contact"},
    {"key": "next_of_kin_phone", "label": "Next of kin phone", "type": "phone", "group": "Contact"},
    {"key": "date_of_birth", "label": "Date of birth", "type": "date", "group": "Contact",
     "hint": "Drives under-18 hour limits and birthday reminders."},

    # Right to work — the ones a UK inspection actually asks for.
    {"key": "passport_number", "label": "Passport number", "type": "text",
     "group": "Right to work"},
    {"key": "passport_expiry", "label": "Passport expiry", "type": "date",
     "group": "Right to work", "expires": True},
    {"key": "share_code", "label": "Right-to-work share code", "type": "text",
     "group": "Right to work", "hint": "The 9-character code from the Home Office check."},
    {"key": "brp_number", "label": "BRP number", "type": "text", "group": "Right to work"},
    {"key": "settled_status", "label": "Settled status", "type": "select",
     "group": "Right to work",
     "options": ["Settled", "Pre-settled", "Not applicable", "Pending"]},
    {"key": "student_visa_hours", "label": "Student visa weekly hour cap", "type": "number",
     "group": "Right to work",
     "hint": "20 for most student visas. Rota warnings use this."},

    # Certificates — the things that expire and get forgotten.
    {"key": "food_hygiene_level", "label": "Food hygiene level", "type": "select",
     "group": "Certificates", "options": ["Level 1", "Level 2", "Level 3", "Level 4"]},
    {"key": "food_hygiene_expiry", "label": "Food hygiene expiry", "type": "date",
     "group": "Certificates", "expires": True},
    {"key": "allergen_training_date", "label": "Allergen training", "type": "date",
     "group": "Certificates", "expires": True},
    {"key": "first_aid_expiry", "label": "First aid expiry", "type": "date",
     "group": "Certificates", "expires": True},
    {"key": "personal_licence", "label": "Personal alcohol licence", "type": "text",
     "group": "Certificates"},
    {"key": "dbs_check_date", "label": "DBS check", "type": "date", "group": "Certificates"},

    # Employment terms.
    {"key": "contract_type", "label": "Contract type", "type": "select", "group": "Employment",
     "options": ["Full time", "Part time", "Zero hours", "Casual", "Agency", "Apprentice"]},
    {"key": "probation_end", "label": "Probation ends", "type": "date", "group": "Employment",
     "expires": True},
    {"key": "notice_period_weeks", "label": "Notice period (weeks)", "type": "number",
     "group": "Employment"},
    {"key": "holiday_entitlement_days", "label": "Holiday entitlement (days)", "type": "number",
     "group": "Employment"},
    {"key": "pension_opt_out", "label": "Opted out of pension", "type": "checkbox",
     "group": "Employment"},
    {"key": "student_loan_plan", "label": "Student loan plan", "type": "select",
     "group": "Employment", "options": ["None", "Plan 1", "Plan 2", "Plan 4", "Postgraduate"]},
    {"key": "p45_received", "label": "P45 received", "type": "checkbox", "group": "Employment"},

    # Day to day.
    {"key": "uniform_size", "label": "Uniform size", "type": "select", "group": "Day to day",
     "options": ["XS", "S", "M", "L", "XL", "XXL"]},
    {"key": "locker_number", "label": "Locker number", "type": "text", "group": "Day to day"},
    {"key": "transport", "label": "How they get here", "type": "select", "group": "Day to day",
     "options": ["Walks", "Cycles", "Drives", "Bus", "Train", "Lift share"]},
    {"key": "languages", "label": "Languages spoken", "type": "text", "group": "Day to day",
     "hint": "Handy when a table needs somebody who speaks their language."},
    {"key": "dietary_needs", "label": "Dietary needs", "type": "text", "group": "Day to day",
     "hint": "For staff meals."},
    {"key": "medical_notes", "label": "Medical notes", "type": "textarea", "group": "Day to day",
     "hint": "Anything a manager must know in an emergency."},
    {"key": "photo_consent", "label": "Happy to appear in photos", "type": "checkbox",
     "group": "Day to day"},
]

# ── SUPPLIERS ────────────────────────────────────────────────────────────────
VENDOR_CATALOGUE: list[CatalogueField] = [
    # Who you actually ring at 6am when the delivery has not arrived.
    {"key": "account_number", "label": "Our account number with them", "type": "text",
     "group": "Account"},
    {"key": "rep_name", "label": "Sales rep", "type": "text", "group": "Account"},
    {"key": "rep_mobile", "label": "Rep's mobile", "type": "phone", "group": "Account"},
    {"key": "orders_email", "label": "Orders email", "type": "email", "group": "Account",
     "hint": "Often different from the main contact address."},
    {"key": "portal_url", "label": "Ordering portal", "type": "url", "group": "Account"},
    {"key": "company_number", "label": "Companies House number", "type": "text",
     "group": "Account"},

    # Delivery — the facts that decide whether an order lands in time.
    {"key": "delivery_days", "label": "Delivery days", "type": "text", "group": "Delivery",
     "hint": "e.g. Mon, Wed, Fri."},
    {"key": "cutoff_time", "label": "Order cut-off", "type": "text", "group": "Delivery",
     "hint": "The time an order has to be in by for the next delivery."},
    {"key": "lead_time_days", "label": "Lead time (days)", "type": "number", "group": "Delivery"},
    {"key": "min_order_value", "label": "Minimum order", "type": "money", "group": "Delivery"},
    {"key": "delivery_charge", "label": "Delivery charge", "type": "money", "group": "Delivery"},
    {"key": "free_delivery_over", "label": "Free delivery over", "type": "money",
     "group": "Delivery"},
    {"key": "delivery_window", "label": "Usual delivery window", "type": "text",
     "group": "Delivery", "hint": "e.g. 6am–9am."},

    # Compliance — what an EHO or an insurer asks to see.
    {"key": "food_safety_cert", "label": "Food safety certificate", "type": "file",
     "group": "Compliance"},
    {"key": "food_safety_expiry", "label": "Food safety cert expiry", "type": "date",
     "group": "Compliance", "expires": True},
    {"key": "insurance_expiry", "label": "Liability insurance expiry", "type": "date",
     "group": "Compliance", "expires": True},
    {"key": "halal_certified", "label": "Halal certified", "type": "checkbox",
     "group": "Compliance"},
    {"key": "organic_certified", "label": "Organic certified", "type": "checkbox",
     "group": "Compliance"},
    {"key": "allergen_statement", "label": "Allergen statement", "type": "file",
     "group": "Compliance"},

    # Commercial.
    {"key": "contract_end", "label": "Contract ends", "type": "date", "group": "Commercial",
     "expires": True},
    {"key": "discount_terms", "label": "Discount terms", "type": "text", "group": "Commercial",
     "hint": "e.g. 5% over £500, 2% for 7-day settlement."},
    {"key": "price_review_date", "label": "Next price review", "type": "date",
     "group": "Commercial", "expires": True},
    {"key": "returns_policy", "label": "Returns policy", "type": "textarea",
     "group": "Commercial"},
    {"key": "preferred", "label": "Preferred supplier", "type": "checkbox",
     "group": "Commercial"},
    {"key": "notes", "label": "Notes", "type": "textarea", "group": "Commercial",
     "hint": "Anything the next person to order from them should know."},
]

CATALOGUES: dict[str, list[CatalogueField]] = {
    "employee": EMPLOYEE_CATALOGUE,
    "vendor": VENDOR_CATALOGUE,
}


def catalogue_for(entity: str) -> list[CatalogueField]:
    return CATALOGUES.get(entity, [])


def groups_for(entity: str) -> list[str]:
    """Group names in the order they first appear — the order they were
    written, which is roughly the order somebody would fill them in."""
    seen: list[str] = []
    for f in catalogue_for(entity):
        g = f.get("group") or "Other"
        if g not in seen:
            seen.append(g)
    return seen
