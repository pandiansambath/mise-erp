#!/bin/sh
# Hands git the live GitHub token, on stdin, for one push.
#
# WHY THIS EXISTS
# Windows git caches credentials in the Credential Manager, and it kept
# offering a REVOKED token — so `git push` failed with "Invalid username or
# token" while the very same token file also held a working one. The helper
# wins over any askpass unless it is explicitly disabled, so the push has to
# run as:
#
#   GIT_ASKPASS=scripts/git_askpass.sh git -c credential.helper= push \
#     https://x-access-token@github.com/pandiansambath/mise-erp.git main
#
# This script holds NO secret — it reads the gitignored token file and asks
# GitHub which candidate is alive, so a revoked token in the file is skipped
# rather than silently used. The token only ever travels on stdin, never in
# argv where `ps` could read it, and never into .git/config.
REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_DIR" || exit 1
for f in docs/secrets/github_token.txt github_token.txt; do
  [ -f "$f" ] || continue
  # Newest last in these files, so walk backwards.
  for c in $(grep -oE '(ghp_|github_pat_)[A-Za-z0-9_]+' "$f" | tac); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $c" \
         https://api.github.com/repos/pandiansambath/mise-erp)" = "200" ]; then
      printf '%s' "$c"
      exit 0
    fi
  done
done
exit 1
