#!/usr/bin/env bash
# Runs ON the EC2 box. Sets one environment variable on the backend container.
#
# Called by scripts/set_backend_env.sh, which base64s this across via SSM so no
# quoting survives the trip through JSON.
#
# WHY NOT TERRAFORM: the instance sets user_data_replace_on_change = true, so
# adding a variable to infra/user_data.sh.tftpl REBUILDS THE WHOLE BOX. That is
# the right home for a value on day one and the wrong tool for adding a key to a
# running system.
#
# THE TRADE, PLAINLY: this lives on the box, so a full box REPLACEMENT loses it
# and the feature silently returns to "not configured". Every integration here
# is written to report itself as off rather than fail, so the failure mode is a
# feature going quiet — not an outage. Re-run this after a rebuild.
#
# Usage:  bash _set_backend_env_remote.sh NAME value
set -eu

NAME="${1:?usage: $0 NAME value}"
VALUE="${2:?usage: $0 NAME value}"
COMPOSE=/opt/mise/docker-compose.yml

cd /opt/mise
cp "$COMPOSE" "$COMPOSE.bak"

NAME="$NAME" VALUE="$VALUE" python3 - <<'PY'
import os
import re

name = os.environ["NAME"]
value = os.environ["VALUE"]
path = "/opt/mise/docker-compose.yml"
text = open(path).read()

# Drop any previous setting for this name inside the backend service, so running
# twice is a correction rather than two lines that later disagree.
text = re.sub(rf"^\s*{re.escape(name)}:.*\n", "", text, flags=re.M)

line = f'      {name}: "{value}"\n'
block = re.search(r"^  backend:\n(?:(?!^  \S).*\n)*?    environment:\n", text, re.M)
if not block:
    raise SystemExit("could not find the backend service's environment block")

text = text[: block.end()] + line + text[block.end() :]
open(path, "w").write(text)
print(f"compose updated: {name} set ({len(value)} chars)")
PY

# Validate before applying: a malformed compose file would take the whole site
# down, and this script only has the right to add one variable.
if ! docker compose config >/dev/null 2>&1; then
  echo "compose invalid after edit — rolling back" >&2
  mv "$COMPOSE.bak" "$COMPOSE"
  exit 1
fi

docker compose up -d backend
sleep 8

# Confirm the container actually has it, WITHOUT printing the value.
docker exec mise-backend-1 sh -c "test -n \"\$$NAME\" && echo 'container has $NAME (value hidden)' || echo 'MISSING $NAME'"
curl -s -o /dev/null -w 'backend health: %{http_code}\n' http://localhost:8000/api/health || true
