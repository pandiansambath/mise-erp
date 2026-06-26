# Mise — Recreate-from-scratch runbook

How to rebuild the entire live system (infra + app + data) from nothing — e.g. if
the AWS account is lost/suspended, or you're moving to a new account. Everything
here is reproducible from this git repo plus the secrets list and a DB backup.

> ⚠️ This repo is the source of truth for **infra (Terraform) and app code**.
> The only things NOT in git are **secrets** (see list below) and the **RDS data**
> (logical backups live in S3 `db-backups/` and in the local gitignored `backups/`).

---

## 0. What's where
- **App code:** `backend/` (FastAPI) + `frontend/` (Next.js).
- **Infra:** `infra/*.tf` (Terraform) — VPC/subnet/SG, EC2 t3.micro, RDS Postgres 16,
  S3 uploads bucket, IAM, Elastic IP. State in S3 `mise-tfstate-765607524925`.
- **CI/CD:** `.github/workflows/deploy.yml` — builds images → ECR, `terraform apply`,
  the box re-creates via cloud-init (`infra/user_data.sh.tftpl`) and runs
  `docker compose up`.
- **DB backups:** `scripts/backup_db.sh` (box-side) + `scripts/backup_db_remote.sh`
  (drive it from a workstation via SSM). Output → S3 `db-backups/` + `./backups/`.

## 1. Prerequisites
- An AWS account + an IAM user/role with admin (or enough for VPC/EC2/RDS/S3/IAM/ECR/SSM).
- A GitHub repo (fork/push this code) with Actions enabled.
- AWS CLI + Terraform installed locally.
- Domain DNS access (Namecheap → milagurestaurant.com) if you want HTTPS.

## 2. Secrets to set (GitHub repo → Settings → Secrets and variables → Actions)
Secrets (values are NOT in git — keep them in your password manager / the gitignored
`docs/*` key files):
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — deploy credentials.
- `DB_PASSWORD` — RDS master password.
- `APP_SECRET_KEY` — backend JWT/signing key.
- `GEMINI_API_KEY`, `GEMINI_API_KEY_2` — Copilot LLM keys (`docs/gemini_api_key*.txt`).
- `RESEND_API_KEY` — email (optional).
Repo **variables** (not secrets): `SITE_DOMAIN`, `ACME_EMAIL` (enable HTTPS),
`BACKEND_IMAGE`/`FRONTEND_IMAGE` tags if used.

## 3. Stand up infra
```
cd infra
terraform init            # uses the S3 backend; create the state bucket first if new account
terraform apply           # creates VPC, EC2, RDS, S3, IAM, EIP
```
If it's a brand-new account, first create the tfstate bucket
(`aws s3 mb s3://<project>-tfstate-<acct>`) and the ECR repos the workflow expects.

## 4. Deploy the app
Push to `main` (or run the **Deploy** workflow). It builds + pushes images to ECR and
`terraform apply`s; the EC2 box runs cloud-init → `docker compose up` (caddy + backend
+ frontend). Backend runs `alembic upgrade head` on boot, so the **schema** is created
automatically. First boot = empty database (schema only).

## 5. Restore the data
Get the latest dump (from S3 or `./backups/`) and load it — see
[BACKUP.md](BACKUP.md#restore). In short, on the box:
```
gunzip -c mise-db-YYYYMMDD-HHMMSS.sql.gz | \
  docker run --rm -i postgres:16 psql "<DATABASE_URL without +asyncpg>"
```

## 6. HTTPS (optional)
Point DNS A records (`@` and `www`) at the Elastic IP, set `SITE_DOMAIN` + `ACME_EMAIL`
repo variables, redeploy. Caddy auto-provisions a Let's Encrypt cert.
See [../../](.) `nirai-https-domain` notes for the cert-persistence caveat.

## 7. Verify
- `https://<domain>/` → 200, `/api/health` → ok, `/api/assistant/status` → `configured:true`.
- Log in; the dashboard shows the restored data.
