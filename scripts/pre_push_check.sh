#!/usr/bin/env bash
# Everything CI will run, run here first.
#
# This exists because a deploy failed twice on things that were visible locally
# and were missed by the way the output was being read:
#
#   * `npm run lint` piped through a grep that matched none of the four errors
#     it printed — a silent pass that was never a pass
#   * the backend coverage gate, which no local command was checking at all
#
# A green commit is not a green deploy. Run this before every push.
set -u
cd "$(dirname "$0")/.." || exit 1
fail=0

step() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

step "frontend · typecheck"
(cd frontend && npx tsc --noEmit) || fail=1

step "frontend · lint (errors only — warnings are allowed by CI)"
lint_out=$(cd frontend && npm run lint 2>&1)
echo "$lint_out" | grep -E "problems|✖" | tail -2
# Count real errors, not the word "error" appearing in a rule name or a URL.
if echo "$lint_out" | grep -qE "✖ .* \([1-9][0-9]* errors?"; then
  echo "$lint_out" | grep -E "^\s+[0-9]+:[0-9]+\s+error" | head -20
  fail=1
fi

step "frontend · build"
(cd frontend && npm run build >/dev/null 2>&1) || { echo "BUILD FAILED"; fail=1; }

step "backend · ruff (runs BEFORE pytest in CI)"
(cd backend && python -m ruff check .) || fail=1

step "backend · cross-module imports"
python scripts/check_imports.py || fail=1

step "backend · coverage gate"
# The gate is 70%. pytest needs a live Postgres, so this only runs where one is
# reachable; where it is not, say so rather than implying a pass.
#
# This used to read:
#     (cd backend && python -m pytest -q 2>&1 | tail -5) || fail=1
# which checks the exit code of TAIL, not of pytest. `tail` always succeeds, so
# a crashed suite printed its traceback and the script still declared
# "everything CI checks locally is green". The whole point of this file is to
# stop a red thing being pushed, and it was structurally incapable of it.
#
# So: probe the database FIRST, then run pytest capturing its own status. A
# missing database is a genuine skip; anything else is a failure.
db_up=$(
  cd backend && python - <<'PY' 2>/dev/null || echo no
import os, socket
url = os.environ.get("DATABASE_URL", "postgresql+asyncpg://mise:mise@db:5432/mise")
netloc = url.split("@")[-1].split("/")[0]
host, _, port = netloc.partition(":")
s = socket.socket()
s.settimeout(1.5)
try:
    s.connect((host, int(port or 5432)))
    print("yes")
except Exception:
    print("no")
finally:
    s.close()
PY
)

if [ "$db_up" != "yes" ]; then
  echo "SKIPPED — no Postgres reachable for the tests. CI enforces the 70% gate."
  echo "New modules without tests WILL fail the deploy: watch the run afterwards."
elif (cd backend && python -c "import asyncpg, sqlalchemy" 2>/dev/null); then
  out=$(cd backend && python -m pytest -q 2>&1); rc=$?
  printf '%s\n' "$out" | tail -5
  [ "$rc" -eq 0 ] || fail=1
else
  echo "SKIPPED — backend deps not installed here. CI enforces the 70% gate."
fi

printf '\n'
if [ "$fail" -eq 0 ]; then
  echo "✅ everything CI checks locally is green"
else
  echo "❌ something CI checks is red — fix before pushing"
fi
exit "$fail"
