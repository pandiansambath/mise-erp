# DineAI — the map every agent reads first

**Read this before touching anything.** It exists because every agent starts
cold, and a cold start that rediscovers the codebase from scratch is both slow
and wrong in predictable ways. Fifteen minutes of reading here is cheaper than
an afternoon of an agent inferring conventions from one file it happened to
open.

Last verified against the repo: **2026-09-15** — 27 routers, 23 model modules,
97 migrations, 91 test files, 71 shared components, 60 tables.

---

## 1. What this is

A multi-tenant restaurant ERP and SaaS for UK restaurants. `dineai.cloud`.
Real restaurants, real payroll, real supplier prices. **It is not a demo** — the
live tenant `nirai1.dineai.cloud` is the owner's own business, and test data
left behind is somebody's actual records polluted.

The thing that makes it valuable is **money**: what a dish costs to make, where
the margin goes, what a supplier charged last month versus this one.

---

## 2. Shape

```
backend/app/<domain>/     router.py · models.py · service.py · schemas.py
backend/alembic/versions/ 97 migrations, single head, ids minted with secrets.token_hex(6)
backend/tests/            91 files, real Postgres, ~812 tests, 83% coverage, 70% floor

frontend/app/(app)/<area>/page.tsx    the tenant app — one file per area
frontend/app/control-room/            the operator area (multi-route, the exception)
frontend/app/t/[code]/                the public table page a diner scans
frontend/app/s/[handle]/              a restaurant's public landing page
frontend/components/                  71 shared components
frontend/lib/                         api.ts, auth.tsx, permissions.ts
```

### Backend domains

`api assistant audit auth billing core custom_fields documents employees events
expenses hotels inventory jobs notifications ordering party payroll
platform_admin purchasing recipes reports rota safety sales selfservice talent
teamchat vendors`

### Frontend areas

`ai-scan allergens attendance audit chat customise dashboard documents employees
expenses food-safety hiring how-it-works inventory kitchen menu messages money
my orders party-order payroll plan price-comparison profile purchasing recipes
reports rota sales settings staff stock-take tables vendors waste`

**Every tenant area is ONE page file.** Areas that do many jobs use
`PageHeader` + `SubNav` (anchor scrolling, not routes) + a `DetailSheet` or
`SheetPopup` for detail. The Control Room is the only multi-route area, and that
was a deliberate departure — see §7.

---

## 3. The conventions that are not optional

**Colour tokens, never literals.** `text-fg`, `text-fg-soft`, `text-fg-faint`,
`bg-shell`, `bg-paper`, `border-line`, `brand-300..700`. A stray `text-white`
once made an entire panel invisible in light theme.

**House surfaces**, all in `app/globals.css`: `mise-card-inset` (the standard
card — inset, not raised), `mise-well` (inputs and sub-blocks), `mise-press`
(on every button), `mise-feel` (hover lift), `mise-pop` / `mise-pop-lg`
(entrance), `mise-glass` (frosted).

**UI laws the owner has stated repeatedly:**
- *"I hate scrolling."* Click, don't scroll. Tiles open popups.
- Never make someone scroll to reach what the page is FOR.
- Use the whole width. Empty rails and half-used space are his most frequent
  complaint. An empty column reads as a broken component, not as spaciousness.
- Fewer clicks ≠ better UX. **Less confusion** = better UX.

**Money law:** quantity is stored in base units; the input is a VIEW. A price
belongs to (vendor × item × FORM) — never divide a box price to get a loose one.

---

## 4. Traps that have each cost a deploy

| Trap | What happens |
|---|---|
| `response_model` drops undeclared fields | Silently. **Nine occurrences.** Declare every field the client needs on the Out schema. |
| `audit_service.record()` takes `user=`, not `user_id=` — and it **COMMITS** | Wrong kwarg is a TypeError; placing it mid-transaction splits that transaction. |
| `Order.updated_at` is `onupdate=func.now()` | Moves on ANY write to the row. Never an event time — stamp a dedicated column once. |
| `from __future__ import annotations` in a **router** | FastAPI reads annotations at runtime; stringised `-> None` broke a 204 and killed the container at import. No other router has it. |
| Hand-picked Alembic revision ids | Collision → "Cycle detected" → CI dead. `secrets.token_hex(6)`, single head. |
| Tailwind runtime class names | `w-[${n}rem]` emits no CSS. Literal strings only. |
| Arbitrary Tailwind breakpoints | Emitted BEFORE named ones. `min-[1800px]:` loses to `xl:`. Named, ascending, only. |
| `npm run lint` skipped | Hook-order and used-before-declared pass `tsc` AND `build`. Four times. |
| Media queries in a scaled preview | They respond to the VIEWPORT, not the element. Needs an iframe. |
| Portals escape ancestor selectors | A popup rendered to `document.body` is outside `.mise-app`. |
| `git add -A` with agents running | Sweeps their in-progress work into your commit. |

---

## 5. Data model — 60 tables

Tenant-owned rows carry `hotel_id`. **Three exceptions that caused a real
outage:** `chats` uses `hotel_a`/`hotel_b`, `chat_messages` uses
`sender_hotel_id`. Any code that assumes `hotel_id` everywhere is wrong.

Worth knowing because they are under-used:
- **`ai_usage`** — cost, tokens, latency, ok flag per AI call, indexed by hotel
  and date. 30-day totals right now: 271 calls, $2.22, zero failures.
- **`audit_events`** — every consequential action in every tenant, with actor
  email. 346 actions, 18 users.
- **`assistant_threads` / `assistant_messages`** — full AI conversations.
  The operator *AI* is deliberately forbidden from reading message bodies; a
  named human opening one thread for support is allowed and is audited.
- **`hotels.subscription_status` / `trial_ends_on`** — exist, barely surfaced.

---

## 6. Infrastructure

One EC2 `t3.micro` + RDS `db.t4g.micro`, eu-west-2, Docker + Caddy, account
`887514555232`. Deploy is `bash scripts/deploy.sh` — **workflow_dispatch only**,
pushing alone does not deploy. ~27 min for the backend suite, ~31 min end to end.

- **Poll the RUN, not `/api/health`** — identical for slow, failed, superseded.
  ~40s backend job = import error; ~27 min = the suite ran.
- `Build images + Terraform apply` is SKIPPED when the test gate fails, which
  means nothing deployed.
- A deploy is a **sub-minute outage** during the container swap.
- CloudWatch: `/dineai/app`, eu-west-2. Export `MSYS_NO_PATHCONV=1` in Git Bash
  or the log-group name gets mangled into a Windows path.
- Cost: ~$25–32/month steady state. ECR lifecycle policy keeps 3 images per repo
  — 896 images / 104 GB / $10 a month accumulated before it existed.

---

## 7. What exists already — do not rebuild it

Months of work. **182 checklist items are done.** Before proposing something,
check whether it is there. Notable:

Inventory with per-vendor stock lots and pack chains · recipes costed to the
gram · purchasing with POs and indents · price comparison and price history ·
sales, petty cash, cash events, P&L reports · employees, attendance with break
penalties, rota, payroll, leave · documents and document requests · food safety
logs · online ordering with a kitchen screen and rider tracking · the public
table page (QR, live menu, order tracker, AI dish assistant, counter chat) ·
party orders and quotes · a talent board with hotel-to-hotel chat · a job
portal · the Mise Copilot (Bedrock) · custom fields with a 56-entry marketplace
for staff and suppliers · per-hotel landing and sign-in page customisation with
a 96-image library · the Control Room operator area.

---

## 8. Verification — the standard here

**Look at the screenshot.** Green assertions have passed on: a menu with zero
dishes, a blank white preview, four grey boxes where food should be, and a
progress bar saying "any moment" on a five-hour-late order. The selector count
lied every time; the picture told the truth.

- Local loop: `cd frontend && npm run build && npx next start -p 3100`, with
  Playwright proxying `**/api/**` to prod. ~15s a cycle instead of 27 minutes.
  Kill port 3100 first (PowerShell `Get-NetTCPConnection -LocalPort 3100`).
- `npm run responsive` sweeps 360/390/768/1024/1440/1920 for objective faults —
  sideways scroll, overflow, clipped text, small tap targets. It cannot tell you
  something is ugly.
- **Two gotchas that waste runs:** the onboarding tour opens over the dashboard
  and swallows the next click (click "Skip tour"); and navigating to a URL right
  after sign-in bounces to `/dashboard` (click the nav instead).

### Logins

- Tenant: `superadmin@gmail.com` / `superadmin@123` — his own restaurant.
  **NOT a platform owner.**
- Operator: `control@mise.app` / `Control@2026` — the Control Room.
  `/api/auth/me` does NOT return `is_platform_owner`; test with
  `GET /api/platform/hotels` returning 200.

**Clean up every artifact you create on his live tenant, and say that you did.**

---

## 9. How the company actually works

`docs/FEEDBACK_2026-09-05.md` is THE checklist — every request he has made, as a
numbered item, in his own words. **Nothing is ticked without evidence it is
deployed and working.** New feedback goes in BEFORE work starts.

**When to use an agent, and when not.** Learned the expensive way: chaining five
agents to build one feature took four sessions for work that used to take one.
Every spawn starts cold and re-derives context the main session already holds.

- **Good:** parallel, read-heavy, small output — surveys, audits, verification,
  watching a 27-minute deploy while other work continues.
- **Bad:** sequential chains, and build work where the main session already has
  the context.

**Never run a git write command from an agent.** The main session owns commits.
