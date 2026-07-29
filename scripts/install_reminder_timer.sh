#!/usr/bin/env bash
# Daily trial-expiry sweep, on a systemd timer.
#
# Same reasoning as the backup timer: this box has no cron daemon, so anything
# written to /etc/cron.d is read by nothing. systemd is what starts Docker, so
# it is guaranteed present.
#
# 08:00 UTC on purpose. This mail asks someone to go and find a card, so it
# should land at the start of a working day, not at 03:00 with the backups.
set -eu

cat > /etc/systemd/system/dineai-trial-reminders.service <<'UNIT'
[Unit]
Description=DineAI daily trial-expiry reminders
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
# Runs inside the backend container so it shares the app's DB credentials and
# settings - nothing about the database needs to exist on the host.
ExecStart=/usr/bin/docker exec mise-backend-1 python -m app.billing.reminders
StandardOutput=journal
StandardError=journal
UNIT

cat > /etc/systemd/system/dineai-trial-reminders.timer <<'UNIT'
[Unit]
Description=Run the DineAI trial-expiry sweep each morning

[Timer]
OnCalendar=*-*-* 08:00:00
# Catch up after downtime. The job is idempotent (it records which trial end
# date it warned about), so a late run is safe and a skipped one is not.
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now dineai-trial-reminders.timer

echo "== timer state =="
systemctl is-enabled dineai-trial-reminders.timer
systemctl is-active dineai-trial-reminders.timer
systemctl list-timers dineai-trial-reminders.timer --no-pager | head -3
