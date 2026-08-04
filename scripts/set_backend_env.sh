#!/usr/bin/env bash
# Set one environment variable on the running backend, without a rebuild.
#
#   bash scripts/set_backend_env.sh WEB_SEARCH_API_KEY "$(cat docs/secrets/serper_search_api.txt)"
#   bash scripts/set_backend_env.sh SENTRY_DSN "https://…@…ingest.sentry.io/…"
#
# The value is passed through SSM and written into the backend service's
# environment in /opt/mise/docker-compose.yml, then only that container is
# recreated (~15s). The rest of the site is untouched.
#
# The value is NEVER printed — not here, not in the confirmation, not in the SSM
# output. The check at the end asserts the container HAS the variable without
# echoing it, because SSM command output is retained in AWS.
#
# WHY NOT TERRAFORM: user_data_replace_on_change = true, so adding a variable
# there rebuilds the entire box. Right for day-one provisioning, wrong for
# adding a key to a running system.
#
# THE TRADE: this lives on the box, so a full box REPLACEMENT loses it and the
# feature returns to "not configured". Every integration is written to report
# itself as off rather than fail, so that is a feature going quiet, not an
# outage. Re-run after a rebuild.
set -eu
export MSYS_NO_PATHCONV=1

NAME="${1:?usage: $0 NAME value}"
VALUE="${2:?usage: $0 NAME value}"
REGION="${AWS_REGION:-eu-west-2}"
HERE="$(cd "$(dirname "$0")" && pwd)"

case "$NAME" in
  *[!A-Z0-9_]*) echo "NAME must be A-Z, 0-9 and underscores only" >&2; exit 2 ;;
esac

IID=$(aws ec2 describe-instances --region "$REGION" \
  --filters 'Name=tag:Name,Values=mise-app' 'Name=instance-state-name,Values=running' \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

# Both the script and the value go across base64-encoded: the value may contain
# quotes, slashes or dollars, none of which survive JSON inside shell intact.
SCRIPT_B64=$(base64 -w0 "$HERE/_set_backend_env_remote.sh")
VALUE_B64=$(printf '%s' "$VALUE" | base64 -w0)

CID=$(aws ssm send-command --region "$REGION" --instance-ids "$IID" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[\"echo $SCRIPT_B64 | base64 -d > /tmp/_setenv.sh && bash /tmp/_setenv.sh $NAME \\\"\$(echo $VALUE_B64 | base64 -d)\\\" && rm -f /tmp/_setenv.sh\"]" \
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
