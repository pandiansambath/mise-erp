# Mise — Architecture & full feature catalogue

A single reference describing what Mise is, how it's built, and every feature — enough
to understand, operate, or rebuild the product. Pair with [RECREATE.md](RECREATE.md)
(rebuild steps) and [BACKUP.md](BACKUP.md) (data).

## What it is
**Mise** ("mise en place") is a UK restaurant ERP/SaaS. Its core value is **money** —
every plate, every penny: costs, margins and profit from live data. Multi-tenant: each
**hotel** (restaurant) is isolated; users belong to one hotel and only ever see/act on
that hotel's data.

## Stack
- **Backend:** FastAPI, async SQLAlchemy 2.0, Alembic migrations, Pydantic. Modular
  monolith under `backend/app/<module>`.
- **Frontend:** Next.js 16 (App Router), React 19, Tailwind v4, TypeScript. App pages
  under `frontend/app/(app)/<route>`; landing at `frontend/app/page.tsx`.
- **Data:** PostgreSQL 16 (RDS). Files in S3.
- **Infra:** AWS — EC2 t3.micro + Docker (Caddy reverse-proxy + backend + frontend),
  RDS Postgres, S3 uploads, Elastic IP. Terraform in `infra/`. CI/CD via GitHub Actions
  (`.github/workflows/deploy.yml`) → ECR images → `terraform apply` → cloud-init
  re-creates the box and `docker compose up`.
- **Auth/RBAC:** JWT login; role-based permissions enforced per endpoint; every query
  scoped by `hotel_id`.
- **AI:** Mise Copilot (Google Gemini) — see `backend/app/assistant/` and
  the `nirai-copilot` memory.

## Backend modules (`backend/app/`)
| Module | Responsibility |
|---|---|
| `auth` | Login, JWT, users, roles/permissions (RBAC), deps (`get_current_user`). |
| `hotels` | Tenant (hotel) records, signup/registration, settings. |
| `inventory` | Stock items, quantities, weighted-average cost, min/par, allergens, supplier links; stock-take. |
| `vendors` | Suppliers, the items each prices, chosen supplier per item, price comparison. |
| `recipes` | Dishes costed to the gram from live ingredient prices; selling price + margin; allergen inheritance. |
| `purchasing` | Indents (buy requests) → purchase orders → receive stock; per-vendor stock lots. |
| `sales` | Daily sales by channel (dine-in/delivery), cash, till reconciliation; delivery commission netting. |
| `expenses` | Fixed + variable costs feeding the P&L; categories. |
| `reports` | P&L for any date range (PDF export); dashboard aggregates. |
| `employees` | Staff records, pay, contract, visa expiry, documents. |
| `payroll` | Gross/overtime/deductions/net pay, payslips. |
| `rota` | Shift planning + projected labour cost %. |
| `safety` | Food-safety temp logs + HACCP-style checklists. |
| `documents` | Document store with expiry reminders + document requests. |
| `selfservice` | Staff self-service area (clock in/out, own payslips). |
| `audit` | Audit trail (who did what, when). |
| `assistant` | Mise Copilot — knowledge, tools, write-actions, document ingest, provider. |
| `events` | Realtime updates (e.g. PO status). |
| `core` | Config, database, RBAC helpers, common utilities. |
| `api` / `main.py` | Router wiring + app entrypoint. |

## App pages (`frontend/app/(app)/`)
dashboard, money, reports, inventory, stock-take, purchasing, vendors,
price-comparison, recipes, allergens, food-safety, waste, sales, expenses,
employees, attendance, rota, payroll, documents, staff, audit, my (self-service),
profile, settings.

## The "money" surfaces (often confused — clarified)
- **Sales & Cash** — money IN (daily takings by channel).
- **Expenses** — money OUT (rent, food, utilities, packaging…).
- **Reports (P&L)** — the formal in−out statement for a date range (PDF).
- **Money** — a live command-centre dashboard summarising the above: net profit,
  food-cost %, stock value, waste, break-even, food-cost variance, supplier price-rise
  alerts. (Planned cleanup in task 2.2: merge/clarify + petty cash + payment methods.)

## Multi-tenant isolation (critical)
Every request resolves the user from their JWT (`get_current_user`) → one `hotel_id`.
Every read/write (including the Copilot's tools, actions and document ingest) filters by
`user.hotel_id`. No endpoint accepts a hotel id from the client. One hotel's data can
never appear in another's screens or AI.

## Deploy model & known caveats
- Deploys **replace the EC2 box** (image tag is in user_data), ~7 min, IP stays (EIP).
- Caddy auto-HTTPS; cert currently re-issues per deploy → **persist via S3** before
  re-enabling the http→https redirect (see `nirai-https-domain`).
- **Back up the DB before each deploy** (box replacement); see [BACKUP.md](BACKUP.md).

## Migrations
`backend/alembic/versions/` (21 revisions as of 2026-06-26). Backend runs
`alembic upgrade head` on boot, so a fresh box self-migrates to the latest schema.
