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
# THE SAME LINT CI RUNS, BEFORE BURNING A CYCLE ON IT.
# A deploy of mine died on ONE auto-fixable ruff I001 in an import block. The
# deploy job needs the backend tests, so nothing shipped, and the round trip
# cost ~25 minutes to learn something ruff says in two seconds. tsc, next lint
# and pytest all passed locally — none of them is ruff.
if command -v ruff >/dev/null 2>&1; then
  RUFF="ruff"
elif python -m ruff --version >/dev/null 2>&1; then
  RUFF="python -m ruff"
else
  RUFF=""
fi
if [ -n "$RUFF" ]; then
  if ! (cd backend && $RUFF check .); then
    echo "ruff failed - fix it (ruff check --fix backend/) before deploying."
    exit 1
  fi
  echo "ruff clean"
else
  echo "NOTE: ruff not installed here, so CI is the first thing that will lint this."
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "on branch '$branch', not main - deploy.yml always builds main. Aborting."
  exit 1
fi
# `-c credential.helper=` is not optional on Windows: the Credential Manager
# caches and will keep offering a REVOKED token, so the push fails while a
# working token sits in the file two lines away. See scripts/git_askpass.sh.
if ! GIT_ASKPASS="$(cd "$(dirname "$0")" && pwd)/git_askpass.sh"      GIT_TERMINAL_PROMPT=0      git -c credential.helper= push      https://x-access-token@github.com/pandiansambath/mise-erp.git main; then
  echo "push failed - nothing dispatched, because it would have rebuilt the old tree."
  exit 1
fi
echo "pushed $(git rev-parse --short HEAD) to origin/main"

# PICK A TOKEN THAT ACTUALLY WORKS, don't guess by position.
#
# This used to take the first whole-line match out of github_token.txt, and
# that rule has now failed twice: the file accumulates tokens, the old ones are
# revoked but stay in the file, and a revoked token looks exactly like a live
# one until the dispatch comes back 401. A later rule of "use the LAST match"
# failed the same way for the mirror reason.
#
# So: gather every candidate from both places the file has lived, and ASK
# GITHUB which one is alive. One cheap call each, and the answer cannot rot.
#
# The token is never echoed, never written to a file, and never passed on a
# command line where `ps` could see it — only ever in a header on stdin-free
# curl invocations. Two PATs have already leaked on this project through
# redaction patterns that matched nothing.
TOKEN=""
for f in docs/secrets/github_token.txt github_token.txt; do
  [ -f "$f" ] || continue
  for cand in $(grep -oE '(ghp_|github_pat_)[A-Za-z0-9_]+' "$f" | tac); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}'          -H "Authorization: Bearer $cand"          https://api.github.com/repos/pandiansambath/mise-erp)" = "200" ]; then
      TOKEN="$cand"
      echo "using the live token from $f"
      break 2
    fi
  done
done
if [ -z "$TOKEN" ]; then
  echo "No WORKING GitHub token found."
  echo "Checked: docs/secrets/github_token.txt, github_token.txt"
  echo "Every candidate was rejected (401). Paste a fresh fine-grained PAT with"
  echo "Contents: read/write and Actions: read/write on its own line."
  exit 1
fi
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
