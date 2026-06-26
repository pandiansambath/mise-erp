"""What the Copilot KNOWS about Mise — the grounding that makes a generic model
feel custom-trained on our product.

Three things:
  • PAGES   — every screen, what you do there, the route to link to, the
              permission it needs (so we never point a user somewhere they
              can't go).
  • GLOSSARY— plain-English definitions of the money/restaurant terms a user
              might ask about ("what is slow stock?", "what's a margin?").
  • PERSONA — who the assistant is and how it should behave.

This is small enough to live entirely in the prompt (Gemini Flash has a 1M-token
context), so there's no vector DB to maintain. Keep it current as features land.
"""
from __future__ import annotations

# ── Pages / navigation map ────────────────────────────────────────────────────
# route is the in-app path the UI links to; perm gates whether to suggest it.
PAGES: list[dict] = [
    {"route": "/dashboard", "label": "Dashboard", "perm": None,
     "about": "The home overview — today's sales, this month's profit & margin, low-stock count, recipe count."},
    {"route": "/money", "label": "Money", "perm": "reports:read",
     "about": "The money command centre: net sales, net profit, food-cost %, stock value, waste, break-even, food-cost variance, best/thinnest dish margins, and supplier price-rise alerts."},
    {"route": "/reports", "label": "Reports (P&L)", "perm": "reports:read",
     "about": "Profit & loss for any date range — net sales, cost of sales, gross/net profit and margins, plus an expense breakdown. Exports to PDF."},
    {"route": "/inventory", "label": "Inventory", "perm": "inventory:read",
     "about": "Every stock item with its current quantity, weighted-average cost, stock value, min/par levels, allergens and which suppliers price it. Where you see what's low or out of stock."},
    {"route": "/stock-take", "label": "Stock-take", "perm": "inventory:read",
     "about": "Count physical stock and reconcile it against the system — surfaces shrinkage/variance."},
    {"route": "/purchasing", "label": "Purchasing", "perm": "indent:read",
     "about": "Create an indent (request to buy), then raise purchase orders to your chosen supplier and receive stock in. This is WHERE YOU BUY/REORDER items that are low."},
    {"route": "/vendors", "label": "Vendors", "perm": "vendors:read",
     "about": "Your suppliers — contacts, the items each one prices, and which supplier you've chosen for each item."},
    {"route": "/price-comparison", "label": "Price Comparison", "perm": "vendors:read",
     "about": "Compare what different suppliers charge for the same item and see the potential saving."},
    {"route": "/recipes", "label": "Recipes", "perm": "recipes:read",
     "about": "Dish recipes costed to the gram from live ingredient prices, with selling price and profit margin per dish."},
    {"route": "/allergens", "label": "Allergens", "perm": "recipes:read",
     "about": "Per-dish allergen matrix (Natasha's Law) — each dish inherits the allergens tagged on its ingredients."},
    {"route": "/food-safety", "label": "Food Safety", "perm": "inventory:read",
     "about": "Temperature logs and food-safety checklists (HACCP-style daily records)."},
    {"route": "/waste", "label": "Waste", "perm": "inventory:read",
     "about": "Log spoilage/spillage/over-prep; it values the loss at weighted-average cost so you can see the money leaking."},
    {"route": "/sales", "label": "Sales & Cash", "perm": "sales:read",
     "about": "Enter daily sales by channel (dine-in, delivery apps…), record cash, and reconcile the till. Delivery commission is netted off."},
    {"route": "/expenses", "label": "Expenses", "perm": "expenses:read",
     "about": "Record fixed (rent, utilities, salaries) and variable (food, packaging) costs — these feed the P&L."},
    {"route": "/employees", "label": "Employees", "perm": "employees:read",
     "about": "Staff records — pay, contract details, visa expiry alerts, documents."},
    {"route": "/attendance", "label": "Attendance", "perm": "attendance:read",
     "about": "Clock-in/out, breaks and break penalties; the basis for hours worked."},
    {"route": "/rota", "label": "Rota", "perm": "employees:read",
     "about": "Plan shifts and see projected labour cost as a % of sales."},
    {"route": "/payroll", "label": "Payroll", "perm": "payroll:read",
     "about": "Run payroll from hours/salary — gross, overtime, deductions, net pay and payslips."},
    {"route": "/documents", "label": "Documents", "perm": "documents:read",
     "about": "Store and track documents with expiry reminders; request documents from staff."},
    {"route": "/staff", "label": "Staff (users)", "perm": "users:read",
     "about": "Manage user logins and their roles/permissions."},
    {"route": "/audit", "label": "Audit log", "perm": "users:read",
     "about": "A trail of who did what and when."},
    {"route": "/my", "label": "My Space", "perm": "attendance:self",
     "about": "A staff member's own area — clock in/out and view their own payslips."},
]

# ── Glossary — the money/restaurant vocabulary ─────────────────────────────────
GLOSSARY: dict[str, str] = {
    "low stock": "An item whose current quantity has fallen to or below its minimum (reorder) level — it's time to buy more. See the low-stock list on Inventory or the Dashboard, then reorder on Purchasing.",
    "out of stock": "An item with zero (or effectively zero) quantity on hand. Reorder it on the Purchasing page.",
    "slow stock": "Slow-moving stock — items sitting in inventory that you're barely using or selling. Money is tied up in them and they risk spoiling (waste). Spot them by looking for high stock value with little movement on Inventory/Stock-take, and watch the Waste page for what's being thrown away.",
    "slow moving stock": "Same as slow stock — inventory that turns over slowly, tying up cash and risking spoilage.",
    "weighted average cost": "When you buy the same item at different prices over time, Mise blends them into one average cost weighted by quantity. Every recipe using that item re-prices automatically as new deliveries arrive — so dish costs always reflect what you actually paid.",
    "average cost": "The blended (weighted-average) unit cost of an item across your purchases. Used to value stock and cost recipes.",
    "margin": "Profit as a percentage of the selling price. For a dish: (selling price − cost to make) ÷ selling price. Higher is better; thin margins mean a dish barely earns.",
    "profit margin": "See margin — for a dish it's (selling price − cost) ÷ selling price, shown per recipe on the Recipes page.",
    "food cost percentage": "Cost of food sold ÷ net sales, as a %. The single most-watched restaurant number — lower means more of each £ of sales is kept. Shown on Money and Reports.",
    "food cost variance": "The gap between your THEORETICAL food cost (what recipes say dishes should cost) and your ACTUAL food cost (what you really spent). A big gap points to waste, over-portioning or theft.",
    "gross profit": "Net sales minus the cost of sales (variable/food costs). What's left to cover fixed costs and profit.",
    "net profit": "What's actually left after ALL costs — gross profit minus operating (fixed) expenses like rent, utilities and salaries.",
    "net sales": "Sales after deducting delivery-app commission — the revenue you actually keep before costs.",
    "commission": "The cut a delivery platform (e.g. a food-delivery app) takes from each order. Mise nets it off gross sales to give net sales.",
    "break even": "The level of sales at which profit is exactly zero — you've covered all costs but earned nothing yet. Above it you're in profit. Shown on the Money page with how far off you are.",
    "indent": "A purchase request — the list of what the kitchen needs to buy. You raise an indent first, then turn it into purchase orders to suppliers. Lives on the Purchasing page.",
    "purchase order": "A PO — a formal order sent to one supplier for specific items and quantities, at their prices. Created from an indent on Purchasing; receiving it adds the stock in.",
    "po": "Purchase order — a formal order to a supplier; see Purchasing.",
    "reorder level": "The minimum quantity for an item; drop to it and the item counts as low stock. 'Par' is the level you top back up to when reordering.",
    "par level": "The target stock level you top an item back up to when you reorder.",
    "waste": "Stock lost to spoilage, spillage or over-prep. Logging it on the Waste page values the loss at average cost so you can see (and cut) the leak.",
    "stock take": "Physically counting your stock and reconciling it against the system to catch shrinkage. See the Stock-take page.",
    "menu engineering": "Classifying dishes by how much they sell vs how profitable they are — Stars (sell lots, high margin), Plowhorses (sell lots, low margin), Puzzles (sell little, high margin), Dogs (sell little, low margin). Guides what to promote, re-price or drop.",
    "star": "A menu-engineering class: a dish that BOTH sells a lot AND has a high margin — protect and promote it.",
    "plowhorse": "A menu-engineering class: a popular dish with a thin margin — consider a small price rise or a cheaper recipe tweak.",
    "puzzle": "A menu-engineering class: a high-margin dish that few people order — promote it or reposition it on the menu.",
    "dog": "A menu-engineering class: a dish that sells little AND earns little — a candidate to drop or rework.",
    "allergens": "The 14 legally-declarable allergens. In Mise you tag them on an ingredient/stock item and every dish using it inherits them, giving a per-dish allergen list (Natasha's Law). See the Allergens page.",
    "natasha's law": "UK law requiring full ingredient + allergen labelling on pre-packed-for-direct-sale food. Mise's Allergens page gives the per-dish allergen breakdown.",
    "labour percentage": "Staff cost as a % of net sales — a key efficiency number. Projected on the Rota page from planned shifts.",
    "stock value": "The total money tied up in your current stock, valued at weighted-average cost. Shown on the Money page, broken down by category.",
    "p&l": "Profit & loss — the statement of sales minus costs down to net profit, for a date range. See the Reports page.",
    "cost of sales": "The variable costs directly tied to making what you sold — mainly food and packaging. Net sales minus cost of sales = gross profit.",
    "fixed costs": "Costs that don't move much with sales — rent, utilities, salaries, insurance. Recorded on Expenses; they're deducted after gross profit to give net profit.",
    "variable costs": "Costs that rise and fall with how much you sell — food, packaging, delivery commission. They make up the cost of sales.",
    "shrinkage": "Stock that's gone missing versus what the system expected — through waste, over-portioning, spillage or theft. Stock-take surfaces it as variance.",
    "covers": "The number of customers/diners served. Useful per-cover figures: average spend per cover, food cost per cover.",
    "overtime": "Hours worked beyond the contracted/standard hours, usually paid at a higher rate. Calculated on Payroll from attendance.",
    "gross pay": "An employee's pay before deductions (basic + overtime). Payroll then subtracts deductions to give net pay.",
    "net pay": "Take-home pay after deductions — what the employee actually receives. Shown on payslips (Payroll).",
    "par": "The target level you top an item back up to when you reorder (see par level).",
    "min level": "The reorder trigger — when an item drops to its minimum it counts as low stock and should be bought.",
    "channel": "A way you sell — dine-in, takeaway, or a delivery app. Sales are entered per channel; delivery channels carry a commission cut.",
    "average spend": "Average sales value per customer/cover — total sales ÷ covers. A lever for revenue alongside footfall.",
}

# ── How-to map — common tasks → where/how (so the AI guides AND can offer to do it) ──
HOWTOS: dict[str, str] = {
    "add a supplier / vendor": "Vendors → New vendor. Or just tell me the name (plus phone/email if handy) and I'll prepare it for you to apply.",
    "add a stock item": "Inventory → New item (name, unit, category, cost, min/par). Or tell me the basics and I'll draft it.",
    "record an expense": "Expenses → Add expense (amount, category, date). Or say e.g. 'gas bill £120 today' and I'll prepare it.",
    "record sales / takings": "Sales & Cash → pick the day and enter takings by channel. Or tell me the amount and channel and I'll draft it.",
    "reorder / buy stock": "Purchasing — raise an indent (what you need), then a purchase order to your chosen supplier; receiving it adds the stock back in.",
    "do a stock-take": "Stock-take — enter your physical count next to each item; Mise shows the variance vs the system (shrinkage).",
    "cost a dish / check margins": "Recipes — each dish is costed to the gram from live ingredient prices, with its selling price and margin.",
    "see profit / P&L": "Reports for a full P&L over any date range (PDF export); Money for live profit, food-cost % and break-even.",
    "log waste": "Waste — record spoilage/spillage/over-prep; it values the loss at average cost.",
    "compare supplier prices": "Price Comparison — what each supplier charges for the same item and the potential saving.",
    "add a staff login / user": "Staff (users) — create a login and set their role and permissions.",
    "run payroll": "Payroll — builds gross, overtime, deductions and net pay from hours/salary, with payslips.",
    "upload a bill or document to me": "Tap the 📎 in this chat and attach a photo/PDF/spreadsheet (even handwritten) — I'll read it and prepare the right action for you.",
}

PERSONA = (
    "You are Mise Copilot, the built-in assistant for Mise — a restaurant ERP whose "
    "tagline is 'every plate, every penny'. You help the owner and staff of ONE "
    "restaurant understand the app and their numbers, and you can DO things for them.\n\n"
    "Scope & safety:\n"
    "• You work for exactly ONE restaurant — the signed-in user's. Every number you "
    "fetch and every action you take is automatically limited to their restaurant. "
    "Never mention or imply any other business's data.\n\n"
    "How to answer:\n"
    "• Be concise and warm. Lead with the answer. Prefer 2–4 short bullets or a couple "
    "of sentences — never a wall of text or a jargon dump. British English, £ sign.\n"
    "• For LIVE data (counts, what's low, today's sales, a specific item, this month's "
    "profit) you MUST call a tool. NEVER state a count, total or figure unless a tool "
    "returned it this conversation — don't estimate or recall. For 'how many recipes/"
    "items/suppliers' use business_overview; for the recipe list use list_recipes. If no "
    "tool can answer, say plainly you can't see that. Never guess a number.\n"
    "• For 'where/how do I…', name the page and use the navigate action to give a direct "
    "link; point them to the exact place to act (e.g. Purchasing to reorder).\n"
    "• Don't push pages the user lacks permission for. If a feature doesn't exist, say so "
    "honestly. Keep focused on Mise and running the restaurant.\n\n"
    "Be FLEXIBLE — this matters a lot:\n"
    "• ACT on what the user wants. Take their own words and run with them — do NOT make "
    "them pick from a list or re-state something they already told you.\n"
    "• Infer sensible values from context and fill them in (e.g. a 'gas bill' → an "
    "Expense in a Utilities category; a new category / supplier / sales channel is "
    "created automatically if it doesn't exist already). Treat the date as today unless "
    "they say otherwise.\n"
    "• Ask AT MOST one short question, and ONLY when a truly REQUIRED fact is missing "
    "(e.g. the amount of money, or which item) or the request is genuinely ambiguous in "
    "a way you can't reasonably resolve. Otherwise just go ahead and propose it — the "
    "user reviews and Applies, so a sensible draft beats an interrogation.\n\n"
    "Doing things (creating / recording data):\n"
    "• You can do almost anything the user could do by hand — record an expense or a "
    "sale, add a stock item or a supplier, and more. To do one, call the matching "
    "propose_* tool. It does NOT save: it raises a CONFIRMATION CARD the user reviews "
    "and taps Apply. NEVER say you've saved or added something — say you've prepared it "
    "for them to review and apply.\n"
    "• When you propose an action, give a short OVERVIEW in your reply: what you're about "
    "to do AND its IMPACT — where it'll show up and what it affects (e.g. 'I'll add "
    "Chennai Fresh Foods to your Vendors; you'll then be able to assign items to them and "
    "compare their prices. Nothing financial is recorded by this.'). Then say: review the "
    "card and tap Apply.\n"
    "• You can READ uploaded files — a bill/receipt, a PDF, a spreadsheet, or a photo "
    "(even handwritten). A bill/receipt is usually an expense; takings from an app or "
    "till is a sale. Pull the details out and propose the action; if a document could be "
    "more than one thing, make your best call and say what you assumed.\n"
    "• If the user asks for something there's no tool for yet, say you can't do that one "
    "for them yet, point them to the page where they can, and offer what you CAN do."
)


def glossary_lookup(text: str) -> str | None:
    """Best-effort glossary match for a free-text question (used by the no-key
    fallback and as a quick grounding hint). Returns the definition or None."""
    t = text.lower()
    # longest keys first so 'food cost variance' beats 'food cost'
    for term in sorted(GLOSSARY, key=len, reverse=True):
        if term in t:
            return GLOSSARY[term]
    return None


def pages_for(role_can) -> list[dict]:
    """The pages the given user may visit. role_can is a predicate(perm)->bool."""
    return [p for p in PAGES if not p["perm"] or role_can(p["perm"])]


def knowledge_brief(role_can) -> str:
    """A compact text block injected into the system prompt: the pages this user
    can reach + the glossary. Small enough to always include."""
    lines = ["MISE PAGES (only suggest ones the user can reach):"]
    for p in pages_for(role_can):
        lines.append(f"  - {p['label']} ({p['route']}): {p['about']}")
    lines.append("\nGLOSSARY:")
    for term, definition in GLOSSARY.items():
        lines.append(f"  - {term}: {definition}")
    lines.append("\nHOW-TO (common tasks → where to do them / what you can offer to do):")
    for task, how in HOWTOS.items():
        lines.append(f"  - {task}: {how}")
    return "\n".join(lines)
