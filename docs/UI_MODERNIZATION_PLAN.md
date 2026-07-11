# MISE — APP-WIDE MODERNIZATION MASTER PLAN ("the jaw-drop pass")

> Written 2026-07-09 after the landing-page rebuild shipped (`f83169d`).
> Goal: every screen a trialing client touches should feel like the landing page
> promised — premium, alive, effortless. UI **and** features, including the
> Control Room. This file is the single source of truth; tick boxes as phases
> ship. Never big-bang: each phase is one batched commit + deploy.

---

## 0. NORTH STAR & DESIGN DNA (carry from the landing)

- **Palette**: ink-950 base · emerald `brand-*` for action/health · copper for
  money/warmth · amber for warnings. Light mode must stay first-class (the app
  has a theme switcher — every change verified in BOTH modes).
- **Type**: Fraunces (display) for page titles & big numbers · Geist for body ·
  Geist Mono for every figure, code, timestamp.
- **Signature moves**: aurora light (subtle, `Aurora` component — NOTE: it is
  self-clipping; never put `overflow-hidden` on a section with sticky children),
  count-up numbers, self-drawing SVG charts, live-row pulses (`mise-l-live-row`,
  `mise-l-blip`), staggered reveals (`Reveal`, `mise-slide-stagger`), magnetic
  primary buttons, glass cards (`backdrop-blur` sparingly on mobile).
- **The feel**: "the machine is running" — nothing static, nothing dead, but
  60fps: transform/opacity only, IntersectionObserver-gated, timers only while
  visible.
- **Performance guardrails**: no per-frame React state on scroll (refs + direct
  style writes), `content-visibility` for long pages, lazy heavy panels.

## 🫧 LIQUID GLASS PASS (user 2026-07-09: Apple's liquid-glass design → landing too) — QUEUED
Apple 2025 "Liquid Glass" language, translated to the web: translucent panels that
REFRACT what's behind them. Recipe per surface: layered `backdrop-blur + saturate`,
a 1px inner light rim (inset top highlight), soft specular sweep that follows
hover/tilt, edge gradients that bend the backdrop color. Apply to: landing nav,
dashboard-sim window, Copilot chat card, feature-tour panel, pricing cards, chips —
then reuse the same tokens for in-app cards. Keep GPU budget in mind on mobile
(blur is expensive — desktop-first, cheaper fallback on phones).

## 🌗 AUDIENCE & THEME DECISION (2026-07-09, discussed with user)
Landing + auth stay DARK (cinematic brand, matches all AI film assets; premium-SaaS
norm) — aurora is a KEEPER per user. The accommodation for older hotel owners is a
READABILITY PASS, not a light theme: body copy ≥ slate-200 on dark, generous type
sizes, strong veils under text on imagery, no long reading on busy backgrounds.
The in-app workspace keeps its existing light/dark switcher (owners doing hours of
data entry can choose). Revisit only if real prospect feedback asks for light.

## 📊 CHARTS & DATA-VIZ MANDATE (user 2026-07-09: "add pie charts, bar charts, statistics — whatever you can")
Every page that shows data gets AT LEAST one visualization. Hand-rolled animated
SVG (components/charts.tsx) — no chart library, self-drawing on scroll-into-view,
theme-aware via tokens. The vocabulary:
- **Donut/pie** → composition (expense categories, sales by channel, stock by category)
- **Bars** → comparison (vendor spend, dish margins, staff hours)
- **Line/area + sparkline** → trends (sales 14d, price history, cash position)
- **Meter** → target vs actual (food cost %, labour %, budgets)

## 🫳 TACTILE DESIGN SYSTEM (user 2026-07-10: neumorphism? → HYBRID decided)
Pure neumorphism rejected (needs flat mono bg → kills aurora/glass/films; weak
contrast; bad in dark). We take its SOUL — touch-feel — as a token-driven layer
that works in BOTH themes:
- `.mise-well`   → neumorphic INSET wells for inputs/search/filter tracks
- `.mise-raised` → soft-raised interactive surfaces (buttons, pills, thumbs)
- press-in on :active everywhere (mise-press + inset shadow swap)
- `Segmented` control: well track + raised sliding thumb (spring ease)
- `Toggle`: springy knob w/ overshoot; `Checkbox`: tick draws itself
Glass (.mise-glass) stays for overlays/feature cards; flat+hairline for tables.

### ⚠️ NO SECTION LEFT FLAT (user 2026-07-11, repeated twice — hard rule)
The tactile kit (.mise-well / .mise-raised / .mise-feel / Button / Segmented /
Toggle + hover-lift & press-in motion) must reach EVERY page — dashboard ✓,
expenses ✓, sales ✓ … and still owed to: inventory, stock-take, purchasing,
vendors, price-comparison, waste, recipes, party-order, allergens, food-safety,
money, reports, payroll, employees, attendance, rota, staff, documents, audit,
settings, profile, my, how-it-works, onboarding, CONTROL ROOM. When touching
any page for any reason, apply the kit before closing the task.

### Per-section motion & style map (apply while doing each phase)
- **Dashboard**: stat cards w/ count-up + sparklines + delta chips; aurora header band; greeting types itself
- **Inventory**: rows hover-lift + press → item Drawer (Task A history+chain); stock Meters; LOW badge pulse; stagger-in list
- **Purchasing**: PO cards raised w/ status chip pulse; receive = press-hold morph → success tick draw; indent→PO split animation
- **Sales & cash**: till reconcile = "balance" moment (scales settle + tick draws + count-up to £0.00 variance); channel Donut
- **Expenses (Task B)**: summary header w/ Donut + top-category chips; well filters; entries stagger
- **Money**: in/out waterfall Bars; net counter; month scrubber w/ sliding thumb
- **Reports**: chart kit everywhere (Donut/Bars/Area/Meter); print/export raised buttons
- **Rota**: shift pills raised (grab-feel), week grid sliding selection; copy-week ghost preview slides in
- **Attendance**: punch clock = BIG tactile button (deep press + ring ripple); day timeline dots
- **Payroll**: payslip cards flip/expand; run-payroll progress with per-employee tick cascade
- **Staff/Employees/My**: avatar chips, doc cards w/ expiry meter; self-service = mobile-first wells
- **Settings/Profile**: Segmented controls, wells, theme switch springy
- **Copilot**: orb everywhere consistent; chat glass
- **Control Room**: same tactile kit on operator console + Phase 8 features
Transitions: route mount = rise+fade stagger; drawers slide; tabs = thumb glide;
every list staggers 40ms/row (cap 8); numbers always AnimatedNumber.

## ✨ INTERACTION STANDARDS ("jaw-dropping, not just OK" — apply everywhere)
- Buttons: hover lift + shine sweep, **press-down scale** (.mise-press), busy state morphs to spinner-in-button
- Numbers NEVER pop in — always AnimatedNumber count-up
- Rows/cards: hover lift + border glow; NEW rows slide-in; deleted rows collapse
- Tabs/segmented controls: sliding active indicator (not color-swap only)
- Toggles: springy knob; checkboxes: draw-in tick
- Panels/drawers: slide+fade with spring easing, never instant
- Skeleton shimmer while loading; EmptyStates always designed with a CTA
- Focus-visible rings on everything (accessibility = premium)

## DEFINITION OF DONE — every page must pass this checklist
- [ ] Reads correctly in dark AND light mode
- [ ] Mobile (390px), tablet (768px), desktop (1280px+) verified via Playwright screenshots
- [ ] Page title in Fraunces + consistent PageHeader pattern
- [ ] Numbers count up on first view; money in mono + copper accents
- [ ] Loading = skeleton shimmer (never a lone spinner); empty state = designed
      (icon + one-liner + primary CTA), not "No data"
- [ ] Hover/focus states on every interactive element; focus-visible rings
- [ ] No layout shift; `npm run lint` + `tsc` + build clean

---

## PHASE 0 — FOUNDATIONS (shared kit upgrade, do FIRST)
*Everything later leans on this. `components/ui.tsx` is tiny today
(Card/StatCard/PageHeader/Badge) — grow it into a real kit.*

- [ ] **PageHeader v2**: Fraunces title, breadcrumb-ish context line, right-side
      action slot, optional live-dot status
- [ ] **StatCard v2**: count-up value, delta chip (↑/↓ tinted), optional
      sparkline (reuse landing's SVG pattern), copper/emerald tone prop
- [ ] **Skeleton**: shimmer blocks for tables/cards (replace all bare Spinners)
- [ ] **EmptyState**: illustration-ish emoji tile + headline + body + CTA button
- [ ] **DataTable primitives**: consistent row hover, sticky header, sortable
      column caret, right-aligned mono numerics, per-row action menu (⋯)
- [ ] **Drawer/Sheet**: slide-over panel (desktop right, mobile bottom-sheet)
      — needed by Inventory item history (Task A), Control Room hotel view, etc.
- [ ] **AnimatedNumber**: shared count-up hook/component (landing has 3 copies)
- [ ] **Toast**: success/error slide-in bottom-right (replace inline-only msgs)
- [ ] **Aurora + mise-l-* CSS**: export from a shared place for app pages (they
      live in landing/premium/bits — lift to components/fx.tsx)
- [ ] Motion tokens: standard durations/easings documented in globals.css header

## PHASE 1 — FIRST IMPRESSIONS (login · signup · onboarding)
*Small pages, huge trust impact. Bring to landing parity.*

- [ ] **/login**: aurora is there; add the landing's dot-grid + a cinematic
      side panel on lg+ (dish/fire still with veil + brand line), magnetic
      submit, shake-on-error, password visibility toggle, caps-lock hint,
      "Continue as demo" if we ever seed a demo hotel
- [ ] **/signup**: same visual family; multi-step feel (hotel → owner → done)
      with the landing's step animations; success = confetti-light + straight
      into onboarding
- [ ] **/onboarding**: already has wizard steps — polish to landing bar; add
      "import with Copilot" card up front (Task 8 tie-in: template/AI import)

## PHASE 2 — THE APP SHELL (every page inherits this)
- [ ] Sidebar: active item gets emerald glow bar + icon tint; section groups
      (Operate / Money / People / Know) with tiny mono group labels; collapsed
      mode remembers preference; hotel logo + plan badge at top
- [ ] Topbar: global **⌘K command palette** (jump to any page, action verbs:
      "new PO", "add expense", "ask Copilot…") — NEW FEATURE, big wow
- [ ] **Notification center**: bell → slide-over listing low-stock, price-rise,
      doc-expiry, PO events (backend already emits these signals on dashboard;
      aggregate into one feed endpoint if needed)
- [ ] Page transitions: subtle fade/slide between routes (no jank)
- [ ] Mobile: bottom tab bar for top 5 destinations (Dashboard, Inventory,
      Sales, Rota, Copilot) — field-usability win for owners on phones

## PHASE 3 — DASHBOARD (the daily first screen)
- [ ] Hero row: Fraunces greeting + service-day context ("Tue · dinner service")
- [ ] KPI StatCards v2 with sparklines + deltas (net sales, net profit, food
      cost %, labour %, covers)
- [ ] Live activity feed styled like the landing sim (icons, timestamps, pulse)
- [ ] Alerts rail: low stock / price rises / doc expiries as actionable chips
      (click → deep link with the item pre-focused)
- [ ] A "Copilot says" insight card (reuse assistant summary endpoint)
- [ ] 14-day sales chart = self-drawing SVG (landing pattern), not a static lib

## PHASE 4 — MONEY CLUSTER (sales · expenses · money · reports · price-comparison · payroll)
- [x] **/expenses — Task B redesign (user: "very clumsy")**: ✅ 562112c donut +
      per-category share bars + wells + Button kit + skeletons
- [x] **/sales**: ✅ 562112c channel donut + till-balanced self-drawing tick
- [x] **/money**: ✅ in/out waterfall Bars + AnimatedNumber net counter + stock
      Donut + budget Meters + tactile cards (this run)
- [x] **/reports**: ✅ where-money-went Donut + health Meters + expense Bars +
      raised export/print buttons + animated net (this run)
- [ ] **/price-comparison**: vendor price matrix → highlight cheapest cell
      (emerald), price-rise cells (amber), sparkline per item price history
      (price_history table already exists!)
- [x] **/payroll**: ✅ WEEKLY pay runs (ISO weeks, hourly staff, advances
      next-pay rule) + neumorphic cadence Segmented + week picker + Button/well
      kit. Payslip-card flip + tick cascade still open (Phase 6 polish)

### ⌘K 2.0 (shipped this run)
- [x] Light-glassmorphism panel (.mise-glass-panel — frosted white in light mode)
- [x] ONE-CLICK ACTIONS: create recipe / copy rota / record takings / add
      expense / new PO / low stock / add employee / stock take — deep links
      REALLY fire now (useDeepLink + spotlight copper-ring pulse on the form)
- [x] Sub-suggestions: searching nests actions under their parent page (↳)

### Attendance calc fix (user bug, shipped this run)
- [x] Break always visible when >0 (was hidden after manual edits — the "10.50"
      mystery); hours shown as "12h 30m"; live math preview in Edit dialog;
      overnight shifts roll past midnight; clock-out mid-break folds break in

## PHASE 5 — OPS CLUSTER (inventory · purchasing · vendors · recipes · party-order · stock-take · waste · allergens · food-safety)
- [ ] **/inventory — includes Task A**: per-item Drawer = one-stop history
      (stock, avg cost, chosen supplier, purchase TIMELINE; click an entry →
      the full RECEIPT/chain of items delivered together via reference_id)
- [ ] **/inventory**: low-stock rows pulse amber; value-on-shelf ticker;
      lot/stock-lot visual per vendor
- [ ] **/purchasing**: indent → PO pipeline as a visual flow (three columns:
      Indent → POs by vendor → Received), status chips animated
- [ ] **/recipes**: cost breakdown per dish like the landing mock (ingredient
      rows + GP badge + re-costs-live note); margin health color scale
- [ ] **/vendors**: vendor cards w/ spend sparkline, price-list import CTA
- [ ] **/party-order, /stock-take, /waste, /allergens, /food-safety**: bring to
      kit standard (headers, tables, empty states, skeletons) + small live touches

## PHASE 6 — PEOPLE CLUSTER (employees · staff · attendance · rota · my · profile)
- [ ] **/rota**: week grid with drag-feel polish, labour % meter live under the
      grid, copy-last-week button prominent, break chips
- [ ] **/attendance**: punch timeline per day, late/absent tinting, penalty
      config surfaced clearly
- [ ] **/employees + /staff**: person cards w/ avatar initials, role badges,
      doc-expiry warnings inline
- [ ] **/my** (self-service): make it feel like a mini-app: my shifts, my
      payslips, my documents — mobile-first cards
- [ ] **/profile**: cleanup to kit standard

## PHASE 7 — KNOWLEDGE & SYSTEM (how-it-works · documents · settings · audit)
- [ ] **/how-it-works — Task C (user's ⭐MAIN)**: full knowledge HUB — topic
      cards/accordion: formula in mono block + REAL worked example + "Still
      confused? Ask Mise" button that opens Copilot pre-seeded with the topic.
      Cover: weighted-avg cost, purchasing loop, rota/labour %, recipe costing,
      P&L, Sales-vs-Expenses-vs-Money difference
- [ ] **/documents**: grid/list toggle, preview thumbnails, expiry timeline
- [ ] **/settings**: sectioned nav (Hotel, Users & roles, Attendance rules,
      Payment methods, Plans/feature flags view), each section kit-standard
- [ ] **/audit**: readable event stream w/ actor chips + diff-style detail

## PHASE 8 — 🛰️ CONTROL ROOM 2.0 (UI **and** features)
*Today: hotel cards + feature toggles + plan apply + password reset. Make it a
real operator console.*

**UI**
- [ ] Dark ops-console look (own identity: denser, mono-heavy, "NASA" feel)
- [ ] Hotel table w/ sort/filter/search + per-hotel Drawer (replaces long cards)
- [ ] Platform stat header: hotels by plan, total users, signups sparkline

**FEATURES (new backend + UI)**
- [ ] **Platform analytics**: GET /platform/stats — hotels count by plan,
      new signups over time, per-hotel activity (last login, sales entries this
      week, doc count) → "health" column (Active / Quiet / Dormant)
- [ ] **Announcements/broadcast**: operator writes a message (+level info/warn,
      optional expiry) → banner shown in every hotel's app shell; table
      `platform_announcements`; dismiss-per-user
- [ ] **Plan editor**: edit plan price_hint/max_users/highlights from the UI
      (bits exist server-side; give it a proper editor with preview of the
      landing pricing card)
- [ ] **Impersonation ("view as hotel")**: short-lived read-only token to open
      a hotel's app for support — server-enforced read-only + audit-logged
- [ ] **Suspend / reactivate hotel**: is_active already exists — expose with
      confirm + suspension banner in that hotel's app
- [ ] **Operator audit log**: every Control Room action (toggle, plan change,
      reset, impersonate) recorded + visible in a CR tab
- [ ] **Signup funnel view**: recent signups w/ onboarding-completed flag —
      who stalled at an empty dashboard (feeds Task 8 onboarding wizard)

## CROSS-CUTTING NEW FEATURES (sprinkle where they land naturally)
- [ ] ⌘K command palette (Phase 2) — also on mobile via search icon
- [ ] Notification center (Phase 2)
- [ ] Global keyboard shortcuts (g d → dashboard, g i → inventory, ? → help)
- [ ] PWA manifest + icons ("install Mise" on phones/tablets — kitchen tablets!)
- [ ] Print stylesheets for PO / payslip / P&L (owners print these)
- [ ] Per-table CSV/Excel export buttons wherever missing
- [ ] Session/device list + "sign out everywhere" in profile (JWT bump)

---

## EXECUTION ORDER & LOGISTICS
1. Phase 0 → 1 → 2 → 3 first (foundation + funnel + shell + daily screen), then
   4 → 5 → 6 → 7 → 8. Control Room (8) can interleave earlier if user asks.
2. One batched commit per phase w/ `[skip ci]`; deploy.yml runs its own gate.
   Deploy = "Deploy (eu-west-2)" on main (user must name/confirm the target
   per session; token pattern-extracted from github_token.txt, never printed).
3. Verify per phase: lint + tsc + build + Playwright screenshots (mobile/tablet/
   desktop, dark AND light) + e2e smoke.
4. Backend work rides along per phase (analytics/announcements/impersonation
   endpoints) with pytest coverage ≥ existing gate.
5. Update this file's checkboxes + memory after every phase.
