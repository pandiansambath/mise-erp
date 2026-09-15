"""Which AWS charge belongs to which pool, and why it is not a one-line dict.

    "ALSO SHOW HOTEL WISE TOO..WHO COST HOW MUHC N WHY WITH PROOFs"

THREE POOLS, NEVER BLENDED INTO ONE NUMBER

  DIRECT    measured per hotel. Bedrock and Polly — we log every call.
  SHARED    allocated by a stated formula. EC2, EBS, RDS and its storage: one
            box, and splitting it is a MODEL, not a measurement.
  PLATFORM  not attributable at all. The Elastic IP, ECR, CloudWatch, Cost
            Explorer's own charges. Rent and deploy artefacts.

THE THING THIS FILE EXISTS TO SAY OUT LOUD

On a fixed t3.micro and db.t4g.micro, **the marginal cost of the SHARED pool is
zero until you resize**. The box costs the same with one restaurant or fifty.
So a SHARED allocation is a fair split of RENT — not a claim about who caused
spend. The page shows both numbers side by side, because either one alone is a
lie in a different direction.

EVERY RULE BELOW IS A TRAP SOMEBODY ALREADY FELL INTO

All figures measured against the live account, 1-16 September 2026.
"""

from __future__ import annotations

DIRECT = "direct"
SHARED = "shared"
PLATFORM = "platform"
UNCLASSIFIED = "unclassified"

#: Exact Cost Explorer SERVICE keys. Exact, not substring — see `classify`.
_EXACT: dict[str, str] = {
    # -- SHARED: the box everyone is on -----------------------------------
    "Amazon Relational Database Service": SHARED,          # $7.65 MTD
    "Amazon Elastic Compute Cloud - Compute": SHARED,      # $4.10 MTD
    # -- DIRECT: measured per hotel ---------------------------------------
    "Amazon Polly": DIRECT,                                # $0.03 MTD
    # -- PLATFORM: rent and artefacts, nobody's cost-to-serve -------------
    "Amazon Virtual Private Cloud": PLATFORM,              # the ELASTIC IP: $1.75
    "Amazon EC2 Container Registry (ECR)": PLATFORM,       # our Docker images: $1.53
    "AWS Cost Explorer": PLATFORM,                         # this dashboard's own cost
    "Amazon Simple Storage Service": PLATFORM,             # $0.014 — see the note below
    "AWS Secrets Manager": PLATFORM,
    "AmazonCloudWatch": PLATFORM,                          # ONE WORD. And often absent.
    "AWS Key Management Service": PLATFORM,
    "Amazon Simple Notification Service": PLATFORM,
    "Amazon Simple Queue Service": PLATFORM,
    "AWS Glue": PLATFORM,
}


def classify(service: str, usage_type: str = "") -> str:
    """Pool for one Cost Explorer row.

    ORDER MATTERS. Each branch is a specific failure:
    """
    s = (service or "").strip()
    u = (usage_type or "").strip()

    # 1. BEDROCK IS N KEYS, NOT ONE, and the model name is INSIDE the key:
    #    "Claude Sonnet 4.6 (Amazon Bedrock Edition)". July billed THREE models
    #    at once — Sonnet, Haiku and Opus. Anyone writing `service == THE_KEY`
    #    silently drops two of them, and the plan is to put the entry tier on
    #    Haiku deliberately. Substring, and sum them all into one AI line.
    if "bedrock" in s.lower():
        return DIRECT

    # 2. `EC2 - Other` IS TWO POOLS and must be split by usage type. EBS is the
    #    disk under the box (SHARED); `-AWS-Out-Bytes` is data transfer
    #    (PLATFORM). A service-level map puts data transfer into a restaurant's
    #    cost-to-serve, which is not a cost any restaurant caused.
    if s == "EC2 - Other":
        if "EBS:" in u:
            return SHARED
        if u.endswith("-AWS-Out-Bytes") or "DataTransfer" in u:
            return PLATFORM
        return UNCLASSIFIED

    if s in _EXACT:
        return _EXACT[s]

    # 3. NEVER substring-match "EC2". `Amazon EC2 Container Registry (ECR)`
    #    contains it, and that single rule would move our Docker images out of
    #    PLATFORM and bill them to the restaurants.
    #
    # 4. UNKNOWN IS NEVER SHARED. A mystery charge must not land on somebody's
    #    cost-to-serve. It goes to its own visible row — "he said don't miss
    #    any", and a new service quietly folded into a pool is exactly how a
    #    $10/month surprise hides.
    return UNCLASSIFIED


#: Which SHARED lines are compute versus database. Used to weight the
#: allocation by what each resource actually costs THIS MONTH, so the formula
#: reads its own inputs from the bill rather than from a hand-tuned constant
#: that drifts.
def shared_kind(service: str, usage_type: str = "") -> str:
    u = (usage_type or "")
    if service == "Amazon Relational Database Service":
        return "db"
    if service == "Amazon Elastic Compute Cloud - Compute":
        return "app"
    if service == "EC2 - Other" and "EBS:" in u:
        return "app"
    return "app"


#: A usage type appearing at all is worth shouting about, before any total is.
#: A NAT gateway is ~$35/month the moment it exists; waiting for a month-end
#: figure to notice is waiting a month.
LOUD_USAGE_TYPES = (
    "NatGateway",
    "LoadBalancerUsage",
    "ElasticIP:IdleAddress",
    "DataTransfer-Out-Bytes",
)


def is_loud(usage_type: str) -> bool:
    return any(k in (usage_type or "") for k in LOUD_USAGE_TYPES)


#: S3 IS attributable — keys are `{hotel_id}/{doc_id}/{filename}`, so per-hotel
#: storage is computable. It is PLATFORM on grounds of MATERIALITY, not
#: impossibility: $0.014 a month does not earn the code. If document storage
#: ever grows, this moves to DIRECT and the reason is written down here so
#: nobody has to rediscover that it was a choice.
S3_IS_ATTRIBUTABLE_BUT_IMMATERIAL = True


#: The Cost Explorer filter to use, and the one NOT to.
#:
#: `RECORD_TYPE = "Usage"` is correct today — it is the only record type
#: present across July, August and September. It BREAKS SILENTLY the day a
#: Reserved Instance is bought, which `AWS_COST_PLAN.md` actively recommends:
#: an RI reclassifies that spend as `DiscountedUsage` + `RIFee`, and the
#: dashboard would show RDS collapsing to near zero.
#:
#: Excluding Credit and Refund instead returns identical figures today
#: ($9.222 / $41.9125 / $16.669 for Jul/Aug/Sep — verified) and survives a
#: reservation.
CE_RECORD_TYPE_FILTER = {
    "Not": {"Dimensions": {"Key": "RECORD_TYPE", "Values": ["Credit", "Refund"]}}
}
