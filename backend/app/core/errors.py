"""Error codes: `DINE-<LAYER><NNNN>`.

A code answers two questions before anyone reads the message: **where did this
break**, and **what kind of thing is it**.

The LAYER letter is the important half, because it tells you who fixes it:

  | Layer | Prefix | Fixed by |
  |-------|--------|----------|
  | Backend / our own code | `B` | us, in this repo |
  | Frontend / browser     | `F` | us, in the frontend |
  | AI (Bedrock, models)   | `A` | AWS, quotas, prompts — rarely a code change |
  | Infrastructure         | `I` | AWS: RDS, S3, CloudWatch, email |

**Why AI and infrastructure are not "backend".** They surface *through* the
backend — the stack trace is ours — but an `A` or `I` code means the bug is
almost never in our logic. Folding them into `B` would send you reading
application code when the real answer is a quota, a permission, or a provider
outage. That distinction is worth a letter.

The four-digit part groups by domain within the layer:
`1xxx` auth · `2xxx` billing · `3xxx` AI usage · `4xxx` operations ·
`5xxx` external calls · `6xxx` data & imports · `9xxx` unclassified.

Two rules keep this honest:
* **A code never changes meaning.** Retire it rather than repurpose it, or every
  saved CloudWatch search quietly starts lying.
* **Unknowns go to `*-9000`.** That bucket should stay small; if it grows,
  something common is unclassified and has earned its own code.
"""
from __future__ import annotations

# ── B: BACKEND — our own application logic ──────────────────────────────────
AUTH_INVALID_CREDENTIALS = "DINE-B1001"
AUTH_TOKEN_EXPIRED = "DINE-B1002"
AUTH_EMAIL_UNVERIFIED = "DINE-B1003"
AUTH_PERMISSION_DENIED = "DINE-B1004"
AUTH_HOTEL_INACTIVE = "DINE-B1005"
AUTH_USER_LIMIT_REACHED = "DINE-B1006"
AUTH_ROLE_OUT_OF_ENVELOPE = "DINE-B1007"

BILLING_NOT_CONFIGURED = "DINE-B2001"
BILLING_SUBSCRIPTION_LAPSED = "DINE-B2003"
BILLING_TRIAL_EXPIRED = "DINE-B2004"
BILLING_UNKNOWN_PLAN = "DINE-B2005"
BILLING_WEBHOOK_UNVERIFIED = "DINE-B2006"

STOCK_ITEM_NOT_FOUND = "DINE-B4001"
STOCK_NEGATIVE_RESULT = "DINE-B4002"
VENDOR_PRICE_MISSING = "DINE-B4003"
PURCHASE_INDENT_INVALID = "DINE-B4004"
RECIPE_COST_UNAVAILABLE = "DINE-B4005"

IMPORT_BAD_FORMAT = "DINE-B6001"
IMPORT_MISSING_COLUMN = "DINE-B6002"
IMPORT_BAD_VALUE = "DINE-B6003"
IMPORT_DUPLICATE_ROW = "DINE-B6004"

BACKEND_UNKNOWN = "DINE-B9000"

# ── F: FRONTEND — browser-side, reported back for correlation ───────────────
# The frontend POSTs these so a customer's "it went blank" has a code you can
# line up against the backend request that preceded it.
UI_RENDER_CRASH = "DINE-F1001"
UI_NETWORK_FAILED = "DINE-F1002"
UI_SESSION_LOST = "DINE-F1003"
UI_UPLOAD_REJECTED = "DINE-F1004"
UI_UNKNOWN = "DINE-F9000"

# ── A: AI — Bedrock and the models. Almost never fixed in our code ──────────
AI_UNAVAILABLE = "DINE-A3001"          # model access / region / agreement
AI_QUOTA_EXCEEDED = "DINE-A3002"       # the hotel's own allowance
AI_NOT_IN_PLAN = "DINE-A3003"          # sold, not bought
AI_BAD_RESPONSE = "DINE-A3004"         # unparseable output
AI_TOOL_FAILED = "DINE-A3005"          # a Copilot tool raised
AI_PAYLOAD_TOO_LARGE = "DINE-A3006"
AI_THROTTLED = "DINE-A3007"            # AWS-side rate limit, not ours
AI_UNKNOWN = "DINE-A9000"

# ── I: INFRASTRUCTURE — AWS and providers ──────────────────────────────────
INFRA_DB_UNAVAILABLE = "DINE-I5001"
INFRA_S3_FAILED = "DINE-I5002"
INFRA_EMAIL_FAILED = "DINE-I5003"
INFRA_STRIPE_FAILED = "DINE-I5004"
INFRA_CLOUDWATCH_FAILED = "DINE-I5005"
INFRA_UNKNOWN = "DINE-I9000"

# Kept so `code=UNKNOWN` in older call sites still resolves.
UNKNOWN = BACKEND_UNKNOWN

MEANINGS: dict[str, str] = {
    AUTH_INVALID_CREDENTIALS: "Sign-in failed — wrong email or password",
    AUTH_TOKEN_EXPIRED: "Session expired",
    AUTH_EMAIL_UNVERIFIED: "Email not verified yet",
    AUTH_PERMISSION_DENIED: "Role lacks this permission",
    AUTH_HOTEL_INACTIVE: "Hotel is deactivated",
    AUTH_USER_LIMIT_REACHED: "Plan's user limit reached",
    AUTH_ROLE_OUT_OF_ENVELOPE: "Permission requested outside the role's envelope",
    BILLING_NOT_CONFIGURED: "Stripe keys not set",
    BILLING_SUBSCRIPTION_LAPSED: "Subscription unpaid or cancelled",
    BILLING_TRIAL_EXPIRED: "Free trial has ended",
    BILLING_UNKNOWN_PLAN: "Unrecognised plan key",
    BILLING_WEBHOOK_UNVERIFIED: "Webhook signature did not verify",
    STOCK_ITEM_NOT_FOUND: "Stock item does not exist",
    STOCK_NEGATIVE_RESULT: "Movement would take stock below zero",
    VENDOR_PRICE_MISSING: "No supplier prices this item",
    PURCHASE_INDENT_INVALID: "Indent has no usable lines",
    RECIPE_COST_UNAVAILABLE: "Recipe cost cannot be computed",
    IMPORT_BAD_FORMAT: "File format not understood",
    IMPORT_MISSING_COLUMN: "Required column missing",
    IMPORT_BAD_VALUE: "A value could not be read",
    IMPORT_DUPLICATE_ROW: "Duplicate row in the upload",
    BACKEND_UNKNOWN: "Unclassified backend error",
    UI_RENDER_CRASH: "The interface crashed while rendering",
    UI_NETWORK_FAILED: "Browser could not reach the API",
    UI_SESSION_LOST: "Signed out unexpectedly",
    UI_UPLOAD_REJECTED: "Browser rejected the file before upload",
    UI_UNKNOWN: "Unclassified frontend error",
    AI_UNAVAILABLE: "Bedrock unreachable or model access missing",
    AI_QUOTA_EXCEEDED: "Hotel is over its AI allowance",
    AI_NOT_IN_PLAN: "AI feature not included in this plan",
    AI_BAD_RESPONSE: "Model returned unparseable output",
    AI_TOOL_FAILED: "A Copilot tool raised",
    AI_PAYLOAD_TOO_LARGE: "Upload exceeded the size limit",
    AI_THROTTLED: "AWS throttled the model call",
    AI_UNKNOWN: "Unclassified AI error",
    INFRA_DB_UNAVAILABLE: "Database unreachable",
    INFRA_S3_FAILED: "S3 read/write failed",
    INFRA_EMAIL_FAILED: "Email provider failed",
    INFRA_STRIPE_FAILED: "Stripe API call failed",
    INFRA_CLOUDWATCH_FAILED: "CloudWatch write failed",
    INFRA_UNKNOWN: "Unclassified infrastructure error",
}

LAYERS = {"B": "backend", "F": "frontend", "A": "ai", "I": "infrastructure"}


def meaning(code: str) -> str:
    return MEANINGS.get(code, "Unclassified error")


def layer_of(code: str) -> str:
    """"DINE-A3002" -> "ai". Lets a dashboard group by who fixes it."""
    try:
        return LAYERS.get(code.split("-")[1][0], "unknown")
    except (IndexError, AttributeError):
        return "unknown"
