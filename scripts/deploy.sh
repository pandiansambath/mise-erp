#!/usr/bin/env sh
# Dispatch the production deploy: workflow "Deploy (eu-west-2)" -> milagurestaurant.com.
# Standing user authorization (2026-07-12): deploys run without asking, every session.
# The workflow has its own test gate, so a broken push can never reach prod.
# Token is read by pattern and NEVER printed.
cd "$(dirname "$0")/.." || exit 1
TOKEN=$(grep -oE '(ghp_|github_pat_)[A-Za-z0-9_]+' github_token.txt | head -1)
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
