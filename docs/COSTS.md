# What DineAI costs to run

Real figures from the account (`887514555232`, eu-west-2), not brochure numbers.
**Month-to-date spend: $0.00** — everything is inside AWS free tier today.

The number that matters is not today's bill; it's what happens when free tier
ends and when customers arrive. Both are below.

---

## What's actually running

| Service | What we run | Now | After free tier |
|---|---|---|---|
| **EC2** | 1 × `t3.micro` (app + Caddy + frontend) | £0 | **~£6.60/mo** |
| **RDS Postgres** | 1 × `db.t4g.micro`, 20 GB, single-AZ | £0 | **~£10.30/mo** |
| **S3** | 2 buckets (uploads + backups) | £0 | ~£0.20/mo at 10 GB |
| **ECR** | Docker images | £0 | ~£0.08/mo |
| **CloudWatch Logs** | app + Bedrock, 10-yr retention | £0 | ~£0.40/mo |
| **Data transfer** | out to the internet | £0 | ~£0.50/mo |
| **Bedrock (AI)** | Haiku / Sonnet 4.6, per token | ~£0 | **see below** |
| **Route53** | none — DNS is at Namecheap | £0 | £0 |
| **Resend** (email) | 3,000/mo free | £0 | £0 until 3k |
| **Stripe** | 1.5% + 20p per charge | £0 | % of revenue |

**⚠️ Free tier ends ~July 2027** (12 months from account creation). That is when
EC2 and RDS start billing — roughly **£17/month** appears overnight. Worth a
calendar note; it is the single biggest step change in this table.

---

## AI — the only cost that scales with use

Everything above is fixed. Bedrock is per token, and it is the one line that
grows with customers.

Per rate card: **Haiku** $0.80/$4.00 per 1M tokens (in/out) · **Sonnet 4.6**
$3.00/$15.00. Prompt caching cuts repeat input to ~10%.

Rough cost per action:

| Action | Model | Cost |
|---|---|---|
| A chat question | Haiku (Starter) | ~£0.002 |
| A chat question | Sonnet (Pro) | ~£0.010 |
| Scanning a bill photo | Sonnet | ~£0.020 |
| Daily insights (once/day/hotel) | Sonnet | ~£0.008 |

---

## Three scenarios

Assumes typical use, not the plan caps — nobody hits their cap.

### 1 hotel (you, today)
| | |
|---|---|
| Infrastructure | **£0** (free tier) |
| AI | ~£1/mo |
| **Total** | **~£1/mo** |

### 10 hotels (7 Starter, 3 Pro)
| | |
|---|---|
| Infrastructure | £0 now · ~£18/mo after free tier |
| AI | ~£12/mo |
| Stripe fees | ~£9/mo |
| **Total cost** | **~£21/mo now · ~£39 later** |
| **Revenue** | 7×£39 + 3×£99 = **£570/mo** |
| **Margin** | **~93%** |

### 50 hotels (30 Starter, 18 Pro, 2 Enterprise)
| | |
|---|---|
| Infrastructure | ~£45/mo (needs a bigger box by here) |
| AI | ~£70/mo |
| Stripe fees | ~£48/mo |
| **Total cost** | **~£163/mo** |
| **Revenue** | 30×£39 + 18×£99 + 2×£249 = **£3,450/mo** |
| **Margin** | **~95%** |

---

## What this tells you

**The economics are good and get better with scale.** Infrastructure is nearly
flat while revenue is linear, so margin *improves* as you grow — the opposite of
a business that pays per customer.

**AI is the only variable cost, and it's already controlled.** Per-hotel caps,
model tiering (Haiku on Starter) and prompt caching are all in place. At 50
hotels it is ~2% of revenue.

**Three things would change these numbers:**

1. **Free tier ending (~July 2027)** — plan for ~£17/mo appearing.
2. **Outgrowing one box.** A single `t3.micro` will not carry 50 hotels; expect
   to move up around 20–30. That is a ~£30/mo step, not a rewrite.
3. **A backup/monitoring layer** you have deliberately deferred — Route53 health
   checks (~£0.40/mo) and Sentry (free to 5k events). Both are pennies, and both
   are worth buying the moment there is a customer who would notice an outage.

**What you should not economise on:** RDS backups and the S3 backup bucket. They
are the cheapest line items here and the only ones whose absence is unrecoverable.
