# 🔥 DEEP PER-SECTION CHECKLIST v2 (user mandate 2026-07-12)

*"Look at each section deeply — neumorphism, charts, other morphisms, extra
features — for LITERALLY ALL sections, then execute one by one, miss none."*

Rules: every box = one deployable unit. Charts = old kit (Spark/Area/Donut/
Bars/Meter) + NEW kit (Treemap/Waffle/RadialBars) + ideas (CalendarHeat,
bullet, bump). Morphisms = neumorphic wells/raised (.mise-well/.mise-raised),
glassmorphism panels (.mise-glass-panel), claymorphism accents for empty
states. Execute top to bottom; tick here; keep UI_MODERNIZATION_PLAN.md as
the phase-level history.

**LIVING CHARTS (user 2026-07-12: "charts are very raw — add life"):** every
chart type now has an INSTANT glass tooltip that follows the cursor — Area/
Sparkline show the date + value with a crosshair dot, Donut slices show value
+ share, Bars rows highlight + show share, Waffle squares, Treemap boxes,
RadialBars rings, CalendarHeat days ("Sat 5 Jul · £1,240"), Meter shows
now-vs-target. No more browser title bubbles anywhere.

**Cross-cutting shipped 2026-07-12:** interactive Donut (tap slice → pops out,
centre swaps to its value/share → tap again drills down; `onSelect` powers
in-place SUB-CHARTS like money's "Inside Spices" bars) · dot leaders in every
chart legend · RadialBars "+N more · £X" honesty line · CHEF v2 realistic
3D renders in a breathing medallion + docs/CHEF_PROMPTS.md 10-pose pack
(user generating the 4K set — poses 5–10 wiring pending) · platform
announcements broadcast · g-key shortcuts + "?" palette.

## 1 · Dashboard
- [x] Right-side gap fixed (empty-state card, never a hole)
- [x] CalendarHeat "month rhythm" — GitHub-style takings heatmap, fed by the
      NEW /reports/sales-trend endpoint (dashboard's 7 pnl calls → 1 query)
- [x] "N on service today: Wes, Sam +2" rota chip in the greeting row
- [ ] Low-stock KPI → mini RadialBars preview on hover (glass popover)
- [x] Chef empty states: shrugging maître fronts EVERY EmptyState app-wide

## 2 · Sales & Cash
- [x] CalendarHeat on sales page (takings rhythm, last 10 weeks)
- [ ] Channel cards → mise-well tiles w/ per-channel Sparkline (7d)
- [x] Payment-method split Waffle (how it was paid)
- [ ] Till-count keypad: big neumorphic number pad for counting cash (touch!)
- [x] "vs same weekday last week" delta chip beside the date picker

## 3 · Expenses
- [x] Donut + share bars + wells (562112c) · [x] Treemap expense map
- [x] Fixed-vs-variable Waffle (each square = 1% of spend)
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
- [x] P&L lines count up on load (currency-aware AnimatedNumber)
- [ ] Feature: monthly P&L PDF snapshot archive (needs backend)

## 6 · Payroll
- [x] WEEKLY runs + cadence Segmented + tactile (a30475a)
- [ ] Payslip cards: flip/expand morph (card → payslip preview)
- [ ] Run-payroll: per-employee tick cascade while processing
- [x] Net-pay by person Bars under the table
- [ ] Feature: payslip share (needs email/WhatsApp provider — parked)

## 7 · Inventory
- [x] Task A history + price AreaChart + RadialBars stock rings + well search
- [x] Low-stock rows: soft amber pulse
- [x] Value-on-shelf ticker: AnimatedNumber counts up (currency-aware)
- [x] Category chips → count badges (Meat · 12)
- [x] Reorder nudge strip (N need ordering → Show low / Show out)

## 8 · Stock-take
- [x] ⌘K deep link + spotlight
- [x] Live variance chip per row while typing (was already live — verified)
- [ ] Post-apply summary: total shrinkage Waffle
- [x] Big neumorphic − / + steppers per row (tablet counting)

## 9 · Purchasing
- [x] Tactile buttons (879d060)
- [x] Pipeline strip: Indents raised → Approved → POs out → Received (tactile stages w/ counts)
- [ ] Consolidated view: per-vendor subtotal Bars
- [ ] Receive drawer: old→new price-change chips highlighted
- [ ] Feature: expected-delivery date on PO + "due today" chip on dashboard

## 10 · Vendors
- [x] Feel cards + well inputs + tactile import buttons
- [x] Spend-per-vendor Bars ("who gets your money", 90d received POs)
- [ ] Price-list table: cheapest-cell emerald highlight
- [ ] Feature: vendor scorecard (price-rise count 90d, order count)

## 11 · Price Comparison
- [x] AreaChart history + tactile
- [ ] Multi-vendor overlay lines (one per vendor, same item)
- [x] Switch & save strip: N items off their cheapest supplier = £X/unit saved

## 12 · Waste
- [x] Why-binned Donut + most-wasted Bars + 1-click log
- [x] Waste-over-time Sparkline (14d, client-side)
- [x] Reason picker → tactile emoji tiles

## 13 · Recipes
- [x] Plate-cost Donut + KPI wells
- [x] Margin ladder: top-10 dishes as colour-coded Bars at page top
- [ ] Ingredient Treemap as alternative cost view (toggle)
- [x] What-if price slider — drag the price, margin/profit update live

## 14 · Party Order
- [x] Tactile buttons + feel cards
- [x] Per-quote cost-vs-profit split bar on every quote card
- [ ] Feature: quote → printable PDF (print stylesheet)

## 15 · Allergens
- [x] Menu-safety Donut + feel cards
- [x] Allergen frequency Bars (top allergens across dishes)

## 16 · Food Safety
- [x] Temps Donut + today's-checks progress + tactile rows
- [x] Temperature-drift AreaChart for the most-logged appliance (°C over time)
- [ ] Feature: dashboard nudge chip when today's checks incomplete

## 17 · Employees
- [x] Avatar-initial chips in the table
- [x] Visa runway strip: Expired / ≤30 / 31–60 / 61–90 day buckets w/ people
- [x] Pay-mix Donut (hourly vs salaried — weekly vs monthly payroll)

## 18 · Attendance
- [x] Calc transparency (break shown, "12h 30m", live preview, overnight)
- [x] PUNCH CLOCK: hero card w/ chef tapping his watch + giant round neumorphic button + ring ripple
- [x] Day-strip per row (06:00–24:00, shift filled; amber while still working)
- [ ] Week heat strip per person (mini CalendarHeat)

## 19 · Rota
- [x] Labour Meter + per-person cost Bars + tactile toolbar
- [x] Shift chips = tactile wells w/ lift (week strip already drag-scrolls)
- [x] Break minutes shown on shift cards (verified existing)
- [x] Copy-week conflicts: amber ring on clashing rows + skip/replace (badges existed)

## 20 · Staff
- [x] Avatar chips + well form + tactile
- [x] Role Donut (who can do what)
- [x] Last-seen column (login stamps users.last_login)

## 21 · My (self-service)
- [x] KPI wells
- [ ] Mobile-first mini-app cards (shifts/payslips/docs as swipe cards)
- [x] My-hours Sparkline (last 4 weeks, hover shows the day)

## 22 · Profile
- [x] Raised-press buttons
- [ ] Overheads editor: per-line Bars (share of total overhead)
- [ ] Logo upload: drag-drop well with preview morph

## 23 · Documents
- [x] Raised-press buttons
- [x] Type filter chips w/ counts (expiry alerts strip already existed)
- [ ] Upload: drag-drop glass panel w/ progress ring

## 24 · Audit
- [x] Actor avatar chips + action badges
- [x] Events/day Sparkline (14d pulse)
- [x] Filter well (person / action / words)

## 25 · Settings
- [x] Raised-press buttons
- [x] Section jump-nav pills (Display · Attendance rules · Payroll · Account) + wells/feel
- [ ] Danger-zone red well card

## 26 · How-It-Works
- [x] 13-topic hub + search + sims + tactile (Task C DONE) + books-chef tutor
- [x] "How is this worked out?" links from Reports (Money/Payroll had them)

## 27 · Onboarding
- [x] Press-feel CTAs
- [ ] Import flow polish: upload → parsed preview → confirm morph
- [x] Finish screen: ember-confetti burst + serve-chef presenting the dashboard
- [x] Welcome step: chef welcome pose greets new owners

## 28 · Login / Signup
- [x] Cinematic morph gate (f2f0d4f)
- [ ] Liquid-glass form variant test

## 29 · Landing (public)
- [x] Native-res films + mobile cinema band + zero-wait preload (50fa4a0)
- [ ] Liquid-glass pass on feature cards + readability/contrast pass
- [ ] Verify pricing cards read live plan prices from /platform/plans

## 30 · Copilot (Ask Mise)
- [x] Chef in the chat header — thinks while answering, beams when done
- [x] Chat panel = theme-aware liquid glass (.mise-glass-panel)
- [ ] Typing shimmer + message polish (Copilot Body plan continues)
- [ ] Then brain/hands/legs/ears per [[nirai-copilot-body-plan]]

## 31 · 🛰️ CONTROL ROOM (UI + FEATURES — user priority)
- [x] Suspend/reactivate + login block
- [x] Signups Sparkline + fleet-by-plan Donut + tactile pass
- [ ] UI: dark ops-console identity (denser, mono-heavy, "NASA" feel)
- [ ] Hotel table w/ sort/filter + per-hotel Drawer (replaces long cards)
- [x] FEATURE: announcements/broadcast (platform_announcements table, operator
      composer + withdraw, dismissible shell banner, audited)
- [x] FEATURE: per-hotel health chips — Active (traded/logged in ≤3d) /
      Quiet (≤14d) / Dormant, from last_login + sales entries 7d
- [ ] FEATURE: read-only impersonation ("view as hotel") — server-enforced, audited
- [ ] FEATURE: operator audit tab (platform.* timeline)
- [ ] FEATURE: signup funnel (onboarding-completed flag per hotel)
- [ ] Suspension notice on login for suspended hotels (they see WHY)

## 32 · App Shell
- [x] ⌘K actions + glass palette + grouped nav
- [ ] Notification center dropdown (bell → glass panel, mark-read)
- [ ] Mobile bottom tab bar (5 tabs)
- [x] Keyboard shortcuts: g d/i/s/m/r/p jumps + ? opens ⌘K
