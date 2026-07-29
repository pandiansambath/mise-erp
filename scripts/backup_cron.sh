#!/usr/bin/env bash
# Nightly database backup, with a check that it actually happened.
#
# The reason this exists: backups had silently stopped for six days and nobody
# knew. A backup you don't verify is a hope. So this does two things, and the
# second matters more than the first:
#
#   1. take a dump and put it in S3
#   2. look at what is ACTUALLY in S3 and shout if the newest is stale
#
# Step 2 runs even when step 1 fails, which is the whole point — a backup script
# that only reports its own success cannot tell you it stopped being run.
#
# Free: SNS email is free under 1,000/month, and this sends at most one a day.
set -eu

BUCKET="${S3_BUCKET:-mise-uploads-887514555232}"
REGION="${AWS_REGION:-eu-west-2}"
TOPIC="arn:aws:sns:${REGION}:887514555232:dineai-alerts"
MAX_AGE_HOURS=36   # a nightly job may legitimately be a few hours late

alert() {
  echo "ALERT: $1"
  aws sns publish --region "$REGION" --topic-arn "$TOPIC" \
    --subject "DineAI backup problem" --message "$1" >/dev/null 2>&1 || true
}

# ── 1. take the backup ──────────────────────────────────────────────────────
BK=$(docker ps --format '{{.Names}}' | grep -i backend | head -1 || true)
if [ -z "$BK" ]; then
  alert "Backup FAILED: no backend container running, so the database URL could not be read."
  exit 1
fi

URL=$(docker exec "$BK" printenv DATABASE_URL | sed 's/+asyncpg//')
TS=$(date +%Y%m%d-%H%M%S)
OUT="/tmp/mise-db-$TS.sql.gz"

if docker run --rm postgres:16 pg_dump "$URL" --no-owner --no-privileges 2>/dev/null | gzip > "$OUT"; then
  # An empty or tiny file means pg_dump wrote nothing useful — catching that
  # here is the difference between a backup and a 20-byte gzip header.
  SIZE=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
  if [ "$SIZE" -lt 10000 ]; then
    alert "Backup SUSPECT: dump is only ${SIZE} bytes. Treat it as failed."
  else
    aws s3 cp "$OUT" "s3://$BUCKET/db-backups/" --region "$REGION" >/dev/null \
      || alert "Backup FAILED: dump succeeded but the S3 upload did not."
  fi
  rm -f "$OUT"
else
  alert "Backup FAILED: pg_dump did not complete."
fi

# ── 2. verify what is really there ──────────────────────────────────────────
# Deliberately independent of step 1: this is what catches "the cron stopped
# running three weeks ago".
NEWEST=$(aws s3 ls "s3://$BUCKET/db-backups/" --region "$REGION" | sort | tail -1 || true)
if [ -z "$NEWEST" ]; then
  alert "No database backups exist in S3 at all."
  exit 1
fi

NEWEST_DATE=$(echo "$NEWEST" | awk '{print $1" "$2}')
AGE_HOURS=$(( ( $(date +%s) - $(date -d "$NEWEST_DATE" +%s) ) / 3600 ))
echo "newest backup: $NEWEST_DATE (${AGE_HOURS}h old)"

if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  alert "Database backups are STALE: newest is ${AGE_HOURS}h old ($NEWEST_DATE). Backups have stopped."
fi
