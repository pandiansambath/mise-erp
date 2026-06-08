# Mise — How It Works (the whole site, explained)

Plain-English reference for the product: what every number means, who can do what,
how things link together, and the formulas behind the scenes. For a junior reader —
no assumed jargon. Keep it updated as modules change.

---

## 1. The core idea
Mise connects the chain that decides whether a restaurant makes money:

```
Vendor prices → Item cost (weighted avg) → Recipe cost/plate → Dish margin
            ↓                          ↓
        Purchasing (POs)          Sales & cash → P&L → Profit
            ↓
        Inventory stock ← Expenses, Payroll, Documents all feed the P&L
```

A change anywhere (a vendor raises chicken £1/kg) ripples into dish cost, margin, and profit.

---

## 2. The two kinds of "people" in Mise — READ THIS FIRST
This is the #1 source of confusion. There are **two separate concepts:**

1. **User (login account)** — someone who can log in. Has an **email + password + a
   role** (Super Admin, Manager, etc.). Roles decide what screens/buttons they get.
2. **Employee (HR record)** — a person you employ: name, salary, NI number, visa
   expiry, bank details. Used for **attendance + payroll**. An Employee does **NOT**
   automatically have a login.

They are linked by an optional field `Employee.user_id` (a "login link"). Today the UI
**doesn't connect them yet**, which is why:
- You created a **staff User** → it can log in but has no Employee record → it doesn't
  show in the Attendance list (Attendance lists **Employees**, not Users).
- The names in Attendance/Payroll are **real Employee rows** (seeded sample data, e.g.
  Balaji, Mohamed) — not hardcoded UI text — but they have no login.

**Planned (in checklist):** link/create a login for an Employee, so a staff member logs
in and sees only their own attendance, payslips, and documents (self-service).

---

## 3. Roles & permissions (RBAC) — current, accurate
Source of truth: [backend/app/core/rbac.py](../backend/app/core/rbac.py). Each User has one
`role`; every endpoint declares the permission it needs. `write` implies `read` on the
same module. `SUPER_ADMIN` has `*` (everything).

| Capability | SUPER_ADMIN | MANAGER | KITCHEN_MANAGER | ACCOUNTANT | CASHIER | STAFF |
|-----------|:-:|:-:|:-:|:-:|:-:|:-:|
| Users (create/edit) | ✅ | 👁 read | — | — | — | — |
| Inventory items & stock | ✅ | ✅ | 👁 read | — | — | — |
| Vendors & prices | ✅ | ✅ | — | 👁 read | — | — |
| Recipes & costing | ✅ | ✅ | ✅ | 👁 read | — | — |
| Indents (kitchen requests) | ✅ | ✅ write+approve | ✅ write | — | — | — |
| Purchase orders / receiving | ✅ | ✅ | — | — | — | — |
| Sales & cash | ✅ | ✅ | — | — | ✅ | — |
| Expenses | ✅ | ✅ | — | ✅ | — | — |
| Employees | ✅ | ✅ | — | 👁 read | — | — |
| Attendance | ✅ | ✅ | — | — | — | own (`:self`) |
| Payroll | ✅ | 👁 read | — | ✅ run | — | own (`:self`) |
| Reports / P&L | ✅ | ✅ | — | ✅ | — | — |
| Documents | ✅ | ✅ | — | ✅ | — | — |

✅ = create/edit · 👁 = read-only · — = no access · own = only their own records.

> **Why STAFF sees almost nothing today:** STAFF only has `attendance:self` + `payroll:self`,
> and the self-service screens aren't built yet (checklist). That's the empty experience you saw.

> **Who is "Chef"?** Today "Chef" is an Employee *job title*, not a login role. Recipe authoring
> is done by KITCHEN_MANAGER / MANAGER / SUPER_ADMIN (all have `recipes:write`). A dedicated
> CHEF login role can be added if you want chefs editing recipes directly.

---

## 4. Sales & Cash — explained with a real scenario
**Who uses it:** Cashier (enters daily takings + counts the till), Manager/Super Admin (oversee).

**The mental model:** at end of day you record (a) how much you *sold* and through which
*channel*, and (b) you *count the cash in the till* and check it matches what it *should* be.

### Channels & the money words
A **channel** = a way customers pay you: Dine-in, Takeaway, **Uber Eats**, **Deliveroo**, etc.
Delivery apps take a **commission** (a % cut).

| Word | Meaning | Example |
|------|---------|---------|
| **Gross** | What the customer paid, before any cut. | Uber Eats orders = **£500** |
| **Commission** | The channel's % cut (Uber Eats 30%). | 30% of £500 = **£150** |
| **Net** | What *you actually keep* = Gross − Commission. | £500 − £150 = **£350** |
| **Cash sales** | Of the gross, how much was paid in physical cash. | £200 |
| **Card sales** | Paid by card/app (not cash). | £300 |

> So "gross vs net": **gross** = headline sales, **net** = money that's really yours after
> the delivery app's cut. Dine-in usually has 0% commission → gross = net.

### The cash drawer (till reconciliation) — opening, closing, variance
At day start the till has a **float** (some cash to make change). At day end you physically
count it. Mise checks the count against the maths.

| Word | Meaning |
|------|---------|
| **Opening cash** | Cash in the till at the **start** of the day (the float), e.g. £100. |
| **Cash sales** | Cash that came in during the day (from sales above), e.g. £200. |
| **Expected cash** | What *should* be in the till = **Opening + Cash sales** = £100 + £200 = **£300**. |
| **Cash counted** | What you *actually* counted at close, e.g. £290. |
| **Cash variance** | **Counted − Expected** = £290 − £300 = **−£10**. |

- **Negative variance (−£10)** = £10 *missing* (short) — miscount, theft, unrecorded
  payout, or wrong change given. **Positive** = extra cash (overcharged / forgot to record a sale).
- **"OFF" badge** you saw next to variance = the status indicator: the till is **OFF** (doesn't
  balance) vs **OK** (matches). It's a flag, not a number. −£10 → **OFF**.

> **"Petty cash / expense cash draw"** (terms you asked about): money taken *out* of the till
> for small cash purchases (e.g. £20 for emergency milk). That reduces expected cash, so the
> till would look short unless recorded. Today this is handled via the **Expenses** module
> (log it as a cash expense); a dedicated "petty cash out of till" line is a possible enhancement.

**Why opening/closing matters:** without an opening float you can't tell whether the closing
count is right. Variance is the daily honesty + accuracy check on cash — it catches theft and
mistakes early. (Checklist: add a per-day **PDF/Excel** export of this sheet.)

---

## 5. Inventory — stock & the low-stock formula
| Term | Meaning |
|------|---------|
| **Stock** | Quantity on hand now (+ unit: kg, litre, piece…). |
| **Min stock** | Reorder threshold **you set per item** when adding it. |
| **Avg cost** | **Weighted-average** price actually paid, blended over purchases at different prices. Used for recipe costing/COGS. |

**Low-stock formula:** an item is "Low" when **`current_stock ≤ min_stock_level`**. That's it.
**Who decides?** Whoever creates/edits the item sets `min_stock` (Manager/Super Admin) — it's a
human judgement of "how low is too low before we reorder." Low items show a red badge + a
dashboard alert + (planned) a notification.

> Checklist: **Category** should be a **dropdown** (pick from existing), with a "Can't see it? Add
> new" option for Super Admin — instead of free typing (which creates messy duplicate categories).

---

## 6. Recipes & costing — who picks the vendor
- **Cost / serving** = ingredient cost for **one plate**. **Sells at** = your menu price.
  **Margin** = `(Sells at − Cost) ÷ Sells at × 100` (gross *food* margin — ingredients only,
  not counting rent/wages). Healthy ≈ 65–75%.
- Cost is **recomputed every time you open a recipe** (reads current prices) — "live on view."
- **Vendor pick:** by default Mise uses the **cheapest active vendor's** price. You can now mark a
  **Preferred vendor** on the Price Comparison screen — then costing uses *that* vendor (for
  quality/reliability), and the Recipes "source" column shows ★ + the vendor name. If no preferred
  is set, it falls back to cheapest. (Done 2026-06-08.)
- **Who authors recipes?** KITCHEN_MANAGER / MANAGER / SUPER_ADMIN have `recipes:write`. **Note:** the
  recipes screen is currently **view-only** — there is no "add recipe" form in the UI yet for *any*
  role (recipes are seeded; the backend create endpoint exists). Building the authoring UI (name,
  servings, ingredients + quantities → auto per-serve cost) is on the checklist.

---

## 7. Purchasing — indent → approval → vendor-wise POs → receive
**The flow (and who does each step):**
1. **Kitchen Manager** raises a **Kitchen Indent** = "we need these items + quantities."
   (perm `indent:write`).
2. **Manager / Super Admin approves** it (perm `indent:approve`).
3. On approval Mise **auto-generates Purchase Orders**, grouping items **by their cheapest
   vendor** → **one PO per vendor**.
4. When goods arrive, **Receive** the PO → stock goes up + average cost recalculates.

**Why you saw 10 PObs / 10 PDFs for 10 items:** POs are split **per supplier**, because each
supplier gets their *own* order document. If your 10 items each have a *different* cheapest
vendor, you get 10 POs (one PDF each) — **this is by design** (you can't send one PDF to 10
different suppliers). If several items share the *same* cheapest vendor, they combine into one PO
with multiple lines. To get fewer POs, have items supplied by the same vendor (or set preferred vendors).

> Checklist: make the indent→approval→ordered status update **live** (realtime) so you don't have
> to reload to see the other person's action. And add **confirmation dialogs** on approve/receive.

---

## 8. Employees, Attendance & the punch flow
**Who uses it:** Manager / Super Admin manage employees + attendance today.

**Attendance day fields:** `clock_in`, `clock_out`, `break_start`, `break_minutes`, computed
`working_hours`, `status` (PRESENT/ABSENT/HALF_DAY/LEAVE).

**The punch flow:** **Clock in → (optional) Start break → End break → Clock out.** The buttons
only enable when valid (you can't End break before you Start one — that was the "can't click
Break/Resume" issue; now fixed: invalid buttons are hidden + status badges show On break / Working
/ Clocked out).

**Who punches?** Today a Manager records it from the dashboard. The intended model (checklist) is
**employee self-punch from their own login**, or a shared kiosk. That needs the Employee↔User link
(section 2) before staff can punch for themselves.

> Checklist (you requested a detailed attendance): add **break_end**, **total worked time**, **total
> break time**, a hotel-configured **break allowance**, an **exceeded** flag, and **penalty per
> minute** (configured by Super Admin). Plus **PDF/Excel timesheet export**.

---

## 9. Payroll — the formula & who sets the rates
**Who runs it:** Accountant (`payroll:write`) or Super Admin. Manager can view.

**Two pay types (set per Employee):**
- **MONTHLY salary:** `daily rate = monthly_salary ÷ working_days`. Then
  `gross = daily rate × days_present` (+ half-days × ½, + overtime). "Working days" is the
  number of days in the pay period you actually expect work — **you set it on the Run Payroll
  screen** (e.g. 26). That's where "per-day cost" comes from: monthly salary ÷ working days.
- **HOURLY:** `gross = hourly_rate × total_hours`. Mise **blocks** any hourly rate below the **UK
  minimum wage (£11.44)** — a compliance guard.

**Deductions:** advances (money lent to staff, auto-deducted in the period) + other deductions →
**net pay = gross + overtime − advances − other**. Output = a **branded PDF payslip**.

**Where rates live:** `monthly_salary` / `hourly_rate` are on each **Employee** record (set when
you add/edit the employee). Mise doesn't invent rates — it uses what you entered.

---

## 10. Documents (Phase 9)
Upload licences, insurance, vendor contracts, employee docs, utility bills — each with an optional
**expiry date**. Mise shows an **"Expiring soon"** alert (within N days). Stored via a storage
abstraction (local now, S3-swappable on deploy). (Perm `documents:write` = Super Admin / Manager /
Accountant.)

> Checklist: **Document requests** — Super Admin requests a specific doc from an employee → appears
> as a **pending upload** for that employee (needs employee self-service login first).

---

## 11. Reports / P&L — the profit waterfall
```
Gross sales
− Delivery commission        → Net sales
− Cost of sales (food, variable)  → Gross profit
− Operating expenses (rent, wages, utilities — fixed) → Net profit
```
Net margin % = Net profit ÷ Net sales. Food cost % target ≈ 25–35%. Exportable to Excel/CSV.

---

## 12. Editability & deletion policy
No hard delete — we **deactivate** (`is_active = false`) so history/costs stay intact. Edit exists
for items; Edit/deactivate UI for vendors & recipes is on the checklist (backend PATCH exists).

---

## 13. How users/hotels are created (provisioning)
Two different "sign-ups":
1. **Staff inside a restaurant → NO self sign-up.** The **Super Admin creates** each staff account
   + assigns a role (`POST /api/auth/users`). The owner controls who sees costs/payroll.
2. **A new restaurant joining Mise → "Register your hotel" self sign-up** (creates a new hotel + its
   first Super Admin). **Not built yet** — that's why `/` only shows login today. On the checklist
   together with a proper animated landing page.
