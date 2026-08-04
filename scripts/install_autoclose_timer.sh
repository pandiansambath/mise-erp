#!/usr/bin/env bash
# Daily trial-expiry sweep, on a systemd timer.
#
# Same reasoning as the backup timer: this box has no cron daemon, so anything
# written to /etc/cron.d is read by nothing. systemd is what starts Docker, so
# it is guaranteed present.
#
# 01:15 UTC, deliberately AFTER the latest plausible service and BEFORE the
# 02:30 backup, so a night's drawer is settled before it is backed up.
#
# The job itself works out "yesterday" in each HOTEL's timezone, so the exact
# hour here only decides how soon after a local midnight the sweep happens - it
# never closes a day that is still trading somewhere.
set -eu

cat > /etc/systemd/system/dineai-autoclose.service <<'UNIT'
[Unit]
Description=DineAI nightly cash-drawer auto-close
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
# Runs inside the backend container so it shares the app's DB credentials and
# settings - nothing about the database needs to exist on the host.
ExecStart=/usr/bin/docker exec mise-backend-1 python -m app.sales.autoclose
StandardOutput=journal
StandardError=journal
UNIT

cat > /etc/systemd/system/dineai-autoclose.timer <<'UNIT'
[Unit]
Description=Close any drawer left open overnight

[Timer]
OnCalendar=*-*-* 01:15:00
# Catch up after downtime. The job is idempotent (it records which trial end
# date it warned about), so a late run is safe and a skipped one is not.
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now dineai-autoclose.timer

echo "== timer state =="
systemctl is-enabled dineai-autoclose.timer
systemctl is-active dineai-autoclose.timer
systemctl list-timers dineai-autoclose.timer --no-pager | head -3
