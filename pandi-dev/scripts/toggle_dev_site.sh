#!/usr/bin/env bash
# Turn pandi-dev.dineai.cloud on or off, live.
#
#   bash pandi-dev/scripts/toggle_dev_site.sh off
#   bash pandi-dev/scripts/toggle_dev_site.sh on
#   bash scripts/toggle_dev_site.sh status
#
# OFF makes the page 404 on the SERVER — it is not hidden with CSS, it is never
# rendered and never sent, so there is nothing to find in devtools. One container
# restart, about 20 seconds. Nothing else on the site is touched.
#
# WHY THIS IS A SCRIPT AND NOT A TERRAFORM VARIABLE
# The instance sets user_data_replace_on_change = true, so putting this in
# infra/user_data.sh.tftpl would REPLACE THE WHOLE BOX on every flip — minutes of
# downtime to hide one page. This edits the compose file on the box instead.
#
# THE CAVEAT, PLAINLY: because the setting lives on the box rather than in
# Terraform, a full box REPLACEMENT resets it — to ON, the documented default.
# So the worst case is "the page came back", never "the site broke". If it is
# ever off for a reason that matters, re-run this after a box rebuild.
set -eu
export MSYS_NO_PATHCONV=1

ACTION="${1:-status}"
REGION="${AWS_REGION:-eu-west-2}"
HERE="$(cd "$(dirname "$0")" && pwd)"

case "$ACTION" in
  on|off|status) ;;
  *) echo "usage: $0 [on|off|status]" >&2; exit 2 ;;
esac

IID=$(aws ec2 describe-instances --region "$REGION" \
  --filters 'Name=tag:Name,Values=mise-app' 'Name=instance-state-name,Values=running' \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

# Ship the remote script as base64 so no quoting survives the trip through JSON.
B64=$(base64 -w0 "$HERE/_dev_site_remote.sh")

CID=$(aws ssm send-command --region "$REGION" --instance-ids "$IID" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $B64 | base64 -d > /tmp/_dev_site.sh && bash /tmp/_dev_site.sh $ACTION\"]" \
  --query Command.CommandId --output text)

ST=Pending
for _ in $(seq 1 40); do
  ST=$(aws ssm get-command-invocation --region "$REGION" --command-id "$CID" \
        --instance-id "$IID" --query Status --output text 2>/dev/null || echo Pending)
  case "$ST" in Success|Failed|Cancelled|TimedOut) break;; esac
  sleep 3
done

aws ssm get-command-invocation --region "$REGION" --command-id "$CID" \
  --instance-id "$IID" --query StandardOutputContent --output text

if [ "$ST" != "Success" ]; then
  aws ssm get-command-invocation --region "$REGION" --command-id "$CID" \
    --instance-id "$IID" --query StandardErrorContent --output text
  exit 1
fi
