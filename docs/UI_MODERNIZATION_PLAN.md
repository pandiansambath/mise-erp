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
- [ ] **/expenses — Task B redesign (user: "very clumsy")**: summary header
      (month total, fixed vs variable, top categories as chips), tidy filterable
      table, collapsible manage-categories panel, calmer spacing
- [ ] **/sales**: channel cards w/ commission callouts, till-variance hero
      ("balanced to £0.00" = green pulse), day timeline
- [ ] **/money**: money-in/out flows as animated horizontal bars; petty cash
      drawer visual; carry-over explained inline
- [ ] **/reports**: P&L as the landing's animated bars; food-cost ring; export
      buttons as first-class; budget vs actual meters
- [ ] **/price-comparison**: vendor price matrix → highlight cheapest cell
      (emerald), price-rise cells (amber), sparkline per item price history
      (price_history table already exists!)
- [ ] **/payroll**: payslip cards, run-payroll flow with step feedback

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
