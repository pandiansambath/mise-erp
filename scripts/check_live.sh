#!/usr/bin/env bash
# Is what I just built actually running in production?
#
# Pushing runs CI. It does NOT deploy — deploy.yml is a separate workflow that
# scripts/deploy.sh dispatches. Three green CI runs in a row read exactly like
# three deploys, and the box stayed on an older commit the whole time.
#
# So: compare local HEAD to the commit the live API reports, and say plainly
# which is which.
cd "$(dirname "$0")/.." || exit 1

head=$(git rev-parse HEAD)
live=$(curl -s --max-time 20 https://dineai.cloud/api/health \
  | python -c "import sys,json;print(json.load(sys.stdin).get('commit',''))" 2>/dev/null)

if [ -z "$live" ]; then
  echo "could not reach https://dineai.cloud/api/health"
  exit 2
fi

echo "local HEAD : ${head:0:7}  $(git log -1 --format=%s)"
if [ "$head" = "$live" ]; then
  echo "live       : ${live:0:7}  ✅ production is running your HEAD"
  exit 0
fi

echo "live       : ${live:0:7}  $(git log -1 --format=%s "$live" 2>/dev/null || echo '(commit not local)')"
behind=$(git rev-list --count "$live..$head" 2>/dev/null || echo "?")
echo
echo "❌ production is $behind commit(s) BEHIND. CI passing is not deploying."
echo "   run:  bash scripts/deploy.sh"
exit 1
