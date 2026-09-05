#!/usr/bin/env sh
# Dispatch the production deploy: workflow "Deploy (eu-west-2)" -> milagurestaurant.com.
# Standing user authorization (2026-07-12): deploys run without asking, every session.
# The workflow has its own test gate, so a broken push can never reach prod.
# Token is read by pattern and NEVER printed.
cd "$(dirname "$0")/.." || exit 1

# PUSH FIRST. This script only ever fired a workflow_dispatch with
# {"ref":"main"}, and that "main" is the REMOTE branch — so dispatching after a
# local commit rebuilt whatever was already on origin and shipped nothing. It
# still reported "DISPATCHED (204)", the run still went green, and /api/health
# still answered with a real commit: every signal said success while the fix sat
# on this machine. A watcher agent caught it by comparing HEAD to origin/main.
#
# A script called "deploy" has to deploy the work you just did, so it pushes.
if [ -n "$(git status --porcelain)" ]; then
  echo "WARNING: uncommitted changes will NOT ship:"
  git status --short
fi
branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "on branch '$branch', not main - deploy.yml always builds main. Aborting."
  exit 1
fi
if ! git push origin main; then
  echo "push failed - nothing dispatched, because it would have rebuilt the old tree."
  exit 1
fi
echo "pushed $(git rev-parse --short HEAD) to origin/main"

# The real token sits on its OWN line — embedded matches (URLs, notes) are stale.
TOKEN=$(grep -E '^[[:space:]]*(ghp_|github_pat_)[A-Za-z0-9_]+[[:space:]]*$' github_token.txt | head -1 | tr -d '[:space:]')
if [ -z "$TOKEN" ]; then echo "no token found in github_token.txt"; exit 1; fi
code=$(curl -s -o .deploy_dispatch_response -w "%{http_code}" -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/pandiansambath/mise-erp/actions/workflows/deploy.yml/dispatches \
  -d '{"ref":"main"}')
if [ "$code" = "204" ]; then
  echo "DISPATCHED (204) - Deploy (eu-west-2) is running"
  rm -f .deploy_dispatch_response
else
  echo "FAILED ($code):"
  cat .deploy_dispatch_response
  rm -f .deploy_dispatch_response
  exit 1
fi
