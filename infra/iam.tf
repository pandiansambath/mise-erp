# EC2 instance role: pull images from ECR (+ SSM for debugging shell, no key needed).
resource "aws_iam_role" "ec2" {
  name = "${var.project}-ec2"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project}-ec2"
  role = aws_iam_role.ec2.name
}

# Read/write app uploads in the private S3 bucket (document storage).
resource "aws_iam_role_policy" "s3_uploads" {
  name = "${var.project}-s3-uploads"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.uploads.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.uploads.arn
      }
    ]
  })
}

# CloudWatch Logs — the containers ship their logs here via the awslogs driver
# (see user_data.sh.tftpl). Applied by hand on the running box first; without it
# in terraform a replaced instance would lose the permission and fall back to
# local logs that die with the box.
resource "aws_iam_role_policy" "cloudwatch_logs" {
  name = "${var.project}-cloudwatch-logs"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams",
      ]
      # Scoped to our own groups — an instance role that can write anywhere in
      # CloudWatch can also bury evidence in someone else's log group.
      Resource = "arn:aws:logs:${var.region}:*:log-group:/dineai/*"
    }]
  })
}

# The assistant's brain: Claude on Bedrock — the in-app Copilot, bill reading,
# handwritten recipes, and the guest assistant on the table QR page.
#
# THIS WAS DELETED BY ACCIDENT in c8cc216 ("Textract is gone"). The Textract
# policy and this one sat next to each other, and removing Textract took Bedrock
# with it — so every AI feature started answering "the AI service is
# unavailable" with nothing in the app having changed. It cost a month.
#
# The failure was doubly hard to see because bedrock.py maps ANY AccessDenied to
# "Claude isn't switched on for this AWS account yet", which points at the
# Bedrock console — a place where everything was, correctly, already enabled.
#
# Resource "*" because the model id is configurable (BEDROCK_MODEL_ID) and the
# cross-region inference profiles resolve to several underlying model ARNs.
resource "aws_iam_role_policy" "bedrock" {
  name = "${var.project}-bedrock"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = "*"
    }]
  })
}

# The VOICE. Polly turns the assistant's reply into speech.
#
# Why Polly and not Nova Sonic, which is the obvious answer on an AWS stack:
#
#   * Nova Sonic's Python support is an EXPERIMENTAL awslabs SDK, not boto3.
#     A production dependency that ships with "experimental" on the tin, for
#     the one feature an owner talks to all day, is a bad trade.
#   * It is not in eu-west-2. London audio would cross to us-east-1 - a UK
#     restaurant's takings, read aloud, leaving the country.
#   * He said it himself: "anyway action done by claude". Claude already holds
#     every tool, every permission check and every bit of tuning we have done.
#
# So: the browser hears, Claude thinks, Polly speaks. All three stay in
# eu-west-2, all on SDKs that are not labelled experimental.
# 🎧 THE EARS.
#
# The browser's own speech API is a Chrome feature that ships the audio to
# Google, and Brave - which is what he actually uses - strips it out. There is
# no flag we can set from our side, so the ears move onto our own stack.
#
# The browser streams audio DIRECTLY to Transcribe over a presigned WebSocket:
# our server signs the URL and never touches a byte of audio, so nothing is
# proxied through the box and a long conversation costs us no bandwidth.
resource "aws_iam_role_policy" "transcribe" {
  name = "mise-transcribe"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "TranscribeStreaming"
      Effect = "Allow"
      Action = [
        "transcribe:StartStreamTranscriptionWebSocket",
        "transcribe:StartStreamTranscription",
        # Read-only, and load-bearing: the app checks the custom vocabulary is
        # READY before naming it, because naming a PENDING one makes Transcribe
        # refuse the whole connection. Without this permission that check fails
        # closed and the vocabulary is silently never used — which is exactly
        # what was happening: I granted it with the CLI and never put it HERE,
        # so the next deploy's terraform run quietly took it away again.
        "transcribe:GetVocabulary",
      ]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy" "polly" {
  name = "${var.project}-polly"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["polly:SynthesizeSpeech", "polly:DescribeVoices"]
      Resource = "*"
    }]
  })
}

# 💷 THE MONEY DASHBOARD (checklist §43) — read-only billing telemetry.
#
# Everything below is READ. There is no statement here that can create, modify
# or delete anything, and that is deliberate: this role is held by an internet-
# facing box, and the blast radius of a compromised billing reader should be
# "someone learned what we spend", never "someone changed what we spend".
#
# ⚠️ REGION TRAP FOR WHOEVER WIRES THE CLIENT: `ce`, `budgets` and `freetier`
# are GLOBAL services with endpoints only in **us-east-1**. The container's
# default region is eu-west-2, so boto3.client("ce") with no region_name fails
# with an endpoint error that reads like a permissions problem. Pass
# region_name="us-east-1" for those three; `cloudwatch` stays eu-west-2.
#
# ⚠️ `freetier:GetAccountPlanState` and `ListAccountActivities` need
# **boto3 >= 1.39.4** (verified against botocore's own service model: 1.39.3
# has only GetFreeTierUsage). We pin 1.35.80. Granting the permission without
# bumping the pin gets you an UnknownServiceError, not an AccessDenied.
#
# Costs below are from AWS's Price List API for eu-west-2/us-east-1 on
# 2026-09-16, not from memory. Budgeted call volume (2 refreshes a day, plus
# CloudWatch every 5 minutes) is ~$1.90/month, and that figure belongs ON the
# dashboard — a screen whose job is telling him what things cost cannot hide
# its own cost.
resource "aws_iam_role_policy" "cost_dashboard" {
  name = "${var.project}-cost-dashboard"
  role = aws_iam_role.ec2.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # ── 1. The bill itself. ────────────────────────────────────────────────
      # GetCostAndUsage is the only source for "what has AWS actually charged
      # us", per service, per day. GetDimensionValues enumerates the SERVICE
      # keys so the dashboard can discover a new line (a service we start
      # using) instead of showing it as "other".
      #
      # 💷 COSTS REAL MONEY: **$0.01 per API request** (price list
      # `USE1-APIRequest`, $0.0100/Request — and it is already visible on our
      # own bill as "AWS Cost Explorer · USE1-APIRequest · $0.07 · 7 requests").
      # This is the one line on the dashboard that the dashboard itself
      # inflates. At a 10-second refresh it would be $5,184/month to watch a
      # $30 bill. Hence: 2 scheduled refreshes a day, a server-side 6-hour
      # cooldown on "Refresh now" shared across all operators (per-session
      # would be defeated by two tabs), and a hard ceiling of 150 calls/month
      # enforced in code — $1.50 is the worst case this key can ever spend.
      #
      # Resource "*": GetCostAndUsage and GetDimensionValues have no
      # resource-level permissions. Cost Explorer only scopes cost categories
      # and anomaly monitors, neither of which we use.
      {
        Sid    = "CostExplorerRead"
        Effect = "Allow"
        Action = [
          "ce:GetCostAndUsage",
          "ce:GetDimensionValues",
        ]
        Resource = "*"
      },

      # ── 2. The runway. ─────────────────────────────────────────────────────
      # GetAccountPlanState returns `accountPlanRemainingCredits` — the credit
      # balance I twice told him could only be read from the console. It can
      # not. It reads $92.23 today and it reconciles with the burn to the cent.
      # This is the single most important number on the whole page: when it
      # hits zero the bill stops being free and starts being his card, and
      # `accountPlanType` already says **PAID**, so nothing switches off — the
      # charges simply begin.
      #
      # ListAccountActivities is how we found $40 of unclaimed free credit
      # sitting in the account ("use a foundation model in the Bedrock
      # playground", "create a web app using AWS Lambda", both still
      # NOT_STARTED as of 2026-09-16). Putting it on the dashboard means the
      # next unclaimed reward gets noticed by the screen, not by an audit.
      #
      # 💷 No charge. There has never been a `freetier` line on this account's
      # bill and AWS publishes no price for it.
      #
      # ⚠️ TWO READS ONLY, NEVER `freetier:*`. The same API version that added
      # these also added **UpgradeAccountPlan**, which converts the account's
      # plan. A wildcard here would let a compromised box change our billing
      # relationship with AWS.
      {
        Sid    = "FreeTierCreditBalance"
        Effect = "Allow"
        Action = [
          "freetier:GetAccountPlanState",
          "freetier:ListAccountActivities",
        ]
        Resource = "*"
      },

      # ── 3. The forecast, without paying for a forecast. ────────────────────
      # DescribeBudgets returns ForecastedSpend for free. ce:GetCostForecast
      # returns the same shape of answer at $0.01 a call. We take the free one.
      # It also surfaces each budget's limit and alert state, so the dashboard
      # can show "the $10 AI budget is at X%" rather than re-deriving it.
      #
      # 💷 Free, twice over: the API has no request charge (there is no
      # APIRequest SKU under awsbudgets at all), and `BudgetsUsage` prices at
      # **$0.00 per budget-day**.
      # ⚠️ But `ActionEnabledBudgetsUsage` is **$0.10 per budget-day** — a
      # budget with an ACTION attached costs ~$3/month. If we ever add an
      # auto-stop action to the AI budget, that is a real line item, not free.
      #
      # Scoped to this account's budgets rather than "*": budgets ARNs are
      # account-scoped and there is no reason for this role to name any other.
      {
        Sid      = "BudgetsRead"
        Effect   = "Allow"
        Action   = ["budgets:ViewBudget"]
        Resource = "arn:aws:budgets::${data.aws_caller_identity.current.account_id}:budget/*"
      },

      # ── 4. The machines. ───────────────────────────────────────────────────
      # CPU, memory, disk and connection counts for the EC2 box and the RDS
      # instance — the "what are we actually using" half of the page, and the
      # evidence for why we do not shrink either machine (EC2 averages 1.0%
      # CPU, RDS 3.7%, and neither can go smaller: db.t4g.micro is the smallest
      # RDS instance AWS sells).
      #
      # The role has NO CloudWatch metrics permission today — `mise-cloudwatch-
      # logs` above is **Logs**, a different service with a different prefix.
      # That is why nothing on the box can read a metric right now.
      #
      # 💷 Costs real money, but barely: GetMetricData is **$0.01 per 1,000
      # METRICS REQUESTED** (`EUW2-CW:GMD-Metrics`, $0.00001/metric) — priced
      # per METRIC IN THE REQUEST, not per call, so one poll asking for 12
      # metrics costs 12 units, not 1. ListMetrics is **$0.01 per 1,000
      # requests** (`EUW2-CW:Requests`), i.e. rounding error.
      #
      # The lever is HOW MANY METRICS the page asks for, not how often it asks:
      #   8 metrics every 5 min  = 70,000/month  = **$0.70/month**  ← budgeted
      #  12 metrics every 5 min  = 105,000/month = **$1.05/month**
      # $0.70 is the CloudWatch half of the agreed ~$1.90/month total (the other
      # $1.20 is Cost Explorer). Add a ninth metric and the number moves.
      #
      # ⚠️ AND DO NOT BUILD "reads and writes" ON THIS. RDS reports 0.25 read
      # IOPS/s against 9.50 write IOPS/s because nearly every read is served
      # from the buffer cache and never touches disk. A dashboard built on IOPS
      # would tell him the database barely reads, which is false. Read counts
      # come from `pg_stat_database` — free, live, and ours. CloudWatch IOPS
      # belongs on the page labelled DISK i/o, and only that.
      #
      # Resource "*": neither action supports resource-level permissions.
      {
        Sid    = "CloudWatchMetricsRead"
        Effect = "Allow"
        Action = [
          "cloudwatch:GetMetricData",
          "cloudwatch:ListMetrics",
        ]
        Resource = "*"
      },
    ]
  })
}
