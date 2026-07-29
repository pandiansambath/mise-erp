#!/usr/bin/env bash
# Schedule the nightly backup with a systemd TIMER, not cron.
#
# The earlier cron attempt failed silently: this box has no cron daemon at all
# (Amazon Linux 2023 ships minimal), so /etc/cron.d was a directory nothing
# read. systemd is present by definition — it is what starts Docker.
#
# Persistent=true matters: if the instance is stopped at 02:30, the run happens
# on next boot instead of being skipped. A backup missed because the box was
# off is still a missed backup.
set -eu

cat > /etc/systemd/system/dineai-backup.service <<'UNIT'
[Unit]
Description=DineAI nightly database backup + staleness check
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/opt/mise/backup_cron.sh
StandardOutput=journal
StandardError=journal
UNIT

cat > /etc/systemd/system/dineai-backup.timer <<'UNIT'
[Unit]
Description=Run the DineAI backup nightly

[Timer]
# 02:30 UTC — quiet for a UK restaurant, and well clear of service.
OnCalendar=*-*-* 02:30:00
# Catch up after downtime rather than skipping the day entirely.
Persistent=true
# Stagger slightly so a fleet would not stampede S3 at the same instant.
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now dineai-backup.timer

echo "== timer state =="
systemctl is-enabled dineai-backup.timer
systemctl is-active dineai-backup.timer
systemctl list-timers dineai-backup.timer --no-pager | head -3
