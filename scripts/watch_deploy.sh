#!/usr/bin/env sh
# Dispatch the deploy AND WATCH IT. Use this instead of deploy.sh.
#
# He had to tell me three times that a workflow had failed. Firing a deploy and
# walking away is not deploying — it is hoping. This blocks until the run
# finishes, then prints the outcome, and on failure digs out the actual failing
# step and the lines that matter so the next message can say WHY.
cd "$(dirname "$0")/.." || exit 1
TOKEN=$(grep -E '^[[:space:]]*(ghp_|github_pat_)[A-Za-z0-9_]+[[:space:]]*$' github_token.txt | head -1 | tr -d '[:space:]')
[ -z "$TOKEN" ] && { echo "no token in github_token.txt"; exit 1; }
API="https://api.github.com/repos/pandiansambath/mise-erp"
auth="Authorization: Bearer $TOKEN"

# GitHub keeps one run and one queued; a third dispatch EVICTS the queued one,
# which is how a deploy ends up "cancelled" while everything looks green. Wait
# for any in-flight deploy to finish before asking for another.
API_RUNS="$API/actions/workflows/deploy.yml/runs?per_page=1"
for _ in $(seq 1 60); do
  st=$(curl -s -H "$auth" "$API_RUNS"     | python -c "import sys,json;r=json.load(sys.stdin)['workflow_runs'];print(r[0]['status'] if r else 'none')" 2>/dev/null)
  [ "$st" = "completed" ] || [ "$st" = "none" ] && break
  echo "  a deploy is already running — waiting rather than evicting it"
  sleep 30
done

sh scripts/deploy.sh || exit 1
echo "watching…"

# Both workflows matter: CI runs on the push, Deploy on the dispatch.
for wf in ci.yml deploy.yml; do
  for _ in $(seq 1 60); do
    st=$(curl -s -H "$auth" "$API/actions/workflows/$wf/runs?per_page=1" \
      | python -c "import sys,json;r=json.load(sys.stdin)['workflow_runs'];print(r[0]['status'] if r else 'none')" 2>/dev/null)
    [ "$st" = "completed" ] && break
    [ "$st" = "none" ] && break
    sleep 30
  done
  read -r concl sha < <(curl -s -H "$auth" "$API/actions/workflows/$wf/runs?per_page=1" \
    | python -c "import sys,json;r=json.load(sys.stdin)['workflow_runs'];print(r[0]['conclusion'], r[0]['head_sha'][:7]) if r else print('none -')" 2>/dev/null)
  printf '%-12s %s  %s\n' "$wf" "$concl" "$sha"

  if [ "$concl" = "failure" ]; then
    rid=$(curl -s -H "$auth" "$API/actions/workflows/$wf/runs?per_page=1" \
      | python -c "import sys,json;print(json.load(sys.stdin)['workflow_runs'][0]['id'])")
    curl -s -H "$auth" "$API/actions/runs/$rid/jobs" | python -c "
import sys, json
for j in json.load(sys.stdin)['jobs']:
    for st in j['steps']:
        if st['conclusion'] not in ('success','skipped',None):
            print('   failed step:', j['name'], '->', st['name'])
"
    jid=$(curl -s -H "$auth" "$API/actions/runs/$rid/jobs" \
      | python -c "import sys,json;print([j['id'] for j in json.load(sys.stdin)['jobs'] if j['conclusion']=='failure'][0])")
    curl -sL -H "$auth" "$API/actions/jobs/$jid/logs" \
      | grep -aE "FAILED|^E |Required test coverage|error  |Error:" | grep -avi deprecat | tail -15
    exit 1
  fi
done

sh scripts/check_live.sh
