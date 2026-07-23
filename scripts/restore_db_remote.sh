#!/usr/bin/env bash
# Mise — restore a DB dump INTO the RDS behind the app box, driven from a
# workstation via AWS SSM (no SSH, no DB password needed locally — it's read from
# the running backend container). Drops the current schema and loads the dump
# wholesale, so the database becomes an EXACT replica of the dump. The dump
# includes alembic_version at head, so the backend's boot-time `alembic upgrade
# head` is a no-op afterwards.
#
# The dump must already live in s3://$BUCKET/db-backups/ — upload it first:
#     aws s3 cp backups/<file>.sql.gz s3://$BUCKET/db-backups/
#
# Usage:  bash scripts/restore_db_remote.sh [dump-basename.sql.gz]
#         (no arg = newest object under s3://$BUCKET/db-backups/)
#
# ⚠ DESTRUCTIVE: replaces ALL data in the target DB. Intended for migrations /
#   disaster recovery into a FRESH RDS, not routine use against live data.
set -euo pipefail

REGION="${AWS_REGION:-eu-west-2}"
BUCKET="${S3_BUCKET:-mise-uploads-887514555232}"
DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  DUMP=$(aws s3 ls "s3://${BUCKET}/db-backups/" --region "$REGION" | sort | tail -1 | awk '{print $4}')
fi
[ -n "$DUMP" ] || { echo "no dump found in s3://${BUCKET}/db-backups/"; exit 1; }
echo "restoring dump: $DUMP  (bucket $BUCKET, region $REGION)"

IID=$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=mise-app" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)
echo "instance: $IID"

# The command that runs ON the box. Reads DATABASE_URL from the backend container,
# stops the backend (no live connections during DROP SCHEMA), drops+reloads, and
# prints a few row counts as a sanity check.
REMOTE=$(cat <<EOS
set -e
BK=\$(docker ps --format '{{.Names}}' | grep -i backend | head -1)
URL=\$(docker exec \$BK printenv DATABASE_URL | sed 's/+asyncpg//')
aws s3 cp s3://${BUCKET}/db-backups/${DUMP} /tmp/mise-restore.sql.gz --region ${REGION}
gunzip -f /tmp/mise-restore.sql.gz
cd /opt/mise
docker compose stop backend
docker run --rm -i postgres:16 psql "\$URL" -v ON_ERROR_STOP=1 -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker run --rm -i postgres:16 psql "\$URL" < /tmp/mise-restore.sql > /tmp/mise-restore.log 2>&1 || true
docker compose start backend
echo "restore errors: \$(grep -c '^ERROR' /tmp/mise-restore.log || true)"
grep '^ERROR' /tmp/mise-restore.log | head -5 || true
rm -f /tmp/mise-restore.sql
echo RESTORE_DONE
docker run --rm -i postgres:16 psql "\$URL" -t \
  -c "SELECT 'hotels='||count(*) FROM hotels" \
  -c "SELECT 'users='||count(*) FROM users" \
  -c "SELECT 'items='||count(*) FROM items" \
  -c "SELECT 'employees='||count(*) FROM employees"
EOS
)

PARAMS=$(python -c 'import json,sys; print(json.dumps({"commands":[sys.stdin.read()]}))' <<< "$REMOTE")
PFILE=$(mktemp)
printf '%s' "$PARAMS" > "$PFILE"

CID=$(aws ssm send-command --region "$REGION" --instance-ids "$IID" \
  --document-name AWS-RunShellScript --comment "mise db restore" \
  --parameters "file://$PFILE" --query Command.CommandId --output text)
echo "command: $CID"
rm -f "$PFILE"

while :; do
  S=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$IID" \
        --query Status --output text 2>/dev/null || echo Pending)
  echo "status: $S"; case "$S" in Success|Failed|Cancelled|TimedOut) break;; esac; sleep 10
done
echo "----- stdout -----"
aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$IID" --query StandardOutputContent --output text
echo "----- stderr -----"
aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$IID" --query StandardErrorContent --output text
