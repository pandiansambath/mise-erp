#!/usr/bin/env bash
# Mise — full off-AWS backup in one shot: DB dump (via SSM → S3 → local) + a
# mirror of ALL uploaded S3 assets. Run frequently and before every deploy so we
# can recreate the whole stack on a fresh AWS account if this free one is lost.
set -euo pipefail
REGION="${AWS_REGION:-eu-west-2}"
BUCKET="${S3_BUCKET:-mise-uploads-887514555232}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> 1/2  Database dump"
bash "$HERE/scripts/backup_db_remote.sh"

echo "==> 2/2  S3 asset mirror (off-AWS)"
mkdir -p "$HERE/docs/recovery/s3-mirror"
aws s3 sync "s3://${BUCKET}" "$HERE/docs/recovery/s3-mirror/" \
  --exclude "db-backups/*" --region "$REGION" --only-show-errors
echo "✅ Full backup complete — DB in ./backups/, assets in ./docs/recovery/s3-mirror/"
