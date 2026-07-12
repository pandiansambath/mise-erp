# 🔥 DEEP PER-SECTION CHECKLIST v2 (user mandate 2026-07-12)

*"Look at each section deeply — neumorphism, charts, other morphisms, extra
features — for LITERALLY ALL sections, then execute one by one, miss none."*

Rules: every box = one deployable unit. Charts = old kit (Spark/Area/Donut/
Bars/Meter) + NEW kit (Treemap/Waffle/RadialBars) + ideas (CalendarHeat,
bullet, bump). Morphisms = neumorphic wells/raised (.mise-well/.mise-raised),
glassmorphism panels (.mise-glass-panel), claymorphism accents for empty
states. Execute top to bottom; tick here; keep UI_MODERNIZATION_PLAN.md as
the phase-level history.

**Cross-cutting shipped 2026-07-12:** interactive Donut (tap slice → pops out,
centre swaps to its value/share → tap again drills down; `onSelect` powers
in-place SUB-CHARTS like money's "Inside Spices" bars) · dot leaders in every
chart legend · RadialBars "+N more · £X" honesty line · CHEF v2 realistic
3D renders in a breathing medallion + docs/CHEF_PROMPTS.md 10-pose pack
(user generating the 4K set — poses 5–10 wiring pending) · platform
announcements broadcast · g-key shortcuts + "?" palette.

## 1 · Dashboard
- [x] Right-side gap fixed (empty-state card, never a hole)
- [ ] CalendarHeat "month rhythm" (needs /reports/sales-trend endpoint — one
      query instead of 31 pnl calls)
- [ ] Greeting row: "service tonight" hint from rota (who's on this evening)
- [ ] Low-stock KPI → mini RadialBars preview on hover (glass popover)
- [ ] Claymorphic empty states (soft 3D blob illustrations) when brand new

## 2 · Sales & Cash
- [ ] CalendarHeat: takings intensity per day of month (needs trend endpoint)
- [ ] Channel cards → mise-well tiles w/ per-channel Sparkline (7d)
- [x] Payment-method split Waffle (how it was paid)
- [ ] Till-count keypad: big neumorphic number pad for counting cash (touch!)
- [ ] Feature: "yesterday vs same day last week" delta chip in the header

## 3 · Expenses
- [x] Donut + share bars + wells (562112c) · [x] Treemap expense map
- [ ] Fixed-vs-variable Waffle strip under the KPIs
- [ ] Petty-cash drawer visual (notes/coins breakdown as Bars)
- [ ] Feature: recurring-expense detection ("Rent looks monthly — auto-remind?")

## 4 · Money
- [x] Waterfall Bars + net counter + stock Donut + budget Meters + £1 Waffle
- [ ] Break-even: bullet chart (actual bar vs target tick) instead of plain bar
- [ ] Price-rise alerts: per-item mini Sparkline inline
- [ ] Feature: monthly "money story" plain-English summary (copilot endpoint)

## 5 · Reports (P&L)
- [x] Donut + Meters + Bars + print/export raised buttons
- [ ] Month-vs-month comparison mode (two ranges side by side, delta column)
- [ ] P&L lines count up on load (AnimatedNumber per PnlLine)
- [ ] Feature: monthly P&L PDF snapshot archive (needs backend)

## 6 · Payroll
- [x] WEEKLY runs + cadence Segmented + tactile (a30475a)
- [ ] Payslip cards: flip/expand morph (card → payslip preview)
- [ ] Run-payroll: per-employee tick cascade while processing
- [ ] Net-pay by person Bars under the table
- [ ] Feature: payslip share (needs email/WhatsApp provider — parked)

## 7 · Inventory
- [x] Task A history + price AreaChart + RadialBars stock rings + well search
- [x] Low-stock rows: soft amber pulse
- [x] Value-on-shelf ticker: AnimatedNumber counts up (currency-aware)
- [x] Category chips → count badges (Meat · 12)
- [x] Reorder nudge strip (N need ordering → Show low / Show out)

## 8 · Stock-take
- [x] ⌘K deep link + spotlight
- [ ] Live variance chip per row while typing (£ impact)
- [ ] Post-apply summary: total shrinkage Waffle
- [ ] Big neumorphic +/- steppers for tablet counting

## 9 · Purchasing
- [x] Tactile buttons (879d060)
- [ ] Indent → PO pipeline as 3-column visual flow (Indent → POs → Received)
- [ ] Consolidated view: per-vendor subtotal Bars
- [ ] Receive drawer: old→new price-change chips highlighted
- [ ] Feature: expected-delivery date on PO + "due today" chip on dashboard

## 10 · Vendors
- [x] Feel cards + well inputs + tactile import buttons
- [ ] Spend-per-vendor Bars (needs /vendors/spend endpoint — 30d PO totals)
- [ ] Price-list table: cheapest-cell emerald highlight
- [ ] Feature: vendor scorecard (price-rise count 90d, order count)

## 11 · Price Comparison
- [x] AreaChart history + tactile
- [ ] Multi-vendor overlay lines (one per vendor, same item)
- [ ] Feature: "switch & save" total (move every item to cheapest = £X/mo)

## 12 · Waste
- [x] Why-binned Donut + most-wasted Bars + 1-click log
- [x] Waste-over-time Sparkline (14d, client-side)
- [ ] Reason picker → big tactile emoji tiles instead of dropdown

## 13 · Recipes
- [x] Plate-cost Donut + KPI wells
- [ ] Margin ladder: all dishes as sorted Bars (green→red) at page top
- [ ] Ingredient Treemap as alternative cost view (toggle)
- [ ] Feature: "what-if" price slider — drag selling price, margin live-updates

## 14 · Party Order
- [x] Tactile buttons + feel cards
- [ ] Per-quote cost/price/margin mini-Bars
- [ ] Feature: quote → printable PDF (print stylesheet)

## 15 · Allergens
- [x] Menu-safety Donut + feel cards
- [x] Allergen frequency Bars (top allergens across dishes)

## 16 · Food Safety
- [x] Temps Donut + today's-checks progress + tactile rows
- [ ] Per-appliance temperature AreaChart (fridge drift over the week)
- [ ] Feature: dashboard nudge chip when today's checks incomplete

## 17 · Employees
- [x] Avatar-initial chips in the table
- [ ] Visa-expiry timeline strip (due 30/60/90 days)
- [x] Pay-mix Donut (hourly vs salaried — weekly vs monthly payroll)

## 18 · Attendance
- [x] Calc transparency (break shown, "12h 30m", live preview, overnight)
- [x] PUNCH CLOCK: hero card w/ chef + giant round neumorphic button + ring ripple
- [ ] Day timeline dots per row (in → break → out)
- [ ] Week heat strip per person (mini CalendarHeat)

## 19 · Rota
- [x] Labour Meter + per-person cost Bars + tactile toolbar
- [ ] Drag-feel shift chips (grab cursor + lift shadow)
- [ ] Break chips on shift cards
- [ ] Copy-week preview: conflict cells highlighted amber

## 20 · Staff
- [x] Avatar chips + well form + tactile
- [ ] Role Donut (how access is spread)
- [ ] Feature: last-login column (backend touch)

## 21 · My (self-service)
- [x] KPI wells
- [ ] Mobile-first mini-app cards (shifts/payslips/docs as swipe cards)
- [ ] My-hours Sparkline (last 4 weeks)

## 22 · Profile
- [x] Raised-press buttons
- [ ] Overheads editor: per-line Bars (share of total overhead)
- [ ] Logo upload: drag-drop well with preview morph

## 23 · Documents
- [x] Raised-press buttons
- [ ] Expiry timeline strip (docs due soon) + type filter chips
- [ ] Upload: drag-drop glass panel w/ progress ring

## 24 · Audit
- [x] Actor avatar chips + action badges
- [x] Events/day Sparkline (14d pulse)
- [x] Filter well (person / action / words)

## 25 · Settings
- [x] Raised-press buttons
- [ ] Sectioned nav (Hotel · Attendance rules · Payments · Channels · Plans)
- [ ] Danger-zone red well card

## 26 · How-It-Works
- [x] 13-topic hub + search + sims + tactile (Task C DONE)
- [ ] Per-topic deep links FROM pages ("how is this worked out?" → hub topic)

## 27 · Onboarding
- [x] Press-feel CTAs
- [ ] Import flow polish: upload → parsed preview → confirm morph
- [ ] Finish screen: ember-confetti burst + dashboard-ready morph

## 28 · Login / Signup
- [x] Cinematic morph gate (f2f0d4f)
- [ ] Liquid-glass form variant test

## 29 · Landing (public)
- [x] Native-res films + mobile cinema band + zero-wait preload (50fa4a0)
- [ ] Liquid-glass pass on feature cards + readability/contrast pass
- [ ] Verify pricing cards read live plan prices from /platform/plans

## 30 · Copilot (Ask Mise)
- [ ] Chat UI: glass panel, message pop-in, typing shimmer (Copilot Body plan)
- [ ] Then brain/hands/legs/ears per [[nirai-copilot-body-plan]]

## 31 · 🛰️ CONTROL ROOM (UI + FEATURES — user priority)
- [x] Suspend/reactivate + login block
- [x] Signups Sparkline + fleet-by-plan Donut + tactile pass
- [ ] UI: dark ops-console identity (denser, mono-heavy, "NASA" feel)
- [ ] Hotel table w/ sort/filter + per-hotel Drawer (replaces long cards)
- [x] FEATURE: announcements/broadcast (platform_announcements table, operator
      composer + withdraw, dismissible shell banner, audited)
- [ ] FEATURE: per-hotel health (last login, sales entries 7d, docs) →
      Active/Quiet/Dormant chips — needs /platform/stats
- [ ] FEATURE: read-only impersonation ("view as hotel") — server-enforced, audited
- [ ] FEATURE: operator audit tab (platform.* timeline)
- [ ] FEATURE: signup funnel (onboarding-completed flag per hotel)
- [ ] Suspension notice on login for suspended hotels (they see WHY)

## 32 · App Shell
- [x] ⌘K actions + glass palette + grouped nav
- [ ] Notification center dropdown (bell → glass panel, mark-read)
- [ ] Mobile bottom tab bar (5 tabs)
- [x] Keyboard shortcuts: g d/i/s/m/r/p jumps + ? opens ⌘K
