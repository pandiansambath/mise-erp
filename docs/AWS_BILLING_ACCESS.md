# Three things on AWS that need your say-so

Measured 2026-09-16 against account 887514555232. Nothing here has been applied.
Two Cost Explorer calls were made to gather it, at $0.01 each = **$0.02**.

---

## 1. Give the server permission to read the bill (needs an apply)

The money dashboard cannot exist yet. The `mise-ec2` role can talk to Bedrock,
Polly, Transcribe, S3, ECR and CloudWatch **Logs** — and has no permission to
read Cost Explorer, Budgets, the credit balance, or CloudWatch **Metrics**.

The change is written and waiting in `infra/iam.tf` as
`aws_iam_role_policy.cost_dashboard`. It adds **one** new inline policy with
four read-only statements. It creates nothing, changes no existing permission,
and cannot write anywhere. It ships on the next deploy, or on its own with:

    cd infra && terraform plan   # expect: 1 to add, 0 to change, 0 to destroy

Running cost of what it enables: **~$1.90/month**, and that figure goes on the
dashboard itself.

---

## 2. Both budget alarms are currently watching nothing (free, 5 minutes)

**The $40 monthly budget reads $0.00 of spend.** `IncludeCredit: true` means
credits are subtracted from usage before the alarm looks, so it reads zero and
will keep reading zero *until the credits run out* — which is the exact moment
you need it to shout.

    aws budgets describe-budgets --account-id 887514555232 --region us-east-1 \
      > budget-backup.json                      # keep this before changing anything

Then in the console — **Billing and Cost Management → Budgets** — open each
budget → Edit → **uncheck "Credits"** under "Additional budget parameters".
Leave everything else alone. Free to do, free to undo.

**The $10 AI budget is also filtered on a service that no longer exists.** It
watches `Claude 3.7 Sonnet (Amazon Bedrock Edition)`; the models actually
billing today are `Claude Sonnet 4.6`, `Claude Haiku 4.5` and `Claude Opus 4.6`.
Same screen: Edit → Scope → Service → tick the three keys above (and re-tick
them whenever we change model). The AI is the only part of this system with no
spending ceiling, and this is its only alarm.

---

## 3. $40 of free credit is sitting unclaimed (free, minutes)

    aws freetier list-account-activities --region us-east-1

Two rewards still say `NOT_STARTED`: *"Use a foundation model in the Amazon
Bedrock playground"* and *"Create a web app using AWS Lambda"*. $20 each.
At the measured $1.00/day burn that is **six more weeks of runway**.

Remaining credit today, read from the API rather than guessed: **$92.23**.
The account's plan type already reads `PAID` — when the credits reach zero
nothing switches off, the charges simply begin.
