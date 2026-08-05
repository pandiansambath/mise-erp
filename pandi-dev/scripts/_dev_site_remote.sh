#!/usr/bin/env bash
# Runs ON the EC2 box. Not called directly — pandi-dev/scripts/toggle_dev_site.sh
# base64-encodes this and sends it via SSM.
#
# It exists as its own file for one reason: the earlier version embedded Python
# inside JSON inside bash, and that nesting mangles quotes in ways that only show
# up at runtime. A plain file that is base64'd across has no escaping at all.
#
# Usage on the box:  bash _dev_site_remote.sh <on|off|status>
set -eu

ACTION="${1:-status}"
COMPOSE=/opt/mise/docker-compose.yml

show_state() {
  echo "--- setting ---"
  grep "DEV_PROFILE_ENABLED" "$COMPOSE" || echo "not set (defaults to ON)"
  echo "--- live response ---"
  # --resolve, not a Host header. Two earlier attempts got this wrong:
  #   http://localhost  -> 308, because port 80 redirects every Host to https
  #   https://localhost -> 000, because the SNI was "localhost", so Caddy tried
  #                        to mint a cert for that name and the ask endpoint
  #                        (correctly) refused, killing the handshake
  # --resolve sends the real hostname in SNI while still dialling the local box.
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 15     --resolve pandi-dev.dineai.cloud:443:127.0.0.1     https://pandi-dev.dineai.cloud/ || echo "???")
  echo "pandi-dev.dineai.cloud -> $code"
}

if [ "$ACTION" = "status" ]; then
  show_state
  exit 0
fi

case "$ACTION" in
  on)  VALUE=1 ;;
  off) VALUE=0 ;;
  *)   echo "usage: $0 [on|off|status]" >&2; exit 2 ;;
esac

cd /opt/mise
cp "$COMPOSE" "$COMPOSE.bak"

python3 - "$VALUE" <<'PY'
import re
import sys

value = sys.argv[1]
path = "/opt/mise/docker-compose.yml"
text = open(path).read()

# Drop any previous setting so this is idempotent — running it twice must not
# leave two conflicting lines behind.
text = re.sub(r"^\s*DEV_PROFILE_ENABLED:.*\n", "", text, flags=re.M)

line = f'      DEV_PROFILE_ENABLED: "{value}"\n'

# The frontend service may or may not already have an environment: block.
env_block = re.search(r"^  frontend:\n(?:(?!^  \S).*\n)*?    environment:\n", text, re.M)
if env_block:
    text = text[: env_block.end()] + line + text[env_block.end() :]
else:
    anchor = re.search(r"^  frontend:\n(?:(?!^  \S).*\n)*?    restart: always\n", text, re.M)
    if not anchor:
        raise SystemExit("could not find the frontend service in the compose file")
    text = text[: anchor.end()] + "    environment:\n" + line + text[anchor.end() :]

open(path, "w").write(text)
print(f"compose updated: DEV_PROFILE_ENABLED={value}")
PY

# Validate before applying: a malformed compose file would take the whole site
# down, and this script only has the right to change one page.
if ! docker compose config >/dev/null 2>&1; then
  echo "compose file is invalid after edit — rolling back" >&2
  mv "$COMPOSE.bak" "$COMPOSE"
  exit 1
fi

docker compose up -d frontend
sleep 6
show_state
