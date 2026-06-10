# Mise — Master Guide (end-to-end + deploy runbook)

The single source of truth for **what Mise is, how the code is laid out, how to
run it locally, and how to ship a change to production.** If you are a new
engineer/AI picking this up: read this top to bottom once.

> Sister docs: `HOW_IT_WORKS.md` (plain-English feature explanations),
> `NIRAI_Technical_Blueprint.md` (deep technical spec), `ROADMAP.md` (what's next),
> `LANDING_PAGE_FILES.md` (landing-page redesign file list).

---

## 1. What Mise is
A multi-tenant **restaurant ERP / SaaS** for UK restaurants (first client:
NIRAI). Core value = **money**: vendor price comparison, recipe costing, P&L,
purchasing, payroll. Brand name **Mise** ("mise en place").

---

## 2. Architecture (high level)
```
Browser ──HTTP──> Caddy (:80 on the EC2 box)
                    ├─ /api/*  → backend  (FastAPI, :8000)
                    └─ /*      → frontend (Next.js,  :3000)
backend ──asyncpg──> RDS Postgres (private)
backend ──boto3────> S3 bucket (document uploads)
```
- **Backend**: FastAPI, **modular monolith**. SQLAlchemy (async) + Alembic
  migrations + Pydantic. One package per domain.
- **Frontend**: Next.js 16 App Router, React 19, Tailwind v4, `output: standalone`.
- **DB**: Postgres 16. Multi-tenant via a `hotel_id` column on every table.
- **Files**: stored in S3 in the cloud (`STORAGE_BACKEND=s3`), local disk in dev.

---

## 3. Repo layout
```
backend/
  app/
    <domain>/            # auth, hotels, inventory, vendors, recipes,
      models.py          #   purchasing, sales, expenses, employees,
      schemas.py         #   payroll, documents, selfservice, reports …
      service.py         # business logic (DB lives here)
      router.py          # FastAPI endpoints
    core/                # config.py, database.py, storage.py (Local/S3)
    main.py              # app factory + router includes + CORS
  alembic/versions/      # migrations (async)
  requirements.txt       # prod deps   | requirements-dev.txt = + test/lint
  Dockerfile             # multi-stage: `dev` and `prod` targets
frontend/
  app/(app)/<page>/page.tsx   # logged-in dashboard pages
  app/page.tsx                # public landing | app/signup/page.tsx
  components/  lib/            # ui.tsx, AppShell.tsx, api.ts, auth.tsx …
infra/                   # Terraform (EC2 + RDS + S3 + IAM + networking)
.github/workflows/deploy.yml  # CI/CD pipeline (manual trigger)
docs/                    # this guide + the others
```
A backend feature = add/extend `models → schemas → service → router`, wire the
router in `app/main.py`, add an Alembic migration if the schema changed.

---

## 4. Run it LOCALLY
**Postgres + backend (Docker):**
```bash
docker compose up --build           # Postgres (mise-db-1) + backend on :8000
docker compose exec backend alembic upgrade head   # apply migrations (first run)
```
- Local DB creds: `mise / mise / mise`, db `mise`, on `localhost:5432`.
- Backend is volume-mounted (`./backend:/app`) so code edits hot-reload.

**Frontend (separate terminal):**
```bash
cd frontend
npm install        # first time
npm run dev        # http://localhost:3000  (talks to backend on :8000)
```
Local needs **no deploy** — editing files hot-reloads both servers. (If the
backend container isn't auto-reloading, `docker compose restart backend`.)

---

## 5. SHIP A CHANGE TO PRODUCTION (the runbook)
Production is **deployed only by the GitHub Actions pipeline** — never by hand
from a laptop. Steps after you've made code changes:

1. **Verify locally** (this is what CI will gate on):
   - Backend: `cd backend && ruff check . && pytest -q` (or at least
     `py -m py_compile <changed files>` if you can't run the test env).
   - Frontend: `cd frontend && npm run lint && npx tsc --noEmit`.
2. **Commit + push to `main`:**
   ```bash
   git add backend frontend infra docs
   git commit -m "feat(...): ..."
   git push origin main
   ```
   *(Pushing does NOT deploy — the workflow is manual.)*
3. **Trigger the deploy** — GitHub → Actions → **"Deploy (eu-west-2)"** →
   *Run workflow* on `main`. Or via API:
   ```bash
   curl -X POST -H "Authorization: Bearer $GH_TOKEN" \
     https://api.github.com/repos/pandiansambath/mise-erp/actions/workflows/deploy.yml/dispatches \
     -d '{"ref":"main"}'
   ```
4. **What the pipeline does** (`.github/workflows/deploy.yml`):
   `test-backend` (ruff + pytest, coverage ≥70%) **and** `test-frontend`
   (lint + build) must pass → build & push backend/frontend Docker images to
   **ECR** → `terraform apply` → the **EC2 box is replaced** (new image ⇒ new
   cloud-init) and reboots fresh.
5. **Wait ~12-18 min** (tests + build + apply), then **~2-3 min** more for the
   new box to boot, pull images, and run migrations.
6. **Live URL: http://18.133.95.137** (Elastic IP — stable across deploys).
   Health check: `GET /api/health` → `{"status":"ok"}`.

**Database migrations** run **automatically** on box boot (`alembic upgrade head`
in the backend container's start command). Add a migration to
`backend/alembic/versions/` and it applies on the next deploy — no manual step.

**Every deploy replaces the box** (data is safe: it lives in RDS + S3, not on the
box). A short "booting" gap after each deploy is normal.

---

## 6. Production infrastructure (AWS)
- **Account** 765607524925 (`tulasi`), region **eu-west-2 (London)**.
  Free Plan with credits — App Runner is blocked; we run on EC2.
- **EC2** `t3.micro`, **standard AL2023** AMI (has SSM agent + EC2 Instance
  Connect), Docker + Docker Compose + Caddy installed by cloud-init
  (`infra/user_data.sh.tftpl`). IMDS hop-limit = 2 so containers can read the
  instance role (for S3). Elastic IP `18.133.95.137`.
- **RDS** Postgres 16 (`mise-db`, db.t4g.micro) in **private subnets** — only
  the EC2 box can reach it. `backup_retention=0` (free-tier constraint).
- **S3** `mise-uploads-765607524925` — document storage (private, versioned).
- **ECR** repos `mise-backend`, `mise-frontend`.
- **Terraform state** in S3 `mise-tfstate-765607524925`.
- **GitHub Actions secrets**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
  `AWS_REGION`, `DB_PASSWORD`, `APP_SECRET_KEY`.

### Getting onto the box (ops / DB work)
RDS is private, so DB work must run **from the box**:
- **SSM Session Manager** (the box is SSM-managed) — preferred, no key.
- or **EC2 Instance Connect** (push a 60-sec temp SSH key via the API).
- The data migration we did: `pg_dump` local → upload to S3 → presigned URL →
  on the box `curl` it → `pg_restore --clean` into RDS.

---

## 7. Environment variables
**Backend** (set in `infra/user_data.sh.tftpl` for prod, `docker-compose.yml`
for dev): `DATABASE_URL`, `SECRET_KEY`, `ENVIRONMENT`, `CORS_ORIGINS`,
`STORAGE_BACKEND` (`s3` in prod), `S3_BUCKET`, `AWS_REGION`.
**Frontend**: `NEXT_PUBLIC_API_URL` — empty string `""` in prod (same-origin
`/api` behind Caddy); unset in dev → `http://localhost:8000`.

---

## 8. The data chain (important domain rule)
```
VENDOR ──has──> ITEMS @ PRICES ──> live in INVENTORY
       ──only priced items are ORDERABLE in PURCHASING──>
       stock arrives ──> RECIPES use only INVENTORY items (no free typing)
```
- A vendor "supplies" an item only once it has a **price** for it
  (Vendors page, or bulk **Excel import**). Until then the item shows a
  **`no vendor`** badge in Inventory and can't be ordered.
- Recipe ingredients are a **dropdown of inventory items** — never typed.
- Recipe costing uses the **preferred** vendor if set, else the **cheapest**.

---

## 9. Never commit (gitignored — keep it that way)
`pandiansambath_accessKeys.csv`, `github_token.txt`, any client
`*.xlsx/*.pdf/*.csv` data files. All app credit goes to the user — no AI
attribution in commits or PRs.
