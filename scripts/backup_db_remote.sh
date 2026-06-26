#!/usr/bin/env bash
# Mise — trigger a DB backup on the box from your workstation (no SSH needed) via
# AWS SSM, then pull the resulting dump down to ./backups/ (gitignored) so there's
# a copy OUTSIDE AWS. Requires the AWS CLI configured with access to the account.
#
# Usage:   bash scripts/backup_db_remote.sh
set -euo pipefail

REGION="${AWS_REGION:-eu-west-2}"
BUCKET="${S3_BUCKET:-mise-uploads-765607524925}"
IID=$(aws ec2 describe-instances --region "$REGION" \
  --filters "Name=tag:Name,Values=mise-app" "Name=instance-state-name,Values=running" \
  --query "Reservations[0].Instances[0].InstanceId" --output text)
echo "instance: $IID"

CID=$(aws ssm send-command --region "$REGION" --instance-ids "$IID" \
  --document-name AWS-RunShellScript --comment "mise db backup" \
  --parameters commands='["sudo S3_BUCKET='"$BUCKET"' AWS_REGION='"$REGION"' bash -s < /opt/mise/backup_db.sh || true","set -e","BK=$(docker ps --format \"{{.Names}}\" | grep -i backend | head -1)","URL=$(docker exec $BK printenv DATABASE_URL | sed s/+asyncpg//)","TS=$(date +%Y%m%d-%H%M%S); F=/tmp/mise-db-$TS.sql.gz","docker run --rm postgres:16 pg_dump \"$URL\" --no-owner --no-privileges | gzip > $F","aws s3 cp $F s3://'"$BUCKET"'/db-backups/ --region '"$REGION"'","echo BACKUP_OK $(basename $F)"]' \
  --query Command.CommandId --output text)
echo "command: $CID"

while :; do
  S=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$IID" --query Status --output text 2>/dev/null || echo Pending)
  echo "status: $S"; case "$S" in Success|Failed|Cancelled|TimedOut) break;; esac; sleep 10
done
aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$IID" --query StandardOutputContent --output text

mkdir -p backups
LATEST=$(aws s3 ls "s3://${BUCKET}/db-backups/" --region "$REGION" | sort | tail -1 | awk '{print $4}')
aws s3 cp "s3://${BUCKET}/db-backups/${LATEST}" "backups/${LATEST}" --region "$REGION"
echo "pulled to backups/${LATEST}"
