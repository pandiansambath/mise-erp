# Open a local tunnel to the (private) RDS Postgres, via the EC2 box, using AWS SSM.
# No SSH key, no opening the database to the internet — the box's IAM role already
# allows SSM, and RDS only accepts connections from that box.
# commannd --> powershell -ExecutionPolicy Bypass -File .\db-tunnel.ps1
# Prereqs (one-time):
#   1) Windows clock must be correct  (Settings > Time & language > Sync now)
#   2) AWS CLI v2 configured           (aws sts get-caller-identity should work)
#   3) Session Manager plugin installed:
#      https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html
#
# Then run:   powershell -File scripts/db-tunnel.ps1
# Leave it running, and point a GUI (DBeaver / TablePlus / pgAdmin) or psql at:
#   host=localhost  port=5433  database=mise  user=miseadmin  password=<your password>
# (miseadmin = full read+write. A read-only `viewer` login also exists if you prefer.)

$ErrorActionPreference = "Stop"
$Region   = "eu-west-2"
$RdsHost  = "mise-db.ctcc0gayk2gw.eu-west-2.rds.amazonaws.com"
$LocalPort = "5433"

Write-Host "Finding the app server..." -ForegroundColor Cyan
$InstanceId = (aws ec2 describe-instances --region $Region `
  --filters "Name=tag:Name,Values=mise-app" "Name=instance-state-name,Values=running" `
  --query "Reservations[].Instances[].InstanceId" --output text).Trim()

if (-not $InstanceId) { throw "No running mise-app instance found (check clock + AWS creds)." }
Write-Host "Instance: $InstanceId" -ForegroundColor Green
Write-Host "Tunnel: localhost:$LocalPort  ->  $RdsHost:5432" -ForegroundColor Green
Write-Host "Connect a DB client to localhost:$LocalPort (db=mise, user=miseadmin). Ctrl+C to stop.`n" -ForegroundColor Yellow

aws ssm start-session --region $Region --target $InstanceId `
  --document-name AWS-StartPortForwardingSessionToRemoteHost `
  --parameters "host=$RdsHost,portNumber=5432,localPortNumber=$LocalPort"
