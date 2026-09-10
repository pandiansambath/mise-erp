# DineAI on AWS — what we use, what it costs, and the plan for after the credits

Account **887514555232**, region **eu-west-2** (London).
All figures pulled live from Cost Explorer, CloudWatch, ECR, EC2 and RDS on
**10 September 2026**. Nothing here is estimated except where it says so.

---

## 1. First: what "forecast" means

**A forecast is not a bill and not money you owe.** It is AWS guessing what
your month *will* total, based on your spending so far.

The email came from a budget alarm we set up ourselves:

| | |
|---|---|
| Budget `mise-monthly-all` | limit **$40/month** |
| **Actual spend right now** | **$0.00** |
| AWS's guess for September | **$61.79** ← the $60 in the email |

It is set to warn when the *guess* crosses $40. The guess crossed $40, so it
warned. Nothing has been charged.

**And the guess is too high.** Real usage 1–9 September is **$10.77**, steady
at **$1.20/day**. Thirty days of that is **~$36**, not $62. AWS's forecaster is
still weighing August, which was an unusual month.

### Now your actual question: is it real money if the credits weren't there?

**Yes.** This is the important bit and you are right to ask it.

Your account is on the **new AWS free tier** (accounts opened after mid-2025):
instead of the old "12 months of free small servers", you get a **credit pot**
— yours is **$200**. Every month AWS calculates the real bill and then spends
your credits to pay it.

So the bill is genuinely being generated. You can see both halves:

| Month | Real cost generated | Credits spent | You paid |
|---|---:|---:|---:|
| Jul 2026 | $9.22 | −$9.22 | $0.00 |
| Aug 2026 | $41.91 | −$41.91 | $0.00 |
| Sep 2026 (to 9th) | $10.77 | −$10.77 | $0.00 |
| **Burned so far** | **$61.90** | **−$61.90** | **$0.00** |

**Roughly $138 of the $200 is left.** When it hits zero, the number in that
column starts coming out of your bank account. That is the whole reason this
document exists.

> Please confirm the exact remaining balance in the console — **Billing →
> Credits**. AWS gives no API for it, so $138 is my arithmetic, not their
> figure. The expiry date matters too: credits expire whether you use them or
> not.

---

## 2. Every service we use, month by month

Real cost generated, credits ignored. This is the honest picture.

| Service | What it does for DineAI | Jul | Aug | Sep (9d) |
|---|---|---:|---:|---:|
| **RDS `db.t4g.micro`** | The PostgreSQL database. Every hotel, order, staff record. | $3.78 | $13.39 | $3.87 |
| **EC2 `t3.micro`** | The one server. Runs Caddy, the FastAPI backend, the Next.js frontend, all in Docker. | $2.48 | $8.78 | $2.52 |
| **ECR storage** | Docker images built by each deploy. | $0.09 | $2.53 | $1.40 |
| **VPC — public IPv4** | The fixed address `18.171.43.0` that dineai.cloud points at. | $1.05 | $3.72 | $1.07 |
| **RDS storage (20 GB)** | The database's disk. | $0.75 | $2.66 | $0.79 |
| **EBS (20 GB)** | The server's disk. | $0.53 | $1.86 | $0.55 |
| **Bedrock — Claude Sonnet** | The table assistant and the operator copilot. | $0.48 | $8.42 | $0.48 |
| **RDS backups** | Automated 7-day backups. | $0.00 | $0.12 | $0.06 |
| **Polly** | Voice output. | $0.00 | $0.36 | $0.03 |
| **S3 / Cost Explorer / Glue / KMS / CloudWatch** | Uploads (18 MB), terraform state, logs. | $0.03 | $0.06 | $0.01 |
| | **Total** | **$9.22** | **$41.91** | **$10.77** |

### Why July looks cheap and August looks expensive

Nothing ran away. Two plain reasons:

1. **July was only about a week.** We moved to this account on 23 July and the
   server started on 29 July. August was the first *complete* month. That is
   most of the jump.
2. **Bedrock was $8.42 in August and $0.48 in September.** That was me building
   and testing the AI — the audit, the table assistant, the copilot. It is
   development traffic, it has already stopped, and diners are not generating
   it.

August's Bedrock spend in detail:

| Token type | Cost | Volume |
|---|---:|---:|
| Cache write | $3.04 | 0.74 M |
| Input | $2.54 | 0.77 M |
| Output | $1.90 | 0.12 M |
| Cache read | $0.94 | 2.84 M |

2.84 M cache *reads* against 0.74 M cache *writes* means prompt caching is
working properly — cache reads are roughly a tenth the price of fresh input.

---

## 3. What is actually running

| | |
|---|---|
| EC2 | 1 × `t3.micro` (x86), `i-09049816839b96b76`, up since 29 July |
| RDS | 1 × `db.t4g.micro`, `mise-db`, 20 GB, Multi-AZ **off**, 7-day backups |
| EBS | 1 × 20 GB gp3, attached |
| Elastic IP | 1 × `18.171.43.0`, attached |
| S3 | `mise-uploads` 18 MB (149 files) · `mise-tfstate` 47 KB |
| ECR | `mise-frontend` 447 images · `mise-backend` 449 images |
| CloudWatch Logs | `/dineai/app` 228 MB · `/dineai/bedrock` 6 MB |

**I searched for waste and found almost none:**

- ✅ No unattached EBS volumes
- ✅ No orphaned snapshots (EBS or RDS)
- ✅ No idle Elastic IPs
- ✅ **No NAT Gateway** (that one alone would have been ~$35/month)
- ✅ No load balancers
- ✅ No second region with stray resources

The architecture is lean. There is exactly one real problem.

---

## 4. The one real problem: ECR

| Repository | Images | Size |
|---|---:|---:|
| `mise-frontend` | 447 | 52.3 GB |
| `mise-backend` | 449 | 51.8 GB |
| **Total** | **896** | **104 GB** |

**Neither repository has a lifecycle policy.** Every deploy pushes two images
of about 115 MB and *nothing is ever deleted*. Seven weeks of deploys — mine —
built 104 GB.

At $0.10/GB-month that is **$10.17/month, growing about $2.50 every month**,
and it is the only line on the whole bill that grows on its own. It was $0.09
in July, $2.53 in August, and $1.40 in the first nine days of September.

**Your rule is right, and it is now saved to memory: keep at most 3 images per
repository.** Three is current plus two rollbacks; anything older than two
deploys is a rebuild from git, not a rollback.

This must be a **lifecycle policy**, not a one-off delete, or it grows straight
back at $2.50/month.

- Frees roughly **103 GB** → ECR drops from **$10.17 to about $0.30/month**
- **Saves ~$9.90/month — 28% of the entire bill**
- Zero risk to the running site: the live containers already have their images
  on the server, and the last three deploys stay available to roll back to

⚠️ One caution: this permanently deletes ~890 images. They are all rebuildable
from git, and I will apply it **after** the current deploy finishes so nothing
races. **Say the word and I will apply it and verify the reclaim.**

---

## 5. Are we over-provisioned? Measured, not guessed

| | Average CPU | Peak CPU |
|---|---:|---:|
| EC2 `t3.micro` | **1.0 %** | 22 % |
| RDS `db.t4g.micro` | **3.7 %** | 7 % |

Database connections average 4, peak 13. The database uses 1.7 GB of its 20 GB.

Both machines are nearly idle — **but neither can usefully shrink.**
`db.t4g.micro` is the smallest RDS instance AWS sells, 20 GB is the smallest
RDS disk, and `t3.nano` (the only step below `t3.micro`) has 0.5 GB of RAM,
which will not hold Caddy plus Next.js plus FastAPI plus Postgres clients.
Trying it would trade $2/month for an outage.

So the savings are not in shrinking. They are in **paying less for the same
machines**, and in stopping the waste.

---

## 6. The plan, in the order I would do it

### Now — free, no commitment, no risk

**① ECR lifecycle policy, keep 3.** Saves **$9.90/month (28%)**. Five minutes.
Do this one first regardless of everything else.

**② Move the budget off forecast.** `mise-monthly-all` at $40 will keep
emailing you about a guess. Change the alert to fire on **actual spend** at
$40, and keep a separate forecast alert at a level that means something. You
stop getting cried wolf at, and you still get warned for real.

**③ Get the credit balance and expiry.** Billing → Credits. It sets the
deadline for everything below.

**Result: ~$42.75/month → ~$32.40/month, and it stops growing.**

### Before the credits run out — needs a 1-year commitment

**④ Reserved Instances on RDS and EC2.** These machines are never going to be
switched off, so paying on-demand for them is simply the expensive way.

**These are real quotes from the AWS API for eu-west-2, not estimates.** My
first draft of this document guessed and guessed low; here are the actual
numbers.

| | On-demand /hr | 1-yr No Upfront /hr | Per month | Saves |
|---|---:|---:|---:|---:|
| RDS `db.t4g.micro` (Single-AZ) | $0.0180 | **$0.0130** | $13.39 → $9.67 | **$3.72** (28%) |
| EC2 `t3.micro` (standard) | $0.0118 | **$0.0074** | $8.78 → $5.51 | **$3.27** (37%) |
| EC2 `t4g.micro` (standard, ARM) | $0.0092 | **$0.0059** | $8.78 → $4.39 | **$4.39** (50%) |

Two notes on the fine print:

- **Standard, not convertible.** Convertible RIs quote $0.0096/hr for the same
  `t3.micro` — barely better than on-demand. The flexibility is not worth 30%
  here; we are not going to change instance family on a whim.
- **Single-AZ.** The Multi-AZ RDS offering is exactly double ($0.026/hr). We
  run Single-AZ deliberately and should keep doing so at this scale.

**⑤ There is a smarter version of ④ — spend the credits on the RI.**

RDS also sells **All Upfront** at **$106 for the year**, which is $8.83/month
equivalent — better than the $9.67 No-Upfront rate. And an upfront RI purchase
can be paid for **with your existing credits**.

So: spend $106 of the remaining ~$138 now, and the database costs nothing at
all until September 2027. Rough twelve-month comparison:

| | Credits burn out | Cash out over 12 months |
|---|---|---:|
| Do nothing but ① | ~4.3 months | **~$250** |
| ① + All-Upfront RDS RI bought with credit | ~2 months | **~$190** |

It saves roughly **$60 over the year**, at the cost of committing to RDS for
twelve months and having less credit runway in the meantime. Worth doing *if*
you are confident DineAI stays on this database for a year — which I think you
are, but it is your call, not mine, and it is not reversible.

### Optional, more effort

**⑥ Move EC2 to Graviton (`t4g.micro`, ARM).** Same size, and combined with a
reservation it is the single biggest infrastructure saving available:
$8.78 → **$4.39/month, a 50% cut**. It needs the Docker images rebuilt for
`arm64` and a careful cutover with the site briefly swapping instances. Do it
on a quiet afternoon, not under pressure.

**⑦ Cap CloudWatch log retention.** Currently 10 years on both groups, which
you asked for deliberately. At 228 MB it costs under a cent, so this is a
*guard*, not a saving — but 10-year retention turns into a bill quietly if the
app ever gets chatty. Suggestion: leave `/dineai/bedrock` at 10 years (it is
tiny and it is the audit trail), put `/dineai/app` on 1 year. I have not
touched it.

### Not worth doing

- **The public IPv4 ($3.72/month)** — AWS charges for every IPv4 address now.
  IPv6-only would break access for a meaningful share of UK mobile users. Pay
  it.
- **Shrinking the machines or disks** — `db.t4g.micro` is the smallest RDS
  instance sold, 20 GB is the smallest RDS disk, and the only step below
  `t3.micro` is `t3.nano` at 0.5 GB RAM, which will not hold Caddy + Next.js +
  FastAPI. That trade is $2/month against an outage.
- **Turning things off overnight** — this is a restaurant product. Evenings
  are exactly when it must be up.

---

## 7. What it adds up to

Steady state today, with ECR at its current 104 GB:

| Item | $/month |
|---|---:|
| RDS instance | 13.39 |
| ECR images | 10.40 |
| EC2 instance | 8.78 |
| Public IPv4 | 3.72 |
| RDS storage | 2.66 |
| EBS volume | 1.86 |
| Bedrock (current rate) | ~1.60 |
| RDS backups | 0.20 |
| Polly, S3, Cost Explorer | ~0.15 |
| **Today** | **~$42.75** |

*(The $36/month I quoted from the daily run rate was reading September's
part-month ECR charge. $42.75 is the honest steady-state figure, and it climbs
about $2.50 a month while ECR is unmanaged.)*

| Stage | $/month | Credits (~$138) last |
|---|---:|---|
| Today, unchanged | **~$42.75**, rising | ~3.2 months → **mid-Dec 2026** |
| ① ECR lifecycle policy | **~$32.40** | ~4.3 months → **mid-Jan 2027** |
| ① + RDS & EC2 reservations | **~$25.40** | ~5.4 months → **late Feb 2027** |
| ① + reservations + Graviton | **~$24.30** | ~5.7 months → **early Mar 2027** |

**The short version:** you are not in trouble. The whole stack is one small
server, one small database and an IP address, and it is architecturally clean
— no NAT gateway, no load balancer, no idle disks, nothing forgotten and left
running. About a quarter of what it costs today is old Docker images nobody
will ever pull, and that is free to fix in five minutes.

After the credits, a properly tuned DineAI runs for **roughly $24–25/month —
about £19**. For a live multi-tenant SaaS with a managed database, HTTPS,
CI/CD, backups and an AI assistant, that is genuinely cheap. One paying hotel
covers the infrastructure for the year.

### The thing that will actually change this number

None of the above. It is **Bedrock**, if real diners start using the table
assistant. August's $8.42 was me testing; at scale it is the only line with no
ceiling. The guardrails are already in place — a separate `mise-bedrock-ai`
budget at $10/month, prompt caching demonstrably working, and the agreed plan
to put the entry pricing tier on Haiku instead of Sonnet. Nothing to act on
today, but it is the number to watch as hotels come on.

---

*Sources: `ce get-cost-and-usage` (monthly + daily, grouped by SERVICE,
USAGE_TYPE, RECORD_TYPE, filtered to `RECORD_TYPE=Usage`),
`ce get-cost-forecast`, `budgets describe-budgets`, `ecr describe-images`
(paginated), `ec2 describe-instances/volumes/addresses/snapshots/nat-gateways`,
`rds describe-db-instances/db-snapshots`, `elbv2 describe-load-balancers`,
`s3 ls --summarize`, `cloudwatch get-metric-statistics` (EC2 + RDS CPU,
FreeStorageSpace, DatabaseConnections), `logs describe-log-groups`.*
