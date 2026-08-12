#!/usr/bin/env bash
# Run the REAL backend suite on this machine, the way CI runs it.
#
# Why this exists: there is no local Postgres and local Python is 3.14, which
# the pinned deps do not install under. So for months CI was the only gate —
# every backend mistake cost a full deploy cycle to discover. He offered to
# start Docker for this, so it should be one command and it should be quick.
#
# THE SPEED TRAP: do NOT bind-mount the repo. A Windows folder mounted into a
# Linux container makes every Python import a cross-OS file read; `pip install`
# plus collection took over twenty minutes and had not finished. Copying the
# source in takes seconds and the run is normal speed.
#
# The image layer with the dependencies is cached, so only the first run pays
# for the install.
#
#   bash scripts/test_backend_local.sh          # whole suite + coverage gate
#   bash scripts/test_backend_local.sh -k packs # one file or one test
#
# Docker Desktop heats his laptop, so stop it when you are done:
#   bash scripts/test_backend_local.sh --down
set -euo pipefail
cd "$(dirname "$0")/.."

NET=mise-test
DB=mise-test-db
IMG=mise-backend-test

if [ "${1:-}" = "--down" ]; then
  docker rm -f "$DB" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "test database and network removed. Quit Docker Desktop to stop the fans."
  exit 0
fi

docker network create "$NET" >/dev/null 2>&1 || true

if ! docker ps --format '{{.Names}}' | grep -q "^${DB}$"; then
  docker rm -f "$DB" >/dev/null 2>&1 || true
  docker run -d --name "$DB" --network "$NET" \
    -e POSTGRES_DB=mise_test -e POSTGRES_USER=mise -e POSTGRES_PASSWORD=mise \
    postgres:16-alpine >/dev/null
  echo "starting postgres…"
  for _ in $(seq 1 20); do
    docker exec "$DB" pg_isready -U mise >/dev/null 2>&1 && break
    sleep 2
  done
fi

# The source is COPIED INTO the image, not mounted.
#
# Two reasons. A Windows folder bind-mounted into a Linux container makes every
# Python import a cross-OS file read — `pip install` plus collection ran over
# twenty minutes and never finished. And Git Bash rewrites $(pwd) into a path
# Docker cannot resolve, so the mount silently produced an EMPTY directory and
# pytest reported "no tests ran" while looking like it had worked.
#
# The dependency layer is cached, so only a change to requirements costs
# anything; copying the source is a second or two.
docker build -q -t "$IMG" -f - . >/dev/null <<'DOCKERFILE'
FROM python:3.12-slim
WORKDIR /app
# BOTH files: requirements-dev.txt begins with `-r requirements.txt`, so
# copying only the dev one gives "could not open requirements.txt".
COPY backend/requirements.txt backend/requirements-dev.txt ./
RUN pip install --no-cache-dir -q -r requirements-dev.txt
COPY backend/ .
DOCKERFILE

# A FRESH schema every run. conftest does drop_all + create_all itself, so a
# database still holding the last run's tables fails with `relation "users"
# already exists`. Invisible in CI, which gets a new container each time.
# (And note there is no `alembic upgrade head` below: migrating first creates
#  tables conftest cannot drop. CI migrates because CI is also testing that the
#  migrations apply — a different job, still covered on every push.)
# OLD NOTE: conftest builds its own tables, so a database that
# still has last run's schema fails with `relation "users" already exists` —
# which is invisible in CI because CI gets a brand new container each time and
# this reuses one. Dropping the schema is the whole difference.
docker exec "$DB" psql -U mise -d mise_test -q   -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null 2>&1 || true

echo "running the suite…"
docker run --rm --network "$NET"   -e DATABASE_URL="postgresql+asyncpg://mise:mise@${DB}:5432/mise_test"   -e SECRET_KEY=ci-secret   "$IMG" bash -lc 'exec pytest -q "$@" --cov=app --cov-fail-under=70' bash "$@"
