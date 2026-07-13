# Mise ERP — the big roadmap (2026 H2)

*Written 2026-07-13, after the app-wide modernization pass completed. This is the "what
should Mise become next" plan — ordered by how much money/pain it saves a real UK
independent restaurant, and by what our existing plumbing already makes cheap to build.*

Legend: 💰 = direct money impact · 🧲 = keeps customers subscribed · 🔌 = needs an external
provider/account (Ravishankar's help) · 🏗️ = big build

---

## Tier 1 — highest value, build next (each unlocks the one after it)

### 1. Dish-count capture → true menu engineering 💰
**The one structural gap in our money engine.** Sales are channel-level; food-cost variance
and menu engineering run on estimates. Add the *fastest possible* dish-count entry:
- End-of-day "what did you sell?" grid (recipes as big tap-tiles, +/- steppers, remembers
  yesterday's counts as the starting point) — 90 seconds a night.
- Or CSV/photo import of a POS end-of-day report via the Copilot (Textract is already wired).
- Unlocks: real menu-engineering matrix (stars/dogs/puzzles/plow-horses — the endpoint
  already exists), true theoretical-vs-actual food cost, dish-level profit trends.

### 2. Smart ordering — "Mise writes tomorrow's order" 💰🏗️
We already have: consumption history (movements), par levels (min_stock), vendor prices,
expected-delivery dates. Combine them:
- Forecast each item's usage from the last 4 same-weekdays (+ party orders on the book).
- Draft indent = forecast × cover-days − current stock, grouped by cheapest/chosen vendor.
- One tap → POs. This is the single biggest daily time-saver a kitchen can get.

### 3. Invoice → GRN 3-way match 💰
Scan the delivery invoice (Textract AnalyzeExpense is live), match lines to the PO:
- price crept? → price-history row + alert (already have the tables)
- short delivery? → auto receive-note
- new item on the bill? → one-tap add.
"Every invoice checked in 10 seconds" is a killer demo and pure margin protection.

### 4. Cash-flow forecast (13-week) 💰
We know: recurring overheads (detection just shipped), payroll run sizes, sales trend,
upcoming party orders. Project the bank line forward 13 weeks with a fan chart +
"tight week" warnings. Owners live in fear of cash gaps — this sells subscriptions.

---

## Tier 2 — strong differentiators, medium effort

### 5. Supplier order sending 🔌
POs today are PDFs the owner forwards. Add "Send to vendor" via email (one SMTP/Resend
account) and/or WhatsApp deep-link (`wa.me/<phone>?text=<PO summary>` needs NO provider —
build the deep-link version now, provider version later). Also unlocks the parked
**payslip share**.

### 6. Reservations & deposits (lite) 🧲🏗️
Not a full booking engine: a day-view diary (tables × time), party-size, phone, deposit
taken y/n, no-show tracking. Feeds the rota (busy Friday → more staff) and party orders.
Owners currently juggle a paper diary next to Mise.

### 7. Staff self-service upgrades 🧲
- Shift swap requests (staff propose, manager approves — rota updates itself)
- Leave/holiday requests with allowance tracking
- Availability ("can't do Tuesdays") that greys cells in the rota builder
- Tip pooling calculator on payroll (tronc split by hours worked)

### 8. Owner's daily digest 🔌(or in-app)
One 8am summary: yesterday's takings vs same day last week, till variance, low stock,
deliveries due, who's on today. In-app notification centre version can ship NOW; the
WhatsApp/email version needs a provider. This is the retention feature — the app that
talks to you every morning doesn't get cancelled.

### 9. Public menu + allergen page (QR) 🧲
We hold recipes + allergens already. Generate a themed public page per hotel
(`/m/<slug>`) with menu, prices, allergen filters + a printable QR table-tent.
Natasha's-law-friendly and free marketing for us (Mise badge in the footer).

---

## Tier 3 — platform & scale (Control Room side)

### 10. Billing & subscriptions (Stripe) 🔌🏗️
Plans/prices/entitlements all exist in the Control Room. Wire Stripe Checkout +
customer portal + webhook → auto-suspend on failed payment (suspend flow already built).
**This is the step that turns Mise into a business.**

### 11. Multi-property groups 🏗️
A group owner sees a roll-up dashboard (all sites' sales/food-cost/labour on one screen),
can switch sites without re-login, and compare sites head-to-head. The tenancy model
(hotel_id everywhere) already supports it; needs a `group_id` + switcher UI.

### 12. Fleet benchmarking (anonymous) 🧲
"Your food cost is 31% — the median curry house on Mise runs 28%." Aggregated, anonymized
Control-Room data turned into a per-hotel insight card. Unique to a platform; impossible
for spreadsheets.

### 13. Integrations shelf 🔌🏗️
Priority order: Deliveroo/UberEats/Just Eat order-report import (CSV first, API later) →
Square/SumUp POS daily import → open-banking feed (TrueLayer) for expense auto-matching.
Each one kills a manual entry chore.

---

## Tier 4 — hardening & polish (continuous)

- **PWA + offline stock-take**: installable icon, cached shell; counts queue offline and
  sync when back — cellars have no signal.
- **Nightly DB backups to S3 + one-command restore drill** (cheap insurance, do soon).
- **VAT summary export** (Making-Tax-Digital-friendly CSV for the accountant).
- **Copilot body plan continues**: proactive nuggets ("Chicken price up 12% this month"),
  more write-actions, voice.
- **Session/device list + 2FA for owners** (security page).

---

## Suggested build order (one line)
Dish counts → smart ordering → invoice match → cash-flow fan → WhatsApp deep-link PO send
→ daily digest (in-app) → staff swaps/leave → QR menu → Stripe → groups → benchmarking.

*Rule of thumb kept from the whole build: money features first, providers last, and
nothing ships without a test + a How-It-Works entry.*
