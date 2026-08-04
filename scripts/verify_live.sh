#!/usr/bin/env bash
# Does the deployed app actually do what we claim it does?
#
# Written because "is that shipped?" kept needing archaeology through commit
# messages — and commit messages lie by omission. Twice now something was
# reported as done when it was not: the backup cron that never installed, and
# two deploys that were evicted so the code never reached the box.
#
# This probes the LIVE site. Unauthenticated checks run anywhere. To include the
# signed-in checks, export credentials first:
#
#   VERIFY_EMAIL=you@example.com VERIFY_PASSWORD=... bash scripts/verify_live.sh
#
# Exit code is the number of FAILED checks, so CI or a timer can use it.
set -u

BASE="${VERIFY_BASE:-https://dineai.cloud}"
API="$BASE/api"
PASS=0
FAIL=0
SKIP=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; SKIP=$((SKIP+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# check <name> <expected-substring> <curl args...>
check() {
  local name="$1" want="$2"; shift 2
  local body
  body=$(curl -s --max-time 20 "$@" 2>/dev/null)
  if printf '%s' "$body" | grep -q "$want"; then
    ok "$name"
  else
    bad "$name (looked for '$want', got: $(printf '%s' "$body" | head -c 120))"
  fi
}

head_ "Reachability"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$BASE/")
[ "$CODE" = "200" ] && ok "landing page serves 200" || bad "landing page returned $CODE"

# HTTP must redirect to HTTPS, not serve content: a restaurant's payroll should
# never travel in the clear because someone typed the bare host.
RCODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "http://dineai.cloud/" 2>/dev/null)
case "$RCODE" in 30*) ok "HTTP redirects to HTTPS ($RCODE)";; *) bad "HTTP returned $RCODE, expected a redirect";; esac

check "health endpoint reports ok" '"status"' "$API/health"

head_ "Commercial layer (public)"
check "pricing registry serves all three plans" 'enterprise' "$API/platform/plans"
check "plans carry a price"                     '39'         "$API/platform/plans"
check "AI model tiering is exposed"             'Haiku'      "$API/platform/plans"
check "web-lookup feature is priced"            'ai_web'     "$API/platform/plans"

head_ "Security posture"
# An unauthenticated caller must get 401/403 from tenant data, never 200.
for path in /inventory/items /employees /reports/pnl /assistant/usage; do
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$API$path")
  case "$C" in
    401|403) ok "unauthenticated $path is refused ($C)";;
    *)       bad "unauthenticated $path returned $C — expected 401/403";;
  esac
done

# Security headers worth having in front of a paying customer's data.
HDRS=$(curl -sI --max-time 20 "$BASE/" 2>/dev/null)
printf '%s' "$HDRS" | grep -qi "strict-transport-security" \
  && ok "HSTS header present" || bad "HSTS header missing"

head_ "Developer page (pandi-dev)"
DEV="https://pandi-dev.dineai.cloud"
DCODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$DEV/" 2>/dev/null)
case "$DCODE" in
  200) ok "pandi-dev serves 200 (page is ON)"
       DBODY=$(curl -s --max-time 25 "$DEV/")
       printf '%s' "$DBODY" | grep -q "Pandian Sambath" && ok "identity renders" || bad "identity missing"
       # The brief was explicit: no client names, no project detail, no packages.
       LEAK=0
       for secret in "British Airways" "Apache Camel" "LPA"; do
         printf '%s' "$DBODY" | grep -qi "$secret" && { bad "LEAKED company detail: $secret"; LEAK=1; }
       done
       [ "$LEAK" = "0" ] && ok "no company/project detail leaked"
       # The album must actually be reachable, not just referenced.
       ACODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$DEV/dev/thumb/p00.webp")
       [ "$ACODE" = "200" ] && ok "album thumbnails serve" || bad "album thumb returned $ACODE"
       ;;
  404) skip "pandi-dev returns 404 — page is switched OFF (DEV_PROFILE_ENABLED=0)";;
  *)   bad "pandi-dev returned $DCODE";;
esac

head_ "Signed-in checks"
if [ -z "${VERIFY_EMAIL:-}" ] || [ -z "${VERIFY_PASSWORD:-}" ]; then
  skip "no VERIFY_EMAIL/VERIFY_PASSWORD exported — signed-in checks not run"
else
  TOKEN=$(curl -s --max-time 20 -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$VERIFY_EMAIL\",\"password\":\"$VERIFY_PASSWORD\"}" \
    | python -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
  if [ -z "$TOKEN" ]; then
    bad "login failed for $VERIFY_EMAIL — remaining checks skipped"
  else
    ok "login succeeds"
    AUTH="Authorization: Bearer $TOKEN"
    check "inventory returns data"        '\['            -H "$AUTH" "$API/inventory/items"
    check "hotel settings expose timezone" 'timezone'     -H "$AUTH" "$API/hotels/me"
    check "AI usage/allowance is readable" 'requests'     -H "$AUTH" "$API/assistant/usage"
    check "plan + model are reported"      'model'        -H "$AUTH" "$API/assistant/usage"
  fi
fi

head_ "Result"
printf '  %d passed, %d failed, %d skipped\n\n' "$PASS" "$FAIL" "$SKIP"
exit "$FAIL"
