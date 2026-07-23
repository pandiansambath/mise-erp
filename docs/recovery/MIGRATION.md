# Mise — Migration runbook: new AWS account + new domain (`dineai.cloud`)

End-to-end lift from the current stack (AWS acct `765607524925`, `milagurestaurant.com`,
`eu-west-2`) to a **new AWS account** and the **new domain `dineai.cloud`**, with a
follow-on feature: a **subdomain per hotel** (`<hotel>.dineai.cloud`).

Pairs with [RECREATE.md](RECREATE.md) (generic rebuild) and [BACKUP.md](BACKUP.md) (data).
This file is the migration-specific plan + running checklist.

---

## Guiding principle — parallel cutover, zero data loss

**The old stack stays fully live until the new one is verified.** We build the new
account alongside, restore a fresh copy of the data, prove it works on a temporary URL,
*then* point `dineai.cloud` DNS at it, verify HTTPS + email, and only afterwards
decommission the old account. Nothing is destroyed until the new stack is green.

Cutover order: **stand up → restore → verify (temp) → DNS → HTTPS → email → verify (live) → decommission.**

---

## What changes ("what we regenerate")

| Thing | Old | New | How it changes |
|---|---|---|---|
| AWS account | `765607524925` | *(new)* | new IAM deploy keys |
| Region | `eu-west-2` | `eu-west-2` (recommended — UK data residency + Textract available) | keep unless decided otherwise |
| tfstate bucket | `mise-tfstate-765607524925` | `mise-tfstate-<newacct>` | edit `infra/versions.tf` + workflow env + scripts |
| Uploads bucket | `mise-uploads-765607524925` | `mise-uploads-<newacct>` | auto (name embeds acct id); **must copy objects over** |
| ECR repos | mise-backend/frontend | same names, new acct | workflow auto-creates |
| RDS | `mise-db` | `mise-db` (fresh) | terraform creates empty → **restore dump** |
| Elastic IP | `18.133.95.137` | *(new EIP)* | terraform allocates → new DNS A records |
| Domain | `milagurestaurant.com` | `dineai.cloud` | DNS + code refs + email-from |
| TLS certs | old (milagu) certs in S3 | fresh LE cert for dineai.cloud | **do NOT copy old certs** — issue fresh |
| Email sender | `accounts@milagurestaurant.com` | `accounts@dineai.cloud` | re-verify domain in Resend + change EMAIL_FROM |
| JWT signing key | APP_SECRET_KEY | keep (or rotate = everyone re-logs-in) | reuse to avoid disruption |

---

## Hard-coded references that must flip (found by audit)

Infra / config:
- `infra/versions.tf` → backend `bucket` + `region` (tfstate). **Backend blocks can't use vars — edit or pass `-backend-config`.**
- `.github/workflows/deploy.yml` → `STATE_BUCKET`, `AWS_REGION`.
- `scripts/backup_all.sh`, `scripts/backup_db.sh`, `scripts/backup_db_remote.sh`, `scripts/deploy.sh` → bucket/region.
- `infra/variables.tf` → `email_from` default (`accounts@milagurestaurant.com`).
- `backend/app/core/config.py:32` `aws_region`; `:40` `app_base_url` (**used for email verification links** — strict-email mandate).

App code (domain-baked strings):
- `backend/app/core/notify.py:155` footer link.
- `backend/app/safety/router.py:62` `cta_url="http://18.133.95.137/food-safety"` — **hard-coded IP** in an alert CTA.
- `frontend/app/(app)/orders/page.tsx:443` rider URL, `:593` order-share URL.
- `frontend/app/(app)/settings/page.tsx:248` "accounts@milagurestaurant.com" display text.

**Better than find-replace:** drive the URL from config, not literals —
- backend: add `APP_BASE_URL` env in `user_data.sh.tftpl` = `https://${domain}`, and make `safety` use `settings.app_base_url`.
- frontend: use `window.location.origin` for share/rider links so they work on *any* domain or subdomain (this also sets us up for per-hotel subdomains).

---

## Phase 0 — Pre-flight (old account, before touching new)
- [ ] Fresh DB backup: `bash scripts/backup_db_remote.sh` → newest `./backups/*.sql.gz`.
- [ ] Fresh S3 mirror: `aws s3 sync s3://mise-uploads-765607524925 docs/recovery/s3-mirror/`.
- [ ] Note the newest dump filename here: `__________`.
- [ ] New account id: `__________`  Region: `eu-west-2` (or `__________`).

## Phase 1 — New account bootstrap
- [ ] In the new account create an IAM user `mise-deployer` (programmatic) with admin (or VPC/EC2/RDS/S3/IAM/ECR/SSM/Textract). Generate access keys.
- [ ] Put keys in **two** places (never in chat/git):
  - GitHub → repo → Settings → Secrets → Actions: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.
  - Locally for me to drive terraform/restore: `docs/secrets/aws_creds_new.txt` (gitignored) **or** `aws configure --profile mise-new`.
- [ ] Create tfstate bucket: `aws s3 mb s3://mise-tfstate-<newacct> --region eu-west-2` (+ enable versioning).

## Phase 2 — Point the repo at the new account
- [ ] `infra/versions.tf`: backend bucket → `mise-tfstate-<newacct>`.
- [ ] `.github/workflows/deploy.yml`: `STATE_BUCKET` → new; region if changed.
- [ ] `scripts/*.sh`: bucket/region.
- [ ] Repo **variable** `SITE_DOMAIN` = `dineai.cloud`; `ACME_EMAIL` = ops email.
- [ ] Keep GitHub secrets: `DB_PASSWORD`, `APP_SECRET_KEY`, `RESEND_API_KEY`, `GEMINI_API_KEY(_2)`, `STRIPE_*`.

## Phase 3 — Stand up infra (new account)
- [ ] `cd infra && terraform init -reconfigure` (new backend bucket) `&& terraform apply`.
- [ ] Creates: VPC, EC2 + EIP, RDS (empty), S3 uploads, ECR, IAM (**Textract policy included**).
- [ ] Record new EIP: `__________`.

## Phase 4 — Restore data
- [ ] DB: load newest dump into the new RDS (via SSM on the box, per BACKUP.md restore).
- [ ] S3 assets: copy old → new bucket. Fastest with the local mirror:
      `aws s3 sync docs/recovery/s3-mirror/ s3://mise-uploads-<newacct>/ --exclude "caddy-data/*"`
      (**exclude `caddy-data/` — those are the OLD domain's certs; let Caddy issue fresh**).

## Phase 5 — Domain + HTTPS cutover
- [ ] Namecheap `dineai.cloud` → Advanced DNS: `A @` and `A www` → new EIP. Remove the parking CNAME/redirect.
- [ ] Deploy (workflow) with `SITE_DOMAIN=dineai.cloud`. Caddy provisions a fresh LE cert (needs DNS live first).
- [ ] Verify `https://dineai.cloud/api/health` → 200 + correct commit.

## Phase 6 — Email (Resend) on the new domain
- [ ] Add `dineai.cloud` as a domain in Resend → it gives DKIM + `send` subdomain MX + verification TXT.
- [ ] Add those records in Namecheap Advanced DNS. Wait for "Verified".
- [ ] `EMAIL_FROM` / `variables.tf email_from` → `Mise <accounts@dineai.cloud>`.
- [ ] Send a test verification email → link points to `https://dineai.cloud/...`.

## Phase 7 — Full verification (before retiring old)
- [ ] Login, dashboard shows restored data.
- [ ] Email verification link resolves on `dineai.cloud` (strict-email flow).
- [ ] A document/bill scan works (**Textract** on the new account — the whole reason for the move).
- [ ] Customer ordering link + rider link resolve on the new domain.
- [ ] Copilot `/api/assistant/status` → configured.

## Phase 8 — Decommission old (only after N days green)
- [ ] Redirect `milagurestaurant.com` → `dineai.cloud` (301) *or* retire per decision.
- [ ] Final backup of old account, then `terraform destroy` in the OLD infra (or just stop billing).
- [ ] Keep the final old-account dump in `./backups/` labelled `pre-decommission`.

---

## Phase 9 (LATER, separate feature) — subdomain per hotel `<hotel>.dineai.cloud`

Not part of the lift-and-shift; do it once the new stack is stable. Design notes:
- **DNS:** wildcard `A *.dineai.cloud` → EIP.
- **TLS:** Caddy HTTP-01 can't do wildcards. Two options:
  - **On-demand TLS** (recommended): Caddy issues a per-hostname cert on first request, guarded by an `ask` endpoint that confirms the host is a real hotel handle. No DNS-API creds, no custom Caddy build.
  - **Wildcard cert via DNS-01**: needs a Caddy build with the Namecheap/Cloudflare DNS plugin + API creds.
- **Tenant-by-Host:** map subdomain → hotel using the `hotel.username` handle we already added (global-search/chat feature). Public pages (ordering, careers, login landing) resolve the hotel from the Host header; the authenticated app still scopes by JWT `hotel_id`.
- The `window.location.origin` change in Phase 4 already makes share/rider links subdomain-correct.

---

## GitHub secrets/variables — final new-account state
Secrets: `AWS_ACCESS_KEY_ID`*, `AWS_SECRET_ACCESS_KEY`*, `DB_PASSWORD`, `APP_SECRET_KEY`,
`RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`,
`GEMINI_API_KEY`, `GEMINI_API_KEY_2`.  (`*` = the only ones that MUST change.)
Variables: `SITE_DOMAIN=dineai.cloud`, `ACME_EMAIL=<ops email>`.
