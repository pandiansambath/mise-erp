"""Build the CloudWatch dashboard — one screen that says whether we are OK.

The point is not to show every metric AWS offers. It is to answer, in the order
a person actually asks them:

  1. Is it up, and is anyone getting errors?
  2. Is the machine about to fall over?
  3. Is the database healthy, and is it backed up?
  4. Is the AI spending money?
  5. What is going wrong right now, in words?

Everything on it is FREE: a dashboard is free up to 3 per account, and every
metric used here is one AWS already publishes. Nothing here creates a custom
metric, because custom metrics cost $0.30 each per month and this is a startup
watching every pound.

    python scripts/build_dashboard.py
"""
from __future__ import annotations

import json
import subprocess

REGION = "eu-west-2"
DASHBOARD = "DineAI"
DB = "mise-db"
LOG_GROUP = "/dineai/app"


def instance_id() -> str:
    out = subprocess.run(
        ["aws", "ec2", "describe-instances", "--region", REGION,
         "--filters", "Name=tag:Name,Values=mise-app", "Name=instance-state-name,Values=running",
         "--query", "Reservations[0].Instances[0].InstanceId", "--output", "text"],
        capture_output=True, text=True, check=True,
    )
    return out.stdout.strip()


def build(iid: str) -> dict:
    """24 hours by default: long enough to show last night's backup and the
    evening service, short enough that a spike is still visible."""
    w: list[dict] = []

    def text(markdown: str, *, x: int, y: int, width: int = 24, height: int = 2) -> None:
        w.append({"type": "text", "x": x, "y": y, "width": width, "height": height,
                  "properties": {"markdown": markdown}})

    def metric(title: str, metrics: list, *, x: int, y: int, width: int = 8, height: int = 6,
               stat: str = "Average", period: int = 300, extra: dict | None = None) -> None:
        props = {
            "title": title, "region": REGION, "metrics": metrics,
            "stat": stat, "period": period, "view": "timeSeries", "stacked": False,
        }
        if extra:
            props.update(extra)
        w.append({"type": "metric", "x": x, "y": y, "width": width, "height": height,
                  "properties": props})

    # ── 1. Is anything broken? ───────────────────────────────────────────────
    text("# DineAI — is everything OK?\n"
         "Read top to bottom. Anything **red or climbing** wants attention; a flat "
         "line at zero is a good day.", x=0, y=0)

    # Errors first, because that is the question that matters most and a chart
    # buried three rows down is a chart nobody sees.
    w.append({
        "type": "log", "x": 0, "y": 2, "width": 24, "height": 6,
        "properties": {
            "title": "Errors in the last 24h — what is actually going wrong",
            "region": REGION,
            # The structured format we log in: timestamp | LEVEL | CODE | hotel | req | message
            "query": (
                f"SOURCE '{LOG_GROUP}' | fields @timestamp, @message"
                " | filter @message like /ERROR|CRITICAL/"
                " | sort @timestamp desc | limit 40"
            ),
            "view": "table",
        },
    })

    # ── 2. The machine ───────────────────────────────────────────────────────
    text("## The machine (EC2) — everything runs here, so it falling over is total", x=0, y=8)
    metric("CPU %", [["AWS/EC2", "CPUUtilization", "InstanceId", iid]], x=0, y=10,
           extra={"yAxis": {"left": {"min": 0, "max": 100}},
                  "annotations": {"horizontal": [
                      {"label": "sustained load", "value": 80, "color": "#d13212"}]}})
    metric("Network in/out (bytes)", [
        ["AWS/EC2", "NetworkIn", "InstanceId", iid],
        [".", "NetworkOut", ".", "."],
    ], x=8, y=10)
    # A failing status check means the box is unreachable — the one EC2 metric
    # that maps directly to "the site is down".
    metric("Status checks (0 = healthy)", [
        ["AWS/EC2", "StatusCheckFailed", "InstanceId", iid],
        [".", "StatusCheckFailed_Instance", ".", "."],
        [".", "StatusCheckFailed_System", ".", "."],
    ], x=16, y=10, stat="Maximum")

    # ── 3. The database ──────────────────────────────────────────────────────
    text("## The database (RDS) — where every restaurant's data actually lives.\n"
         "Automated backups: **7 days**, taken 04:10–04:40 UTC. Deletion protection **on**.",
         x=0, y=16, height=3)
    metric("DB CPU %", [["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", DB]], x=0, y=19,
           extra={"yAxis": {"left": {"min": 0, "max": 100}}})
    # Free storage is the one that kills a database silently: it fills, writes
    # fail, and nothing else looks wrong until it does.
    metric("Free storage (bytes) — never let this reach zero", [
        ["AWS/RDS", "FreeStorageSpace", "DBInstanceIdentifier", DB]], x=8, y=19,
        extra={"annotations": {"horizontal": [
            {"label": "2 GB left", "value": 2_000_000_000, "color": "#d13212"}]}})
    metric("Connections & free memory", [
        ["AWS/RDS", "DatabaseConnections", "DBInstanceIdentifier", DB],
        [".", "FreeableMemory", ".", "."],
    ], x=16, y=19)

    # ── 4. The AI, which is the only unbounded spend ─────────────────────────
    text("## The AI (Bedrock) — the only part that can run up a bill on its own.\n"
         "Budget alerts fire by email at **$2.50 / $5 / $10**.", x=0, y=25, height=3)
    metric("Model invocations", [
        ["AWS/Bedrock", "Invocations"]], x=0, y=28, stat="Sum")
    metric("Tokens in / out — this is what you pay for", [
        ["AWS/Bedrock", "InputTokenCount"],
        [".", "OutputTokenCount"],
    ], x=8, y=28, stat="Sum")
    metric("Model latency & errors", [
        ["AWS/Bedrock", "InvocationLatency"],
        [".", "InvocationClientErrors"],
        [".", "InvocationServerErrors"],
    ], x=16, y=28, stat="Sum")

    # ── 5. Who is using it ───────────────────────────────────────────────────
    text("## Activity — which restaurants are actually using this, and for what",
         x=0, y=34)
    w.append({
        "type": "log", "x": 0, "y": 36, "width": 12, "height": 6,
        "properties": {
            "title": "Busiest hotels (24h)",
            "region": REGION,
            # hotel= is bound on every authenticated request; before this was
            # fixed every line read hotel=- and this panel was impossible.
            "query": (
                f"SOURCE '{LOG_GROUP}' | fields @message"
                " | parse @message /hotel=(?<hotel>[^ ]+)/"
                " | filter hotel != '-' and hotel != ''"
                " | stats count(*) as requests by hotel"
                " | sort requests desc | limit 15"
            ),
            "view": "table",
        },
    })
    w.append({
        "type": "log", "x": 12, "y": 36, "width": 12, "height": 6,
        "properties": {
            "title": "Error codes seen (24h) — DINE-B backend, A ai, I infra",
            "region": REGION,
            "query": (
                f"SOURCE '{LOG_GROUP}' | fields @message"
                " | parse @message /(?<code>DINE-[A-Z]\\d{4})/"
                " | filter ispresent(code)"
                " | stats count(*) as seen by code"
                " | sort seen desc | limit 15"
            ),
            "view": "table",
        },
    })

    return {"widgets": w}


def main() -> None:
    iid = instance_id()
    body = json.dumps(build(iid))
    subprocess.run(
        ["aws", "cloudwatch", "put-dashboard", "--region", REGION,
         "--dashboard-name", DASHBOARD, "--dashboard-body", body],
        check=True, capture_output=True, text=True,
    )
    print(f"dashboard '{DASHBOARD}' written (instance {iid})")
    print(
        f"https://{REGION}.console.aws.amazon.com/cloudwatch/home"
        f"?region={REGION}#dashboards:name={DASHBOARD}"
    )


if __name__ == "__main__":
    main()
