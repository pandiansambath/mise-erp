#!/usr/bin/env bash
# Mise — RDS logical backup, run ON THE EC2 BOX (it's the only host that can reach
# the private RDS instance). Dumps the database with pg_dump (via a throwaway
# postgres container, so nothing needs installing) and uploads a gzipped SQL file
# to S3 under db-backups/. Read-only; safe to run anytime.
#
# Usage on the box:    sudo bash backup_db.sh
# Usually invoked remotely from a workstation via SSM (see backup_db_remote.sh).
set -euo pipefail

BUCKET="${S3_BUCKET:-mise-uploads-887514555232}"
REGION="${AWS_REGION:-eu-west-2}"
PG_IMAGE="postgres:16"   # match the RDS major version

BK=$(docker ps --format '{{.Names}}' | grep -i backend | head -1)
[ -n "$BK" ] || { echo "no backend container running"; exit 1; }

# The libpq URL = the app's DATABASE_URL minus SQLAlchemy's +asyncpg driver tag.
URL=$(docker exec "$BK" printenv DATABASE_URL | sed 's/+asyncpg//')

TS=$(date +%Y%m%d-%H%M%S)
OUT="/tmp/mise-db-${TS}.sql.gz"

docker run --rm "$PG_IMAGE" pg_dump "$URL" --no-owner --no-privileges | gzip > "$OUT"
ls -lh "$OUT"
aws s3 cp "$OUT" "s3://${BUCKET}/db-backups/" --region "$REGION"
echo "BACKUP_OK s3://${BUCKET}/db-backups/$(basename "$OUT")"
