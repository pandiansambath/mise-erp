# Mise — Database backup & restore

The RDS instance is **private** (`publicly_accessible = false`), so backups run **on
the EC2 box** (the only host that can reach it) and ship to S3. We keep three layers:

1. **RDS automated snapshots** — AWS-managed, point-in-time, ~7-day retention. Free
   while the account is healthy, but they die with the account.
2. **Logical dumps in S3** — `s3://mise-uploads-765607524925/db-backups/` (gzipped
   `pg_dump`). Durable, cheap, survives EC2 replacement.
3. **Off-AWS copies** — pulled to the gitignored local `backups/` folder. This is the
   real safeguard if the AWS account is ever lost/suspended.

> The dumps contain **client data** → they are gitignored (`backups/`, `*.sql*`) and
> must **never** be committed.

## Take a backup
From your workstation (no SSH; uses SSM):
```
bash scripts/backup_db_remote.sh        # dumps on the box → S3 → pulls to ./backups/
```
Or directly on the box: `sudo bash /opt/mise/backup_db.sh` (see `scripts/backup_db.sh`).

**Policy: run a backup before every AWS deploy** (deploys replace the box) and keep the
latest few `backups/` copies off-machine too (e.g. a personal drive / another cloud).

## Restore
Into a fresh/empty DB (schema is created by `alembic upgrade head` on backend boot, but
a full dump also recreates tables). On the box, with `DATABASE_URL` from the backend
container (strip the `+asyncpg`):
```
BK=$(docker ps --format '{{.Names}}' | grep -i backend | head -1)
URL=$(docker exec $BK printenv DATABASE_URL | sed 's/+asyncpg//')
gunzip -c backups/mise-db-YYYYMMDD-HHMMSS.sql.gz | docker run --rm -i postgres:16 psql "$URL"
```
For a clean restore, drop/recreate the `mise` database first (or restore into a new RDS
and repoint `DATABASE_URL`).

## Verify a dump
```
gunzip -c backups/<file>.sql.gz | grep -c 'CREATE TABLE'   # tables
gunzip -c backups/<file>.sql.gz | grep -cE 'COPY |INSERT'  # data blocks
```

## Latest known-good backup
- `mise-db-20260626-183744.sql.gz` — 29 tables with data. In S3 `db-backups/` + local `backups/`.
