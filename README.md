# Mise — Restaurant ERP & Intelligence

> Cloud ERP that tells a restaurant **where its money is going** — inventory cost,
> vendor price comparison, recipe/dish profitability, and a live P&L — plus staff,
> payroll, sales, and documents. First client: **NIRAI** (South + North Indian, UK).

## Why it exists
Restaurants bleed money without knowing why: nobody compares vendor prices, nobody
knows the true cost of a plate of biryani, and the books live in Excel and WhatsApp.
Mise connects **purchases → stock → recipe cost → menu margin → P&L** so the owner
can see profit in real time. Flagship feature: **upload a vendor invoice and AI
fills in the line items and updates prices automatically.**

## Stack
| Layer | Tech |
|-------|------|
| Backend | Python **FastAPI**, SQLAlchemy 2.0 (async), Alembic, Pydantic v2 |
| Frontend | Next.js 14 + TypeScript + Tailwind/shadcn (added in a later slice) |
| Database | PostgreSQL 16 |
| Tests | pytest + httpx (backend), Playwright (E2E) |
| Infra | Docker, Terraform, AWS App Runner + RDS (eu-west-2), GitHub Actions CI/CD |

## Architecture
Modular monolith (one FastAPI app, modules per domain), container-first so local
and cloud are identical. Background jobs designed to peel off to Lambda later.

## Local development
```bash
docker compose up --build         # starts Postgres + backend
curl http://localhost:8000/api/health        # -> {"status":"ok",...}
curl http://localhost:8000/api/health/db      # -> {"db":"reachable"}

# Migrations
docker compose exec backend alembic upgrade head
docker compose exec backend alembic current

# Tests
docker compose exec backend pytest
```

## Repository layout
```
backend/      FastAPI app (app/), Alembic migrations, tests
frontend/     Next.js app (added later)
infra/        Terraform for AWS (added later)
docs/         Planning docs & blueprint
.github/      CI/CD workflows
```

## Security
Secrets and real client data are **never** committed (see `.gitignore`). PII
(NI numbers, bank details) will be encrypted at rest; UK GDPR applies.
