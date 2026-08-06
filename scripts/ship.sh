#!/usr/bin/env sh
# Ship a BATCH of work with one pipeline run.
#
# 174 minutes of Actions time went on twelve runs, of which three shipped
# anything. Two causes, both mine:
#
#   1. Every push ran CI (~15 min) AND every deploy ran the same tests again
#      (~16 min). deploy.yml already lints, migrates and runs the full suite
#      before it builds, so CI on a deploying push is duplicate work — hence
#      [skip ci].
#   2. Overlapping dispatches. GitHub holds one deploy plus ONE queued; a third
#      evicts the pending one, so those minutes bought nothing.
#
# So: verify locally, push once with [skip ci], deploy once, watch that exact
# run to the end. Accumulate several changes before calling this.
set -u
cd "$(dirname "$0")/.." || exit 1

bash scripts/pre_push_check.sh || { echo "not shipping — fix the above first"; exit 1; }

TOKEN=$(grep -E '^[[:space:]]*(ghp_|github_pat_)[A-Za-z0-9_]+[[:space:]]*$' github_token.txt | head -1 | tr -d '[:space:]')
API="https://api.github.com/repos/pandiansambath/mise-erp"
auth="Authorization: Bearer $TOKEN"

# Never dispatch on top of a live deploy — that is what cancelled the others.
st=$(curl -s -H "$auth" "$API/actions/workflows/deploy.yml/runs?per_page=1" \
  | python -c "import sys,json;r=json.load(sys.stdin)['workflow_runs'];print(r[0]['status'] if r else 'none')")
if [ "$st" != "completed" ] && [ "$st" != "none" ]; then
  echo "a deploy is already $st — wait for it rather than evicting it"
  exit 1
fi

# An empty commit only if there is nothing staged; otherwise the caller has
# already committed and we simply push.
git push origin main || exit 1

sh scripts/deploy.sh || exit 1
sleep 10
RID=$(curl -s -H "$auth" "$API/actions/workflows/deploy.yml/runs?per_page=1" \
  | python -c "import sys,json;print(json.load(sys.stdin)['workflow_runs'][0]['id'])")
echo "watching run $RID …"
until [ "$(curl -s -H "$auth" "$API/actions/runs/$RID" | python -c "import sys,json;print(json.load(sys.stdin)['status'])")" = "completed" ]; do
  sleep 60
done
curl -s -H "$auth" "$API/actions/runs/$RID" | python -c "
import sys,json;r=json.load(sys.stdin);print('DEPLOY:', r['conclusion'], r['head_sha'][:7])"
sh scripts/check_live.sh
